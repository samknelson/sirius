import { sql, type SQL } from "drizzle-orm";
import { getClient } from "../transaction-context";
import {
  entityMetadataStorage,
  isRecordId,
  type TableVerdict,
} from "./entity-metadata";
import { isPlainTableIdentifier, RECORD_ID_SQL_PATTERN } from "./entity-metadata-tables";
import {
  listMetadataRecordContexts,
  getMetadataRecordContext,
} from "../entity-metadata-record-tables";

/**
 * Reading and filling in `entity_metadata` across the whole table, for the
 * administrator's view of it.
 *
 * Separate from `./entity-metadata.ts` on purpose. That module is a leaf — the
 * storage logging middleware imports it, so it may not reach for the record
 * table registry or anything else that would drag the schema into the logging
 * path. This module is nobody's dependency and may.
 *
 * The division of labour with the leaf is worth stating: every WRITE to
 * `entity_metadata` still happens there, including the backfill's. What
 * happens here is the deciding — which records have no provenance row, and
 * which of them this run will write — because that is the part that has to
 * name a table, and naming a table is what the registry is for.
 */

/** One date/person pair as the admin list reads it back. */
export interface MetadataStampRow {
  date: Date | null;
  personId: string | null;
  personName: string | null;
}

/** One provenance row, with the people it names resolved. */
export interface MetadataListRow {
  seq: number;
  rev: number;
  contextId: string;
  entityId: string;
  created: MetadataStampRow;
  modified: MetadataStampRow;
  subrecordModified: MetadataStampRow;
}

/** Which column a list is ordered by. Anything else is refused. */
export type MetadataSortColumn =
  | "seq"
  | "contextId"
  | "createdDate"
  | "modifiedDate"
  | "subrecordModifiedDate";

/** A date range and a person, for one of the three stamps. */
export interface MetadataStampFilter {
  from?: Date;
  to?: Date;
  personId?: string;
}

export interface MetadataListFilters {
  contextId?: string;
  created?: MetadataStampFilter;
  modified?: MetadataStampFilter;
  subrecordModified?: MetadataStampFilter;
}

export interface MetadataListQuery extends MetadataListFilters {
  /** Zero-based, as the other paginated storage reads count. */
  page: number;
  limit: number;
  sort: MetadataSortColumn;
  sortDir: "asc" | "desc";
}

export interface MetadataListResult {
  data: MetadataListRow[];
  total: number;
  page: number;
  limit: number;
}

/** A person named by at least one provenance row. */
export interface MetadataPerson {
  id: string;
  name: string;
}

/** How many of one table's records have no provenance row. */
export type MetadataContextCount =
  | { contextId: string; countable: true; missing: number }
  | { contextId: string; countable: false; reason: string };

/** What one backfill run did. */
export interface MetadataBackfillResult {
  contextId: string;
  /** Rows this run created. */
  written: number;
  /**
   * Records this run looked at that turned out to already have a row — a
   * record that gained real provenance between being counted and being
   * written. Its own history is kept; nothing was overwritten.
   */
  alreadyPresent: number;
  /**
   * Records passed over because their id is not a record id, so nothing could
   * be filed under it. Always zero unless the two spellings of "is a record
   * id" — the one this asks the database and the one it applies in memory —
   * have come apart; such records are not counted as missing either.
   */
  skipped: number;
  /** How many records still have no provenance row, counted after the run. */
  missing: number;
}

/** The most rows one press of the button may create. */
export const BACKFILL_BATCH_LIMIT = 1000;

/** The columns a list may be ordered by, and what they are called in SQL. */
const SORT_COLUMNS: Record<MetadataSortColumn, string> = {
  seq: "m.seq",
  contextId: "m.context_id",
  createdDate: "m.created_date",
  modifiedDate: "m.modified_date",
  subrecordModifiedDate: "m.subrecord_modified_date",
};

export interface EntityMetadataAdminStorage {
  /**
   * Provenance rows across every table, filtered and paginated.
   *
   * The people are resolved here rather than left as ids: a list of a hundred
   * rows would otherwise be a hundred lookups on the far side.
   */
  list(query: MetadataListQuery): Promise<MetadataListResult>;

  /**
   * Everyone named by any provenance row, for the list's person filters.
   *
   * Read from the rows themselves rather than from the user table: offering
   * every user in the system as a filter would offer thousands of choices
   * that match nothing.
   */
  listPeople(): Promise<MetadataPerson[]>;

  /**
   * How many of one table's records have no provenance row at all.
   *
   * Refuses — rather than guesses — for a table the sweep's own judgement
   * will not vouch for. The two ask the same question of the same table, so
   * a table this cannot count is exactly a table that cannot be swept, and
   * both say why in the same words.
   */
  countMissing(contextId: string): Promise<MetadataContextCount>;

  /**
   * Create up to `limit` provenance rows for one table's records that have
   * none, one record at a time.
   *
   * Not a bulk statement and not a transaction: a run that fails partway
   * leaves behind every row it had already written, and pressing the button
   * again continues from wherever it stopped. Nothing here can overwrite an
   * existing row.
   */
  backfill(contextId: string, limit: number): Promise<MetadataBackfillResult>;
}

