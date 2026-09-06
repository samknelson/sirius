/**
 * The two shape rules `entity_metadata` is held to: what counts as a record
 * id, and which tables a provenance row may name safely enough to sweep
 * against.
 *
 * Deliberately dependency-free — no database client, no logger. The storage
 * module below it is already a leaf (the logging middleware imports it), and
 * these rules are the part worth deciding without a database in the room.
 */

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The same rule as {@link isRecordId}, spelled for Postgres.
 *
 * A query that asks "which records could carry a history" has to ask it of
 * the database rather than of each row in turn, and it must get the same
 * answer {@link isRecordId} would give — otherwise a record can be counted as
 * missing a history that nothing is ever able to write, and it stays counted
 * forever. Case-insensitively matched at the call site (`~*`), which is what
 * makes this equivalent to the `i` flag above.
 *
 * It lives here, beside the pattern it mirrors, so the two are changed
 * together or not at all.
 */
export const RECORD_ID_SQL_PATTERN =
  "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$";

/**
 * Whether an id is shaped like the record ids `entity_metadata` indexes.
 *
 * Log entries carry an `entity_id` that is only *usually* the record's own id
 * — some configs report a parent's id, a placeholder ("new address"), or a
 * batch summary ("batch of 12"). Filing those under `entity_id` would attach
 * one record's provenance to another's, so anything that is not a UUID is
 * dropped before it reaches the table.
 */
export function isRecordId(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

/**
 * A plain lowercase table identifier: the only spelling the orphan sweep will
 * put into SQL text.
 *
 * The registry context id is DATA. Physical table names used in SQL are
 * admitted only after the context registry has resolved them and they look
 * exactly like the unquoted identifiers this schema uses.
 */
export function isPlainTableIdentifier(name: string): boolean {
  return /^[a-z][a-z0-9_]*$/.test(name) && name.length <= 63;
}

export { isMetadataTableEligible } from "./entity-metadata-policy";

/** Column types whose values can be a record id. */
const RECORD_ID_COLUMN_TYPES = new Set(["uuid", "character varying", "text"]);

/** What the catalog and the table's own rows say about one named table. */
export interface TableFacts {
  /** A table of this name exists in the `public` schema. */
  exists: boolean;
  /**
   * `information_schema` type of the column named `id`, or null when the
   * table has no such column.
   */
  idColumnType: string | null;
  /**
   * A handful of ids read from the table, as text. Empty for a table with no
   * rows — which is not evidence against it: an empty table genuinely owns no
   * records, so every provenance row naming it IS orphaned.
   */
  sampleIds: string[];
}

/** Whether a table may be swept, and — when it may not — what to report. */
export type TableVerdict = { sweepable: true } | { sweepable: false; reason: string };

/**
 * Decide whether provenance rows naming this table may be anti-joined against
 * it.
 *
 * This is the whole safety of the metadata orphan sweep. An anti-join against
 * the WRONG table, or against a column that does not hold record ids, makes
 * every one of that table's provenance rows look orphaned and deletes the lot.
 * So each refusal is conservative: a table we cannot vouch for is skipped and
 * named in the run summary, never swept. Leaving orphans behind costs a few
 * stale rows; deleting live provenance costs a record's whole history.
 */
export function judgeSweepTable(tableName: string, facts: TableFacts): TableVerdict {
  if (!isPlainTableIdentifier(tableName)) {
    return { sweepable: false, reason: "not a plain table name" };
  }
  if (!facts.exists) {
    // A component that owns its own schema has no tables at all while it is
    // switched off, and a dropped table looks the same from here. Neither is
    // evidence that the records are gone.
    return { sweepable: false, reason: "no such table (component disabled, or dropped)" };
  }
  if (facts.idColumnType === null) {
    return { sweepable: false, reason: "no id column to join on" };
  }
  if (!RECORD_ID_COLUMN_TYPES.has(facts.idColumnType)) {
    return {
      sweepable: false,
      reason: `id column is ${facts.idColumnType}, which cannot hold a record id`,
    };
  }
  const stranger = facts.sampleIds.find((id) => !isRecordId(id));
  if (stranger !== undefined) {
    // A text key that is not a record id (a slug, a code, a composite) —
    // joining on it would match nothing and orphan the whole table.
    return { sweepable: false, reason: "id column does not hold record ids" };
  }
  return { sweepable: true };
}
