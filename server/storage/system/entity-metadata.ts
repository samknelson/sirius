import { sql } from "drizzle-orm";
import { getClient } from "../transaction-context";
import { storageLogger } from "../../logger";
import type { SnapshotRecordMetadata } from "@shared/snapshots";
import {
  isPlainTableIdentifier,
  isRecordId,
  judgeSweepTable,
  type TableFacts,
  type TableVerdict,
} from "./entity-metadata-tables";

/**
 * Provenance rows for the `entity_metadata` table: one row per record, keyed
 * by the record's own id.
 *
 * Everything here is **best effort**. The storage logging middleware calls
 * these after the mutation has already returned, outside the caller's
 * transaction, and swallows failures — a metadata row that never gets written
 * costs nothing but the metadata.
 *
 * Two properties this module protects, because nothing else can:
 *
 *  - **`seq` permanently names one record.** `context_id` is written once, at
 *    insert, and never rewritten. A write naming a different table for an id
 *    we already know is refused and reported rather than applied.
 *  - **Stamps only move forward.** Callers are deferred and unordered, so a
 *    write carrying an older timestamp than the row already holds must not
 *    win. The comparison happens in SQL, so concurrent writers racing on the
 *    same row still settle on the newest.
 *  - **A row always has a created date and a modified date.** Any write that
 *    creates or updates a row fills in whichever of the two is still empty,
 *    at the moment of that write. Only the DATES are guaranteed: the person
 *    stays unknown when it is unknown, because a first sighting says when we
 *    noticed the record, never who made it or last changed it. This is why a
 *    subrecord touch — which reaches a record we may never have seen touched
 *    itself — still stamps a modified date and no modifier.
 *
 * This module is deliberately NOT wrapped in storage logging: it is the thing
 * logging calls. That also means its own removals leave no audit entry, so the
 * orphan sweep below reports what it removed in its run summary instead.
 *
 * Reads are only ever ABOUT the table, never through it: one record's
 * provenance (for display), and the sweep's view of which rows have outlived
 * the record they name. Nothing here is a source of business data.
 */

// The id-shape and table-acceptance rules live one file down, dependency-free
// (./entity-metadata-tables.ts). Re-exported here because this module is where
// callers already look for them.
export { isRecordId } from "./entity-metadata-tables";
export type { TableVerdict } from "./entity-metadata-tables";

/**
 * Whether a write may proceed for this id, reporting the ones that look like
 * a mistake. An absent id means the caller had nothing to offer (an error
 * path, a method that identifies nothing) and is passed over in silence; a
 * *present* id that is not a record id is a mislabeled logging config, and
 * says so.
 */
function acceptsId(
  entityId: unknown,
  tableName: string,
  operation: string,
): entityId is string {
  if (isRecordId(entityId)) return true;
  if (typeof entityId === "string" && entityId.trim() !== "") {
    reportRefusal("logged entity id is not a record id", {
      entityId,
      tableName,
      operation,
    });
  }
  return false;
}

export interface EntityMetadataTouch {
  /** Raw database table the record lives in. */
  tableName: string;
  /** The record's own id. */
  entityId: string;
  /** When the mutation completed — captured at the call site, not here. */
  at: Date;
  /** Effective acting user, or null for work with no request behind it. */
  actorId?: string | null;
}

/** One date/person pair, as read back for display. */
export interface EntityMetadataStamp {
  date: Date | null;
  /** Display name of the person, or null when nobody was recorded. */
  personName: string | null;
}

/** A record's provenance, with the people it names resolved to display names. */
export interface EntityMetadataView {
  seq: number;
  rev: number;
  contextId: string;
  entityId: string;
  created: EntityMetadataStamp;
  modified: EntityMetadataStamp;
  subrecordModified: EntityMetadataStamp;
}

export interface EntityMetadataStorage {
  /**
   * One record's provenance, or undefined when nothing has been recorded for
   * it — which is the normal state for every record that predates this
   * framework and has not been touched since.
   *
   * This is the module's only read of a record's own provenance, and it has
   * no write counterpart beyond the system-maintained ones below: provenance
   * is written by the mutation that caused it and by nothing else. (The
   * orphan sweep's reads, further down, are about rows whose record is gone.)
   */
  get(entityId: string): Promise<EntityMetadataView | undefined>;

  /** One provenance row by its metadata-row UUID. */
  getByMetadataId(metadataId: string): Promise<EntityMetadataView | undefined>;

