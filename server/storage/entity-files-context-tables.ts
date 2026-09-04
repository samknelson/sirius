import { workers, employers, trustProviders, grievances } from "@shared/schema";
import {
  getEntityFileContext,
  listEntityFileContexts,
} from "../services/entity-files/registry";
import { isComponentEnabledSync } from "../services/component-cache";
import type { PgTable, TableConfig } from "drizzle-orm/pg-core";

/**
 * Table bindings for the file contexts: maps each registered file context
 * (server/modules/entity-files-contexts.ts) to the table that holds its
 * records.
 *
 * The twin of server/storage/entity-notes-context-tables.ts, and separate
 * from it on purpose: notes and files are separate registries with their own
 * context ids, both of which are persisted (`entity_notes.context_id`,
 * `entity_files.context_id`), so neither set can be renamed to unify them.
 *
 * This exists for the orphan sweep alone. Per-record existence is answered by
 * the context's own `entityExists`; a sweep needs an anti-join, which no
 * per-record callback can express, so the table itself has to be nameable.
 */
export const fileContextTables: Record<string, PgTable<TableConfig>> = {
  worker: workers,
  employer: employers,
  trust_provider: trustProviders,
  grievance: grievances,
};

/**
 * Every registered context must have a table binding. A context declared
 * without one is a wiring bug — fail fast at boot rather than letting the
 * sweep silently skip that context's orphaned attachments.
 */
export function assertFileContextTablesComplete(): void {
  // Adapter-backed contexts (fork extension) keep their rows in their own
  // tables with real FKs; they have no entity_files rows to sweep.
  const missing = listEntityFileContexts()
    .filter((c) => !c.adapter && !fileContextTables[c.id])
    .map((c) => c.id);
  if (missing.length > 0) {
    throw new Error(
      `File contexts missing a table binding in server/storage/entity-files-context-tables.ts: ${missing.join(", ")}`,
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
 * configured file attachments for the area (see
 * server/services/entity-files/config.ts). Attachments already stored in an
 * unconfigured area are still swept when their record is deleted.
 */
export function isFileContextAvailable(contextId: string): boolean {
  const context = getEntityFileContext(contextId);
  if (!context || context.adapter || !fileContextTables[contextId]) return false;
  if (!context.component) return true;
  return isComponentEnabledSync(context.component);
}
