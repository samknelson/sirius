import { workers, employers, trustProviders, grievances } from "@shared/schema";
import { NOTE_ENTITY_TYPES, getNoteEntityType } from "@shared/notes";
import { isComponentEnabledSync } from "../services/component-cache";
import type { PgTable, TableConfig } from "drizzle-orm/pg-core";

/**
 * Server-side half of the note-entity registry: maps each note-able record
 * type declared in `shared/notes.ts` to the table that holds it.
 *
 * This is the ONLY place a note-able record type is bound to a table. The
 * existence check on save and the orphan sweep both drive off this map, so a
 * new note-able type is one entry here plus one entry in the shared registry.
 */
export const noteEntityTables: Record<string, PgTable<TableConfig>> = {
  worker: workers,
  employer: employers,
  trust_provider: trustProviders,
  grievance: grievances,
};

/**
 * Registered note-able types that have a table binding. Anything declared in
 * the shared registry but missing from `noteEntityTables` is a wiring bug —
 * `assertNoteEntityTablesComplete` fails fast on it at boot rather than
 * letting the sweep silently skip that type's orphans.
 */
export function assertNoteEntityTablesComplete(): void {
  const missing = NOTE_ENTITY_TYPES.filter((t) => !noteEntityTables[t.id]).map((t) => t.id);
  if (missing.length > 0) {
    throw new Error(
      `Note entity types missing a table binding in server/storage/notes-entity-types.ts: ${missing.join(", ")}`,
    );
  }
}

/**
 * Is this record type queryable right now?
 *
 * A record type owned by a component that manages its own schema (grievances,
 * for one) has NO TABLE AT ALL while that component is disabled — the tables
 * are created when it is switched on. Querying such a table throws
 * "relation does not exist", so both the parent-record check and the orphan
 * sweep must ask this first and skip the type when it answers false. The rule
 * is registry-driven, not per-type: any future component-owned record type
 * inherits it by declaring `requiredComponent`.
 */
export function isNoteEntityTypeAvailable(entityType: string): boolean {
  const definition = getNoteEntityType(entityType);
  if (!definition || !noteEntityTables[entityType]) return false;
  if (!definition.requiredComponent) return true;
  return isComponentEnabledSync(definition.requiredComponent);
}
