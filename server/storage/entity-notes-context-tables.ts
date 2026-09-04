import { workers, employers, trustProviders, grievances } from "@shared/schema";
import {
  getEntityNoteContext,
  listEntityNoteContexts,
} from "../services/entity-notes/registry";
import { isComponentEnabledSync } from "../services/component-cache";
import type { PgTable, TableConfig } from "drizzle-orm/pg-core";

/**
 * Table bindings for the note contexts: maps each registered note context
 * (server/modules/entity-notes-contexts.ts) to the table that holds its
 * records.
 *
 * This exists for the orphan sweep alone. Per-record existence is answered by
 * the context's own `entityExists`; a sweep needs an anti-join, which no
 * per-record callback can express, so the table itself has to be nameable.
 */
export const noteContextTables: Record<string, PgTable<TableConfig>> = {
  worker: workers,
  employer: employers,
  trust_provider: trustProviders,
  grievance: grievances,
};

/**
 * Every registered context must have a table binding. A context declared
 * without one is a wiring bug — fail fast at boot rather than letting the
 * sweep silently skip that context's orphans.
 */
export function assertNoteContextTablesComplete(): void {
  const missing = listEntityNoteContexts()
    .filter((c) => !noteContextTables[c.id])
    .map((c) => c.id);
  if (missing.length > 0) {
    throw new Error(
      `Note contexts missing a table binding in server/storage/entity-notes-context-tables.ts: ${missing.join(", ")}`,
    );
  }
}

/**
 * Is this context's table queryable right now?
 *
 * A record type owned by a component that manages its own schema (grievances,
 * for one) has NO TABLE AT ALL while that component is disabled — the tables
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
  if (!context || !noteContextTables[contextId]) return false;
  if (!context.component) return true;
  return isComponentEnabledSync(context.component);
}
