import { sql, type SQL } from "drizzle-orm";
import { getClient, runInTransaction } from "../transaction-context";
import { storageLogger } from "../../logger";
import { isPlainTableIdentifier, RECORD_ID_SQL_PATTERN } from "./entity-metadata-tables";
import { getMetadataContextForTable } from "../entity-metadata-record-tables";

/**
 * Moving a table's OWN creation/modification columns into `entity_metadata`,
 * once, from a migration.
 *
 * Roughly two dozen tables predate the provenance framework and carry their
 * own `created_at` / `updated_at` / `created_by` / `date_created` column — a
 * second, partial answer to "when was this made, and by whom". Retiring one
 * is a task per area (`docs/provenance-columns.md` lists them), and every one
 * of those tasks has the same first step: whatever the old column knows has to
 * reach provenance before anything is dropped, or the history it holds is
 * simply lost.
 *
 * This is that step, written once. A migration names the table and which of
 * its columns hold the four facts, and gets back either what was seeded or a
 * stated reason nothing was.
 *
 * ## What it promises
 *
 *  - **It only ever makes a stamp MORE truthful.** An earlier created date
 *    wins, a later modified date wins, a known person replaces an unknown one.
 *    Nothing here moves a stamp backwards and nothing replaces a real person
 *    with nobody — the same monotonic rules `./entity-metadata.ts` applies to
 *    every other write, spelled the same way in SQL so that concurrent writers
 *    settle identically. That is what makes it safe to run AFTER the admin
 *    backfill has already stamped a record at backfill time: the seed's older,
 *    truer creation date simply replaces the backfill's "first sighting".
 *  - **Running it twice changes nothing the second time.** The conflict path
 *    updates a row only when one of those four improvements actually applies,
 *    so a second run reports zero rows written rather than rewriting every row
 *    with the values it already holds.
 *  - **It wraps its own transaction.** The migration runner does NOT wrap
 *    `up()` (see `docs/architecture-decisions.md`), so the seed opens one and
 *    a partial failure rolls back whole.
 *  - **A table that is not there is skipped, not fatal.** A component-owned
 *    table does not exist while its component is off, and a core migration
 *    that dies on it bricks the boot of every deployment where that component
 *    is disabled. Same for a column the schema no longer has: the seed states
 *    what it could not find and writes nothing.
 *
 * ## What it does not do
 *
 * It does not guess. A record whose bespoke columns hold only a date keeps an
 * unknown person — only the date is recoverable — and a record that offers no
 * date at all is passed over entirely and counted, because a provenance row
 * has to carry a date and the seed has none to give. A table that knows WHO
 * but not WHEN therefore has to name the earliest date it can honestly claim
 * (its last-saved watermark is one; a fabricated "now" is not).
 *
 * ## Why raw SQL
 *
 * Same reason the upserts in `./entity-metadata.ts` are: the timestamps are
 * naive columns holding wall clock in the process zone, and the whole point
 * here is to move a value from one such column to another WITHOUT it passing
 * through a JavaScript `Date` and picking up a zone conversion on the way.
 * Every value stays inside the database for the whole trip.
 */

/**
 * Which of one table's columns hold the four provenance facts.
 *
 * At least one of the two DATE columns must be named — see the "does not
 * guess" note above. The person columns are optional and usually absent:
 * most of these tables recorded a date and nobody.
 */
export interface ProvenanceSeedSpec {
  /** The table whose own columns are being moved into provenance. */
  table: string;
  /** Column holding when each record was created. */
  createdDateColumn?: string;
  /** Column naming who created each record (a `users.id`). */
  createdByColumn?: string;
  /** Column holding when each record last changed. */
  modifiedDateColumn?: string;
  /** Column naming who last changed each record (a `users.id`). */
  modifiedByColumn?: string;
}

/** What one seeding run did, or why it did nothing. */
export type ProvenanceSeedResult =
  | {
      table: string;
      seeded: true;
      /** Records in the table. */
      records: number;
      /** Provenance rows created or improved. Zero on a second run. */
      rowsWritten: number;
      /** Records passed over: their own columns hold no date to seed from. */
      skippedWithoutDate: number;
      /** Records passed over: their id is not shaped like a record id. */
      skippedNotRecordId: number;
      /**
       * Records whose provenance row names a DIFFERENT table, left untouched.
       * Never expected — a record id belongs to one table for good — and worth
       * seeing if it is ever not zero.
       */
      heldByAnotherTable: number;
    }
  | { table: string; seeded: false; reason: string };