  /** One provenance row by its database-wide sequence number. */
  getBySequence(seq: number): Promise<EntityMetadataView | undefined>;

  /**
   * The same read for a page of records at once, keyed by record id.
   *
   * A list that shows each row's creation date would otherwise ask for one
   * record at a time, and the answer is the same shape either way. Ids with
   * nothing recorded are simply absent from the map.
   */
  getMany(entityIds: string[]): Promise<Map<string, EntityMetadataView>>;

  /**
   * Project the metadata row as it will look after one save, without writing
   * it. Metadata maintenance is deferred until commit, but snapshot capture
   * runs inside that save's transaction. Returning the projected row keeps
   * the snapshot aligned with the payload while preserving best-effort
   * metadata maintenance.
   *
   * A missing row remains null: this method must not invent provenance for a
   * record whose history has not been observed.
   */
  getSnapshotMetadata(
    entityId: string,
  ): Promise<SnapshotRecordMetadata | null>;

  /**
   * Record a mutation OF the record itself.
   *
   * `created` marks the mutation as the record's creation, which is the only
   * way `created_by` is ever filled in: a record first met mid-life gets a
   * `created_date` (the first sighting, an upper bound on the real creation)
   * but no creator, because we did not see who made it.
   */
  recordMutation(touch: EntityMetadataTouch & { created?: boolean }): Promise<void>;

  /**
   * Record a mutation of one of the record's CHILDREN. Advances only the
   * `subrecord_modified_*` pair — the record itself did not change.
   */
  recordSubrecordTouch(touch: EntityMetadataTouch): Promise<void>;

  /**
   * Note that a record exists, without claiming to know anything about how it
   * got that way — the backfill's write, for records that predate this
   * framework entirely.
   *
   * Stamps created and modified at the moment of observation and names nobody,
   * which is what the framework already says about a record it meets mid-life.
   * A record that already has provenance keeps it untouched: `false` comes
   * back and nothing is written.
   */
  recordFirstObservation(
    input: Pick<EntityMetadataTouch, "tableName" | "entityId" | "at">,
  ): Promise<boolean>;

  /**
   * Forget a record. Its `seq` goes with it; a record re-created under the
   * same id would be a different entity and gets a new one.
   */
  recordDeletion(input: Pick<EntityMetadataTouch, "tableName" | "entityId">): Promise<void>;

  /**
   * Every table currently named by a provenance row — the sweep's worklist.
   * Read from the rows themselves rather than from the logging configs: a row
   * can outlive the config that wrote it, and it is the row that has to go.
   */
  listContexts(): Promise<string[]>;

  /**
   * Whether provenance rows naming this table may be swept against it. See
   * `./entity-metadata-tables.ts` for the rule; this only gathers the facts
   * the rule is decided on.
   */
  checkContext(contextId: string): Promise<TableVerdict>;

  /**
   * Ids of the provenance rows in one table whose record is gone, capped at
   * `limit` so one sweep cannot run long.
   *
   * Only for a registered context `checkContext` has approved — it refuses anything else
   * rather than trusting its caller, because the name goes into SQL text.
   */
  findOrphans(contextId: string, limit: number): Promise<string[]>;

  /**
   * Forget provenance rows the sweep found orphaned, returning how many rows
   * actually went.
   *
   * Goes through the same per-id serialization and forgotten-window path as
   * `recordDeletion`: a sweep delete must not overtake — or be overtaken by —
   * a write still queued for that id in this process.
   */
  removeOrphans(contextId: string, entityIds: string[]): Promise<number>;
}

/**
 * Report a write we refused. Goes to `storageLogger` rather than the app
 * logger so it reaches the admin log viewer — a refusal means some caller is
 * handing over the wrong id, which is a defect someone has to see. No
 * recursion risk: this module is never itself logged.
 */
function reportRefusal(reason: string, detail: Record<string, unknown>): void {
  storageLogger.warn(`Entity metadata: ${reason}`, {
    module: "entityMetadata",
    operation: "refused",
    description: reason,
    meta: detail,
  });
}

async function resolveContextForTable(
  tableName: string,
  operation: string,
): Promise<{ contextId: string; tableName: string } | undefined> {
  // Lazy import avoids a cycle: the registry inspects storage logging configs,
  // while the logging middleware calls this storage module.
  const { getMetadataContextForTable } = await import("../entity-metadata-record-tables");
  const context = getMetadataContextForTable(tableName);
  if (!context) {
    reportRefusal("logged table has no eligible metadata context", { tableName, operation });
    return undefined;
  }
  return { contextId: context.contextId, tableName: context.tableName };
}

