/**
 * Note-able entity registry.
 *
 * Single source of truth for which record types can carry staff notes. Every
 * surface derives from this list rather than keeping its own copy:
 *   - the `note-type` option list's "applies to" multi-select choices
 *   - the notes API's `entityType` validation (and the existence check that
 *     backs it, via the server-side table map)
 *   - the Notes tab wiring on each record's page
 *   - the orphan sweep that deletes notes whose record is gone
 *
 * Adding a record type here plus one line in the server-side table map
 * (`server/storage/notes-entity-types.ts`) plus its tab/route is the whole
 * cost of making a new record note-able — no schema change, because
 * `notes.entity_type` is a plain varchar validated against this registry
 * (the house convention for polymorphic references; a PG enum would cost a
 * migration per type).
 */

export interface NoteEntityTypeDefinition {
  /** Stable value persisted in `notes.entity_type`. Never rename in place. */
  id: string;
  /** Human label, singular (used in the option list's multi-select). */
  label: string;
  /**
   * Component that owns this record type's pages, when it is not core.
   * The Notes tab for the record is gated on it; core record types omit it.
   */
  requiredComponent?: string;
}

export const NOTE_ENTITY_TYPES: readonly NoteEntityTypeDefinition[] = [
  { id: "worker", label: "Worker" },
  { id: "employer", label: "Employer" },
  { id: "trust_provider", label: "Trust Provider", requiredComponent: "trust.providers" },
  { id: "grievance", label: "Grievance", requiredComponent: "grievance" },
] as const;

export type NoteEntityType = string;

export const NOTE_ENTITY_TYPE_IDS: readonly string[] = NOTE_ENTITY_TYPES.map((t) => t.id);

export function getNoteEntityType(id: string): NoteEntityTypeDefinition | undefined {
  return NOTE_ENTITY_TYPES.find((t) => t.id === id);
}

export function isNoteEntityType(id: string): boolean {
  return NOTE_ENTITY_TYPE_IDS.includes(id);
}

/** Label for a registered entity type; falls back to the raw id. */
export function noteEntityTypeLabel(id: string): string {
  return getNoteEntityType(id)?.label ?? id;
}

/** Choices for the note-type option list's "applies to" multi-select. */
export function noteEntityTypeEnumOptions(): Array<{ value: string; label: string }> {
  return NOTE_ENTITY_TYPES.map((t) => ({ value: t.id, label: t.label }));
}
