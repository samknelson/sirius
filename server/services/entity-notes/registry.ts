import type { Request } from "express";

/**
 * Generic entity notes framework — context registry.
 *
 * The twin of the entity-files context registry
 * (server/services/entity-files/registry.ts). A "context" (an "area" in the
 * admin UI) is a code-level registration that plugs one record type into the
 * generic /api/entity-notes routes. Note rows all live in the shared
 * `entity_notes` table keyed by the context id, so a context declares only
 * what is genuinely its own:
 * - its id and labels (and an optional component gate),
 * - whether one of its records exists,
 * - the access callback.
 *
 * WHETHER an area carries notes at all is NOT code — it is operator
 * configuration stored in the `entity_notes_config` variable (see
 * ./config.ts). A registered context with no config entry is off: its routes
 * refuse and its Notes tab is hidden.
 */

export type EntityNotesVerb = "view" | "manage";

export interface EntityNoteContext {
  /** Stable id: used in URLs, stored in `entity_notes.context_id`, and the
   *  key in entity_notes_config. Never rename in place — stored rows carry it. */
  id: string;
  /** Human label for the area, plural (admin config page). */
  label: string;
  /**
   * Human label for ONE record of this area, singular. The note-type option
   * list offers these as its "Applies To" choices ("Worker", "Employer"),
   * where the area's plural name would read wrong.
   */
  recordLabel: string;
  /** Optional component gate; when set the context 404s while disabled. */
  component?: string;
  /** Whether the record exists (drives 404s before any note work). */
  entityExists(entityId: string): Promise<boolean>;
  /** Access callback: may this request view/manage this record's notes? */
  checkAccess(verb: EntityNotesVerb, entityId: string, req: Request): Promise<boolean>;
}

const contexts = new Map<string, EntityNoteContext>();

export function registerEntityNoteContext(context: EntityNoteContext): void {
  if (contexts.has(context.id)) {
    throw new Error(`Entity note context "${context.id}" is already registered`);
  }
  contexts.set(context.id, context);
}

export function getEntityNoteContext(id: string): EntityNoteContext | undefined {
  return contexts.get(id);
}

export function listEntityNoteContexts(): EntityNoteContext[] {
  return Array.from(contexts.values());
}