export interface EntityMetadataSeedStorage {
  /**
   * Seed one table's provenance rows from its own creation/modification
   * columns. Safe to re-run; safe on a deployment where the table is absent.
   */
  seedFromColumns(spec: ProvenanceSeedSpec): Promise<ProvenanceSeedResult>;
}

/**
 * An identifier this module is willing to put into SQL text.
 *
 * Table and column names here come from a migration's source, not from user
 * input, so this is not a sanitizer — it is a refusal to build SQL out of
 * anything that is not plainly an identifier, which is the same line
 * `./entity-metadata.ts` draws for the orphan sweep.
 */
function identifier(name: string, role: string): SQL {
  if (!isPlainTableIdentifier(name)) {
    throw new Error(
      `Refusing to seed provenance: ${role} "${name}" is not a plain identifier`,
    );
  }
  return sql.raw(`"${name}"`);
}

/** `t."col"`, or SQL NULL when the spec did not name that column. */
function sourceColumn(column: string | undefined, role: string): SQL {
  if (column === undefined) return sql`NULL`;
  return sql`t.${identifier(column, role)}`;
}

function countOf(row: Record<string, unknown> | undefined, key: string): number {
  return Number(row?.[key] ?? 0);
}

export function createEntityMetadataSeedStorage(): EntityMetadataSeedStorage {
  return {
    async seedFromColumns(spec) {
      const {
        table,
        createdDateColumn,
        createdByColumn,
        modifiedDateColumn,
        modifiedByColumn,
      } = spec;
      const metadataContext = getMetadataContextForTable(table);
      if (!metadataContext) {
        throw new Error(`Refusing to seed provenance for "${table}": no eligible metadata context`);
      }
      const contextId = metadataContext.contextId;

      if (createdDateColumn === undefined && modifiedDateColumn === undefined) {
        throw new Error(
          `Refusing to seed provenance for "${table}": no date column named. ` +
            `A provenance row must carry a date, and this routine will not invent one — ` +
            `name the earliest date the table can honestly claim.`,
        );
      }

      // Validate every name before anything is built from it, so a typo is a
      // thrown error rather than a half-assembled statement.
      const tableSql = identifier(table, "table");
      const wantedColumns = [
        createdDateColumn,
        createdByColumn,
        modifiedDateColumn,
        modifiedByColumn,
      ].filter((c): c is string => c !== undefined);
      for (const column of wantedColumns) identifier(column, "column");

      return runInTransaction(async () => {
        const client = getClient();

        // What the schema actually has. Both misses below are the same kind of
        // answer — "this deployment's schema does not carry what you asked me
        // to seed from" — and both are a stated skip rather than a failure,
        // because a core migration that throws here stops the boot of every
        // deployment whose schema has moved on (or never had the component).
        const catalog = await client.execute(sql`
          SELECT column_name
          FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = ${table}
        `);
        const present = new Set(
          (catalog.rows ?? []).map((row) =>
            String((row as Record<string, unknown>).column_name),
          ),
        );

        if (present.size === 0) {
          return {
            table,
            seeded: false,
            reason: "no such table (component disabled, or dropped)",
          };
        }
        if (!present.has("id")) {
          return { table, seeded: false, reason: "no id column to key provenance by" };
        }
        const missing = wantedColumns.filter((column) => !present.has(column));
        if (missing.length > 0) {
          return {
            table,
            seeded: false,
            reason: `table no longer has ${missing.join(", ")}`,
          };
        }

        const createdSource = sourceColumn(createdDateColumn, "created date column");
        const modifiedSource = sourceColumn(modifiedDateColumn, "modified date column");
        const createdBySource = sourceColumn(createdByColumn, "created by column");
        const modifiedBySource = sourceColumn(modifiedByColumn, "modified by column");

        // A record's creation date is the earliest thing its own columns can
        // claim and its modification date the latest, so each falls back to
        // the other when only one column exists. That keeps the framework's
        // "a row always has both dates" rule without inventing anything: a
        // creation-only table says the record last changed when it was made,
        // which GREATEST will happily lose to any later, truer stamp.
        const createdDate = sql`COALESCE(${createdSource}, ${modifiedSource})`;
        const modifiedDate = sql`COALESCE(${modifiedSource}, ${createdSource})`;
        const hasDate = sql`(${createdSource} IS NOT NULL OR ${modifiedSource} IS NOT NULL)`;
        const isRecordId = sql`t."id"::text ~* ${RECORD_ID_SQL_PATTERN}`;

        const stats = await client.execute(sql`
          SELECT
            count(*) AS records,
            count(*) FILTER (WHERE NOT ${isRecordId}) AS not_record_id,
            count(*) FILTER (WHERE ${isRecordId} AND NOT ${hasDate}) AS without_date,
            count(*) FILTER (
              WHERE ${isRecordId} AND EXISTS (
                SELECT 1 FROM entity_metadata m
                WHERE m.entity_id = t."id"::text AND m.context_id <> ${contextId}
              )
            ) AS held_elsewhere
          FROM ${tableSql} t
          WHERE t."id" IS NOT NULL
        `);
        const statsRow = stats.rows?.[0] as Record<string, unknown> | undefined;

        // The person columns are read THROUGH `users` rather than copied: a
        // bespoke column can name an account that has since been deleted, and
        // `entity_metadata`'s FK would turn that one stale row into a failed
        // migration. An unrecognised person is nobody, which is exactly what
        // the FK's ON DELETE SET NULL would have made of it anyway.
        const written = await client.execute(sql`
          INSERT INTO entity_metadata (
            context_id, entity_id,
            created_date, created_by,
            modified_date, modified_by
          )
          SELECT
            ${contextId}, t."id"::text,
            ${createdDate}, cu.id,
            ${modifiedDate}, mu.id
          FROM ${tableSql} t
          LEFT JOIN users cu ON cu.id = ${createdBySource}
          LEFT JOIN users mu ON mu.id = ${modifiedBySource}
          WHERE t."id" IS NOT NULL
            AND ${isRecordId}
            AND ${hasDate}
          ON CONFLICT (entity_id) DO UPDATE SET
            rev = entity_metadata.rev + 1,
            created_date = LEAST(entity_metadata.created_date, EXCLUDED.created_date),
            created_by = COALESCE(entity_metadata.created_by, EXCLUDED.created_by),
            modified_date = GREATEST(entity_metadata.modified_date, EXCLUDED.modified_date),
            modified_by = CASE
              -- Never a real person replaced by nobody, and never a known
              -- modifier displaced by an equally old one: the seed's person
              -- wins only where the row has none, or where the seed's date is
              -- strictly later than the one the row was stamped with.
              WHEN EXCLUDED.modified_by IS NULL THEN entity_metadata.modified_by
              WHEN entity_metadata.modified_by IS NULL
                OR entity_metadata.modified_date IS NULL
                OR entity_metadata.modified_date < EXCLUDED.modified_date
              THEN EXCLUDED.modified_by
              ELSE entity_metadata.modified_by
            END
          WHERE entity_metadata.context_id = EXCLUDED.context_id
            -- Update only where one of the four improvements actually applies.
            -- Without this the statement would rewrite every row with the
            -- values it already holds, and a second run would report the whole
            -- table as written when it had changed nothing.
            AND (
              (EXCLUDED.created_date IS NOT NULL
                AND (entity_metadata.created_date IS NULL
                  OR EXCLUDED.created_date < entity_metadata.created_date))
              OR (EXCLUDED.created_by IS NOT NULL AND entity_metadata.created_by IS NULL)
              OR (EXCLUDED.modified_date IS NOT NULL
                AND (entity_metadata.modified_date IS NULL
                  OR EXCLUDED.modified_date > entity_metadata.modified_date))
              OR (EXCLUDED.modified_by IS NOT NULL
                AND entity_metadata.modified_by IS DISTINCT FROM EXCLUDED.modified_by
                AND (entity_metadata.modified_by IS NULL
                  OR entity_metadata.modified_date IS NULL
                  OR entity_metadata.modified_date < EXCLUDED.modified_date))
            )
        `);

        const result: ProvenanceSeedResult = {
          table,
          seeded: true,
          records: countOf(statsRow, "records"),
          rowsWritten: written.rowCount ?? 0,
          skippedWithoutDate: countOf(statsRow, "without_date"),
          skippedNotRecordId: countOf(statsRow, "not_record_id"),
          heldByAnotherTable: countOf(statsRow, "held_elsewhere"),
        };

        if (result.heldByAnotherTable > 0) {
          // A record id belonging to two tables means one of them is filing
          // provenance under someone else's id. Nothing was overwritten (the
          // conflict guard saw to that), but somebody has to know.
          storageLogger.warn("Entity metadata seed: ids already held by another table", {
            module: "entityMetadataSeed",
            operation: "seedFromColumns",
            description: "record ids in this table already carry provenance naming a different table",
            meta: { table, heldByAnotherTable: result.heldByAnotherTable },
          });
        }

        return result;
      });
    },
  };
}
