import { sql, type SQL, type AnyColumn } from "drizzle-orm";
import { isPlainTableIdentifier } from "./entity-metadata-tables";
import { getMetadataContextForTable } from "../entity-metadata-record-tables";

/**
 * Ordering a table's records by WHEN they were made or last changed, now that
 * the answer lives in `entity_metadata` rather than in the table's own
 * `created_at` / `updated_at` column.
 *
 * `docs/provenance-columns.md` gives the rule these helpers exist to carry
 * out: a read that only DISPLAYS the date uses the record-history surface, and
 * a read that SORTS or FILTERS on it reads provenance, joined on the record
 * id. This is that join, written once so every such ordering says the same
 * thing the same way.
 *
 * Two properties worth knowing at a call site:
 *
 *  - **It is a correlated scalar subquery, not a join.** `entity_metadata`
 *    holds one row per record under a UNIQUE `entity_id`, so the lookup is a
 *    single index probe and the expression drops into an existing `ORDER BY`
 *    without disturbing the shape of the query around it.
 *  - **It can be NULL.** Provenance is maintained best-effort, off the
 *    caller's transaction, so a record written moments ago — or one whose
 *    provenance write failed — has none yet. Every caller therefore says
 *    `NULLS LAST` (or `NULLS FIRST`) explicitly and follows the date with a
 *    stable tiebreak, so the ordering is total either way. The bespoke columns
 *    these replace were `NOT NULL`, and pretending otherwise here would just
 *    move the ambiguity somewhere quieter.
 */

/** The table name is going into SQL text, so it has to be plainly a name. */
function tableLiteral(tableName: string): string {
  if (!isPlainTableIdentifier(tableName)) {
    throw new Error(
      `Refusing to order by provenance: "${tableName}" is not a plain identifier`,
    );
  }
  return tableName;
}

function contextLiteral(tableName: string): string {
  const context = getMetadataContextForTable(tableName);
  if (!context) {
    throw new Error(`Refusing to order by provenance: "${tableName}" has no metadata context`);
  }
  return context.contextId;
}

/**
 * When each record was created, per its provenance row.
 *
 * @param tableName raw table the records live in (e.g. `contact_phone`)
 * @param recordId  expression naming the record's own id in the query around
 *                  it — a column, or `sql` naming an alias (`sql\`p.id\``)
 */
export function provenanceCreatedDate(
  tableName: string,
  recordId: SQL | AnyColumn,
): SQL {
  tableLiteral(tableName);
  const context = contextLiteral(tableName);
  return sql`(
    SELECT em.created_date FROM entity_metadata em
    WHERE em.context_id = ${context} AND em.entity_id = (${recordId})::text
  )`;
}

/**
 * When each record last changed, per its provenance row.
 *
 * Note what this counts as a change: a mutation the storage logging middleware
 * saw, per record. A bulk statement that swept many rows at once has no
 * per-record log entry and therefore does not advance this — which is the
 * honest reading of "last changed" for a record, but it is not identical to a
 * `updated_at` column bumped by every statement that touched the row.
 */
export function provenanceModifiedDate(
  tableName: string,
  recordId: SQL | AnyColumn,
): SQL {
  tableLiteral(tableName);
  const context = contextLiteral(tableName);
  return sql`(
    SELECT em.modified_date FROM entity_metadata em
    WHERE em.context_id = ${context} AND em.entity_id = (${recordId})::text
  )`;
}