async function isKnownContext(contextId: string): Promise<boolean> {
  const { isMetadataRecordContext } = await import("../entity-metadata-record-tables");
  return isMetadataRecordContext(contextId);
}

/**
 * The work in flight for one record. Maintenance for a given id runs one
 * operation at a time, in the order the operations reached this module.
 *
 * The callers are deferred and unordered: an edit and the delete that follows
 * it can arrive here in either order, and two statements racing in the
 * database settle by whichever lands last — a deleted record's row
 * resurrected, or a live record's row missing. Ordering the work per id
 * inside the process removes the race in the case that produces it (both
 * mutations came from this process), and lets a deletion speak for the whole
 * window: once a record is forgotten, writes still queued behind it are for a
 * record that no longer exists and are dropped.
 *
 * The entry is discarded as soon as its queue drains, so this holds only the
 * ids currently being written.
 */
interface EntityQueue {
  /** Resolves when the last operation queued so far has finished. */
  tail: Promise<void>;
  /** Operations queued and not yet finished. */
  outstanding: number;
  /** A deletion has run in this window. */
  forgotten: boolean;
}

const queues = new Map<string, EntityQueue>();

function serialize(
  entityId: string,
  run: (queue: EntityQueue) => Promise<void>,
): Promise<void> {
  const queue: EntityQueue = queues.get(entityId) ?? {
    tail: Promise.resolve(),
    outstanding: 0,
    forgotten: false,
  };
  queues.set(entityId, queue);
  queue.outstanding += 1;

  const finished = queue.tail.then(() => run(queue));
  // The chain must survive a failed operation, so the queue's own handle on it
  // ignores the rejection; the caller still receives it.
  queue.tail = finished.then(
    () => undefined,
    () => undefined,
  );
  return finished.finally(() => {
    queue.outstanding -= 1;
    if (queue.outstanding === 0 && queues.get(entityId) === queue) {
      queues.delete(entityId);
    }
  });
}

/**
 * Display name from a joined user row: "First Last", falling back to whichever
 * half exists, then the email.
 *
 * The notes module states the same rule, and this one deliberately restates it
 * rather than importing it: everything in this file has to stay a leaf, since
 * the logging middleware imports it and the notes module imports the logging
 * middleware.
 */
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
  personPrefix: string,
): EntityMetadataStamp {
  const raw = row[dateColumn];
  const date =
    raw instanceof Date ? raw : typeof raw === "string" ? new Date(raw) : null;
  return { date, personName: personNameFrom(row, personPrefix) };
}

/**
 * The one read of a provenance row for display, with the three people it can
 * name resolved. Shared by the single-record and many-record reads so the two
 * cannot drift into answering differently; each supplies its own WHERE.
 */
const VIEW_SELECT = sql`
  SELECT
    m.seq, m.rev, m.context_id, m.entity_id,
    m.created_date, m.modified_date, m.subrecord_modified_date,
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
`;

function viewFrom(row: Record<string, unknown>): EntityMetadataView {
  return {
    seq: Number(row.seq),
    rev: Number(row.rev),
    contextId: String(row.context_id),
    entityId: String(row.entity_id),
    created: stampFrom(row, "created_date", "created"),
    modified: stampFrom(row, "modified_date", "modified"),
    subrecordModified: stampFrom(row, "subrecord_modified_date", "subrecord"),
  };
}

function snapshotStamp(stamp: EntityMetadataStamp): {
  date: string | null;
  personName: string | null;
} {
  return {
    date: stamp.date?.toISOString() ?? null,
    personName: stamp.personName,
  };
}

export function snapshotMetadataFromView(
  metadata: EntityMetadataView,
): SnapshotRecordMetadata {
  return {
    seq: metadata.seq,
    rev: metadata.rev,
    contextId: metadata.contextId,
    entityId: metadata.entityId,
    created: snapshotStamp(metadata.created),
    modified: snapshotStamp(metadata.modified),
    subrecordModified: snapshotStamp(metadata.subrecordModified),
  };
}

/** How many of a table's own ids the sweep looks at before trusting its key. */
const SAMPLE_SIZE = 20;