/**
 * The records of an admitted table that could carry a history and have none.
 *
 * Counting and writing must select exactly the same records. If counting were
 * the looser of the two, a record the write passes over would be reported as
 * still missing after every run — the count would never reach zero and the
 * page would go on saying "run again to continue" forever. So the id shape the
 * write insists on is asked of the database here, once, for both.
 */
const missingHistory = sql`
  t.id IS NOT NULL
    AND t.id::text ~* ${RECORD_ID_SQL_PATTERN}
    AND NOT EXISTS (
      SELECT 1 FROM entity_metadata m WHERE m.entity_id = t.id::text
    )
`;

/**
 * Admit a table name for use in SQL text.
 *
 * An anti-join has to name its table, which no bind parameter can do, so the
 * name is checked three ways before it is interpolated: it is declared in the
 * registry, it is shaped like an identifier, and the database agrees it is a
 * table whose `id` column holds record ids. The third check is the sweep's own
 * (`checkContext`), reused so that "can be counted" and "can be swept" cannot
 * come apart.
 */
async function admitContext(contextId: string): Promise<TableVerdict & { tableName?: string }> {
  const context = getMetadataRecordContext(contextId);
  if (!context) return { sweepable: false, reason: "not a registered metadata context" };
  if (!isPlainTableIdentifier(context.tableName)) {
    return { sweepable: false, reason: "not a plain table name" };
  }
  const verdict = await entityMetadataStorage.checkContext(contextId);
  return verdict.sweepable ? { sweepable: true, tableName: context.tableName } : verdict;
}

/** Display name from a joined user row, or null when nobody was recorded. */
function personNameFrom(row: Record<string, unknown>, prefix: string): string | null {
  const part = (key: string) => {
    const value = row[`${prefix}_${key}`];
    return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
  };
  const full = [part("first_name"), part("last_name")].filter(Boolean).join(" ");
  if (full) return full;
  return part("email");
}

function stampFrom(
  row: Record<string, unknown>,
  dateColumn: string,
  personColumn: string,
  personPrefix: string,
): MetadataStampRow {
  const raw = row[dateColumn];
  const date = raw instanceof Date ? raw : typeof raw === "string" ? new Date(raw) : null;
  const personId = row[personColumn];
  return {
    date,
    personId: typeof personId === "string" ? personId : null,
    personName: personNameFrom(row, personPrefix),
  };
}

/** The WHERE fragments one stamp's filters contribute. */
function stampConditions(
  dateColumn: string,
  personColumn: string,
  filter: MetadataStampFilter | undefined,
): SQL[] {
  if (!filter) return [];
  const conditions: SQL[] = [];
  const column = sql.raw(dateColumn);
  if (filter.from) conditions.push(sql`${column} >= ${filter.from}`);
  if (filter.to) conditions.push(sql`${column} <= ${filter.to}`);
  if (filter.personId) conditions.push(sql`${sql.raw(personColumn)} = ${filter.personId}`);
  return conditions;
}

