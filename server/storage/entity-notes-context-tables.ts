import { getEntityNoteContext } from "../services/entity-notes/registry";
import { isComponentEnabledSync } from "../services/component-cache";
import type { PgTable, TableConfig } from "drizzle-orm/pg-core";

/**
 * The table holding a registered note context's records, as declared on the
 * context registration. Used by the orphan sweep alone: per-record existence
 * is answered by the context's own `entityExists`, but a sweep needs an
 * anti-join, which no per-record callback can express.
 */
export function getNoteContextTable(contextId: string): PgTable<TableConfig> | undefined {
  return getEntityNoteContext(contextId)?.table;
}

/**
 * Is this context's table queryable right now?
 *
 * A record type owned by a component that manages its own schema has NO TABLE AT ALL while that component is disabled — the tables
 * are created when it is switched on. Querying such a table throws
 * "relation does not exist", so the orphan sweep must ask this first and skip
 * the context when it answers false. The rule is registry-driven: any future
 * component-owned context inherits it by declaring `component`.
 *
 * Note this asks only about the TABLE, not about whether an operator has
 * switched notes on for the area (see server/modules/entity-contexts.ts).
 * Notes already stored in a switched-off area are still swept when their
 * record is deleted.
 */
export function isNoteContextAvailable(contextId: string): boolean {
  const context = getEntityNoteContext(contextId);
  if (!context) return false;
  if (!context.component) return true;
  return isComponentEnabledSync(context.component);
}