/**
 * Core migration 1105 runs after 1104, while the application may already
 * have deferred storage-log callbacks queued from bring-up. Do not let one
 * of those callbacks issue a new-column write into the old schema. A false
 * result is deliberately not cached: the next callback rechecks after the
 * rename, while the successful state is cached for the normal hot path.
 */
let contextIdColumnAvailable: boolean | undefined;

async function hasContextIdColumn(): Promise<boolean> {
  if (contextIdColumnAvailable === true) return true;
  const client = getClient();
  const result = await client.execute(sql`
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'entity_metadata'
      AND column_name = 'context_id'
    LIMIT 1
  `);
  contextIdColumnAvailable = (result.rows?.length ?? 0) > 0;
  return contextIdColumnAvailable;
}

/**
 * Forget one record's provenance, reporting whether a row went.
 *
 * The ONE definition of "forget this record", shared by the logged delete the
 * middleware observes and by the orphan sweep. Both need the same window:
 * marking the queue forgotten drops writes still queued for this id, which is
 * what stops a deferred edit from resurrecting a row the sweep just removed.
 */
async function forget(contextId: string, entityId: string): Promise<boolean> {
  if (!(await hasContextIdColumn())) return false;
  let removed = false;
  await serialize(entityId, async (queue) => {
    // Anything still queued for this id is a write about a record that no
    // longer exists.
    queue.forgotten = true;
    const client = getClient();
    const result = await client.execute(sql`
      DELETE FROM entity_metadata
      WHERE entity_id = ${entityId} AND context_id = ${contextId}
    `);
    removed = (result.rowCount ?? result.rows?.length ?? 0) > 0;
  });
  return removed;
}