export function createEntityMetadataAdminStorage(): EntityMetadataAdminStorage {
  return {
    async list(query) {
      const client = getClient();
      const conditions: SQL[] = [];

      const eligibleContextIds = listMetadataRecordContexts().map((entry) => entry.contextId);
      conditions.push(
        sql`m.context_id IN (${sql.join(
          eligibleContextIds.map((contextId) => sql`${contextId}`),
          sql`, `,
        )})`,
      );
      if (query.contextId) conditions.push(sql`m.context_id = ${query.contextId}`);
      conditions.push(
        ...stampConditions("m.created_date", "m.created_by", query.created),
        ...stampConditions("m.modified_date", "m.modified_by", query.modified),
        ...stampConditions(
          "m.subrecord_modified_date",
          "m.subrecord_modified_by",
          query.subrecordModified,
        ),
      );

      const where =
        conditions.length > 0
          ? sql`WHERE ${sql.join(conditions, sql` AND `)}`
          : sql``;

      const countResult = await client.execute(
        sql`SELECT count(*)::int AS total FROM entity_metadata m ${where}`,
      );
      const total = Number((countResult.rows?.[0] as Record<string, unknown>)?.total ?? 0);

      // A legacy row can still hold an empty date (the never-empty rule only
      // binds writes made since it existed), and an empty date is not the
      // most recent thing that happened — it is the absence of one. So it
      // sorts last whichever way the column is read.
      const direction = query.sortDir === "asc" ? sql.raw("ASC") : sql.raw("DESC");
      const orderBy = sql`${sql.raw(SORT_COLUMNS[query.sort])} ${direction} NULLS LAST, m.seq DESC`;

      const result = await client.execute(sql`
        SELECT
          m.seq, m.rev, m.context_id, m.entity_id,
          m.created_date, m.created_by,
          m.modified_date, m.modified_by,
          m.subrecord_modified_date, m.subrecord_modified_by,
          cu.first_name AS created_first_name,
          cu.last_name  AS created_last_name,
          cu.email      AS created_email,
          mu.first_name AS modified_first_name,
          mu.last_name  AS modified_last_name,
          mu.email      AS modified_email,
          su.first_name AS subrecord_first_name,
          su.last_name  AS subrecord_last_name,
          su.email      AS subrecord_email
        FROM entity_metadata m
        LEFT JOIN users cu ON cu.id = m.created_by
        LEFT JOIN users mu ON mu.id = m.modified_by
        LEFT JOIN users su ON su.id = m.subrecord_modified_by
        ${where}
        ORDER BY ${orderBy}
        LIMIT ${query.limit} OFFSET ${query.page * query.limit}
      `);

      const data = (result.rows ?? []).map((raw) => {
        const row = raw as Record<string, unknown>;
        return {
          seq: Number(row.seq),
          rev: Number(row.rev),
          contextId: String(row.context_id),
          entityId: String(row.entity_id),
          created: stampFrom(row, "created_date", "created_by", "created"),
          modified: stampFrom(row, "modified_date", "modified_by", "modified"),
          subrecordModified: stampFrom(
            row,
            "subrecord_modified_date",
            "subrecord_modified_by",
            "subrecord",
          ),
        };
      });

      return { data, total, page: query.page, limit: query.limit };
    },

    async listPeople() {
      const client = getClient();
      const result = await client.execute(sql`
        SELECT u.id, u.first_name, u.last_name, u.email
        FROM users u
        WHERE EXISTS (
          SELECT 1 FROM entity_metadata m
            WHERE m.context_id IN (${sql.join(
              listMetadataRecordContexts().map((entry) => sql`${entry.contextId}`),
              sql`, `,
            )})
              AND (m.created_by = u.id
             OR m.modified_by = u.id
              OR m.subrecord_modified_by = u.id)
        )
        ORDER BY u.last_name NULLS LAST, u.first_name NULLS LAST, u.email
      `);
      return (result.rows ?? []).map((raw) => {
        const row = raw as Record<string, unknown>;
        const name =
          [row.first_name, row.last_name]
            .filter((part) => typeof part === "string" && part.trim() !== "")
            .join(" ") ||
          (typeof row.email === "string" ? row.email : "") ||
          String(row.id);
        return { id: String(row.id), name };
      });
    },

    async countMissing(contextId) {
      const verdict = await admitContext(contextId);
      if (!verdict.sweepable) {
        return { contextId, countable: false, reason: verdict.reason };
      }
      const tableName = verdict.tableName!;

      const client = getClient();
      // `id::text` because a record id column is varchar in most of this
      // schema but a real `uuid` in places, and Postgres has no
      // `uuid = varchar`. This is the same join the orphan sweep runs, read
      // from the other side. What it counts is what the backfill would write,
      // which is why both share one predicate.
      const result = await client.execute(sql`
        SELECT count(*)::int AS missing
        FROM ${sql.raw(`"${tableName}"`)} t
        WHERE ${missingHistory}
      `);
      const missing = Number((result.rows?.[0] as Record<string, unknown>)?.missing ?? 0);
      return { contextId, countable: true, missing };
    },

    async backfill(contextId, limit) {
      const verdict = await admitContext(contextId);
      if (!verdict.sweepable) {
        throw new Error(
          `Cannot fill in record history for "${contextId}": ${verdict.reason}`,
        );
      }
      const tableName = verdict.tableName!;

      const capped = Math.max(1, Math.min(limit, BACKFILL_BATCH_LIMIT));
      const client = getClient();
      const candidates = await client.execute(sql`
        SELECT t.id::text AS id
        FROM ${sql.raw(`"${tableName}"`)} t
        WHERE ${missingHistory}
        LIMIT ${capped}
      `);

      // The moment the backfill met these records. One timestamp for the run
      // rather than one per row: they were all first seen by the same pass,
      // and pretending otherwise would invent a spread of times that means
      // nothing.
      const observedAt = new Date();
      let written = 0;
      let alreadyPresent = 0;
      let skipped = 0;

      for (const raw of candidates.rows ?? []) {
        const entityId = String((raw as Record<string, unknown>).id);
        // Nothing should reach here: the candidate query already asked the
        // database for record-shaped ids only. Kept as the last word on what
        // may be filed under an id, and counted so that a disagreement
        // between the two spellings of that rule shows up in the result
        // rather than as a batch that quietly writes nothing.
        if (!isRecordId(entityId)) {
          skipped += 1;
          continue;
        }
        const created = await entityMetadataStorage.recordFirstObservation({
          tableName,
          entityId,
          at: observedAt,
        });
        if (created) written += 1;
        else alreadyPresent += 1;
      }

      const after = await this.countMissing(contextId);
      return {
        contextId,
        written,
        alreadyPresent,
        skipped,
        missing: after.countable ? after.missing : 0,
      };
    },
  };
}