export function createEntityMetadataStorage(): EntityMetadataStorage {
  /**
   * Report the table disagreement behind a no-op upsert. Only reached when the
   * conflict path's guard rejected the write, so the extra read costs nothing
   * on the normal path.
   */
  async function reportTableMismatch(
    contextId: string,
    entityId: string,
  ): Promise<void> {
    const client = getClient();
    const existing = await client.execute(
      sql`SELECT context_id FROM entity_metadata WHERE entity_id = ${entityId}`,
    );
    const held = existing.rows?.[0]?.context_id;
    reportRefusal("record id already belongs to another metadata context", {
      entityId,
      declaredContext: contextId,
      storedContext: held ?? null,
    });
  }

  return {
    async get(entityId) {
      if (!isRecordId(entityId)) return undefined;
      const client = getClient();
      const result = await client.execute(sql`
        ${VIEW_SELECT} WHERE m.entity_id = ${entityId}
      `);
      const row = result.rows?.[0] as Record<string, unknown> | undefined;
      return row && (await isKnownContext(String(row.context_id))) ? viewFrom(row) : undefined;
    },

    async getByMetadataId(metadataId) {
      if (!isRecordId(metadataId)) return undefined;
      const client = getClient();
      const result = await client.execute(sql`
        ${VIEW_SELECT} WHERE m.id = ${metadataId}
      `);
      const row = result.rows?.[0] as Record<string, unknown> | undefined;
      return row && (await isKnownContext(String(row.context_id))) ? viewFrom(row) : undefined;
    },

    async getBySequence(seq) {
      if (!Number.isSafeInteger(seq) || seq <= 0) return undefined;
      const client = getClient();
      const result = await client.execute(sql`
        ${VIEW_SELECT} WHERE m.seq = ${seq}
      `);
      const row = result.rows?.[0] as Record<string, unknown> | undefined;
      return row && (await isKnownContext(String(row.context_id))) ? viewFrom(row) : undefined;
    },

    async getMany(entityIds) {
      const byId = new Map<string, EntityMetadataView>();
      const ids = Array.from(new Set(entityIds.filter(isRecordId)));
      if (ids.length === 0) return byId;
      const client = getClient();
      // An IN list rather than `= ANY(array)`: the tagged template binds a JS
      // array as one parameter, which Postgres will not take on the right of
      // ANY.
      const result = await client.execute(sql`
        ${VIEW_SELECT}
        WHERE m.entity_id IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})
      `);
      for (const raw of result.rows ?? []) {
        const view = viewFrom(raw as Record<string, unknown>);
        if (await isKnownContext(view.contextId)) byId.set(view.entityId, view);
      }
      return byId;
    },

    async getSnapshotMetadata(entityId) {
      const metadata = await this.get(entityId);
      if (!metadata) return null;
      return snapshotMetadataFromView(metadata);
    },

    async recordMutation({ tableName, entityId, at, actorId, created }) {
      if (!(await hasContextIdColumn())) return;
      const context = await resolveContextForTable(tableName, "mutation");
      if (!context) return;
      const contextId = context.contextId;
      if (!acceptsId(entityId, tableName, "mutation")) return;
      return serialize(entityId, async (queue) => {
        if (queue.forgotten) return;
        const client = getClient();
        const createdBy = created ? (actorId ?? null) : null;
        const result = await client.execute(sql`
          INSERT INTO entity_metadata (
            context_id, entity_id,
            created_date, created_by,
            modified_date, modified_by
          )
          VALUES (
            ${contextId}, ${entityId},
            ${at}, ${createdBy},
            ${at}, ${actorId ?? null}
          )
          ON CONFLICT (entity_id) DO UPDATE SET
            rev = entity_metadata.rev + 1,
            created_date = LEAST(entity_metadata.created_date, EXCLUDED.created_date),
            created_by = COALESCE(entity_metadata.created_by, EXCLUDED.created_by),
            modified_date = GREATEST(entity_metadata.modified_date, EXCLUDED.modified_date),
            modified_by = CASE
              WHEN entity_metadata.modified_date IS NULL
                OR entity_metadata.modified_date <= EXCLUDED.modified_date
              THEN EXCLUDED.modified_by
              ELSE entity_metadata.modified_by
            END
          WHERE entity_metadata.context_id = EXCLUDED.context_id
          RETURNING id
        `);
        if ((result.rowCount ?? result.rows?.length ?? 0) === 0) {
          await reportTableMismatch(contextId, entityId);
        }
      });
    },

    async recordSubrecordTouch({ tableName, entityId, at, actorId }) {
      if (!(await hasContextIdColumn())) return;
      const context = await resolveContextForTable(tableName, "subrecord touch");
      if (!context) return;
      const contextId = context.contextId;
      if (!acceptsId(entityId, tableName, "subrecord touch")) return;
      return serialize(entityId, async (queue) => {
        if (queue.forgotten) return;
        const client = getClient();
        const result = await client.execute(sql`
          INSERT INTO entity_metadata (
            context_id, entity_id,
            created_date,
            modified_date,
            subrecord_modified_date, subrecord_modified_by
          )
          VALUES (
            ${contextId}, ${entityId},
            ${at},
            ${at},
            ${at}, ${actorId ?? null}
          )
          ON CONFLICT (entity_id) DO UPDATE SET
            rev = entity_metadata.rev + 1,
            created_date = LEAST(entity_metadata.created_date, EXCLUDED.created_date),
            -- The record itself did not change, so the modified stamp is not
            -- advanced and no modifier is named. It is only FILLED IN when it
            -- is still empty: the row must never hold an empty created or
            -- modified date, and this is the one write that can create a row
            -- for a record whose own mutations we have never observed.
            modified_date = COALESCE(entity_metadata.modified_date, EXCLUDED.modified_date),
            subrecord_modified_date = GREATEST(
              entity_metadata.subrecord_modified_date,
              EXCLUDED.subrecord_modified_date
            ),
            subrecord_modified_by = CASE
              WHEN entity_metadata.subrecord_modified_date IS NULL
                OR entity_metadata.subrecord_modified_date <= EXCLUDED.subrecord_modified_date
              THEN EXCLUDED.subrecord_modified_by
              ELSE entity_metadata.subrecord_modified_by
            END
          WHERE entity_metadata.context_id = EXCLUDED.context_id
          RETURNING id
        `);
        if ((result.rowCount ?? result.rows?.length ?? 0) === 0) {
          await reportTableMismatch(contextId, entityId);
        }
      });
    },

    async recordFirstObservation({ tableName, entityId, at }) {
      if (!(await hasContextIdColumn())) return false;
      const context = await resolveContextForTable(tableName, "first observation");
      if (!context) return false;
      const contextId = context.contextId;
      if (!acceptsId(entityId, tableName, "first observation")) return false;
      let written = false;
      await serialize(entityId, async (queue) => {
        if (queue.forgotten) return;
        const client = getClient();
        // DO NOTHING, not DO UPDATE: a record that gained real provenance
        // between being counted as missing and being written here keeps it.
        // An observation is the weakest thing this table can hold and must
        // never displace something better.
        const result = await client.execute(sql`
          INSERT INTO entity_metadata (
            context_id, entity_id,
            created_date, modified_date
          )
          VALUES (
            ${contextId}, ${entityId},
            ${at}, ${at}
          )
          ON CONFLICT (entity_id) DO NOTHING
          RETURNING id
        `);
        written = (result.rowCount ?? result.rows?.length ?? 0) > 0;
      });
      return written;
    },

    async recordDeletion({ tableName, entityId }) {
      if (!(await hasContextIdColumn())) return;
      const context = await resolveContextForTable(tableName, "deletion");
      if (!context) return;
      if (!acceptsId(entityId, tableName, "deletion")) return;
      await forget(context.contextId, entityId);
    },

    async listContexts() {
      const client = getClient();
      const result = await client.execute(sql`
        SELECT DISTINCT context_id FROM entity_metadata ORDER BY context_id
      `);
      const contextIds = (result.rows ?? []).map((row) =>
        String((row as Record<string, unknown>).context_id),
      );
      const known = await Promise.all(contextIds.map(async (contextId) => [contextId, await isKnownContext(contextId)] as const));
      return known.filter(([, present]) => present).map(([contextId]) => contextId);
    },

    async checkContext(contextId) {
      const context = await import("../entity-metadata-record-tables").then(({ getMetadataRecordContext }) =>
        getMetadataRecordContext(contextId),
      );
      if (!context) return { sweepable: false, reason: "not a registered metadata context" };
      const tableName = context.tableName;
      // The name is data, so nothing may be built from it until it has been
      // admitted as an identifier — including the fact-gathering queries.
      if (!isPlainTableIdentifier(tableName)) {
        return judgeSweepTable(tableName, { exists: false, idColumnType: null, sampleIds: [] });
      }

      const client = getClient();
      const catalog = await client.execute(sql`
        SELECT
          EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = ${tableName}
          ) AS table_exists,
          (
            SELECT data_type FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = ${tableName}
              AND column_name = 'id'
          ) AS id_type
      `);
      const row = (catalog.rows?.[0] ?? {}) as Record<string, unknown>;
      const exists = row.table_exists === true || row.table_exists === "t";
      const idColumnType = typeof row.id_type === "string" ? row.id_type : null;

      const facts: TableFacts = { exists, idColumnType, sampleIds: [] };
      if (exists && idColumnType !== null) {
        // Ask the table what its ids actually look like. A declared type of
        // `varchar` says nothing about whether the column holds record ids or
        // slugs, and the difference decides whether an anti-join finds
        // orphans or condemns every row.
        const sample = await client.execute(
          sql`SELECT id::text AS id FROM ${sql.raw(`"${tableName}"`)} WHERE id IS NOT NULL LIMIT ${SAMPLE_SIZE}`,
        );
        facts.sampleIds = (sample.rows ?? []).map((r) =>
          String((r as Record<string, unknown>).id),
        );
      }
      return judgeSweepTable(tableName, facts);
    },

    async findOrphans(contextId, limit) {
      const context = await import("../entity-metadata-record-tables").then(({ getMetadataRecordContext }) =>
        getMetadataRecordContext(contextId),
      );
      if (!context) {
        throw new Error(`Refusing to sweep entity_metadata against "${contextId}": not a registered metadata context`);
      }
      const tableName = context.tableName;
      if (!isPlainTableIdentifier(tableName)) {
        throw new Error(`Refusing to sweep entity_metadata against "${tableName}": not a table name`);
      }
      const client = getClient();
      // `id::text` because the record id columns in this schema are varchar
      // but a table may key on a real `uuid`, and Postgres has no `uuid = varchar`.
      const result = await client.execute(sql`
        SELECT m.entity_id
        FROM entity_metadata m
        WHERE m.context_id = ${contextId}
          AND NOT EXISTS (
            SELECT 1 FROM ${sql.raw(`"${tableName}"`)} t WHERE t.id::text = m.entity_id
          )
        LIMIT ${limit}
      `);
      return (result.rows ?? []).map((row) =>
        String((row as Record<string, unknown>).entity_id),
      );
    },

    async removeOrphans(contextId, entityIds) {
      let removed = 0;
      for (const entityId of entityIds) {
        if (!isRecordId(entityId)) continue;
        if (await forget(contextId, entityId)) removed += 1;
      }
      return removed;
    },
  };
}

/**
 * The one instance. Held here rather than on `IStorage` because its only
 * caller is the logging middleware, which `database.ts` imports — reaching
 * back through the composed storage object would be a cycle.
 */
export const entityMetadataStorage = createEntityMetadataStorage();
