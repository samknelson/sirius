import { registerCatalog } from "@shared/catalog";
import { listEntityNoteContexts } from "./registry";

/**
 * The note areas, as a shared catalog — the twin of
 * server/services/entity-files/catalog.ts.
 *
 * A projection of the context registry (./registry.ts). The registry keeps the
 * record-existence check and the access callback; the descriptive half moves
 * here.
 *
 * Note what is NOT here: whether an area carries notes at all. That is operator
 * configuration held in the `entity_notes_config` variable, and a catalog
 * answers what the code offers, never what it is set to. An area appears in
 * this catalog whether or not notes are switched on for it.
 */

export const ENTITY_NOTE_AREAS_CATALOG = "entity-note-areas";

export function registerEntityNoteAreasCatalog(): void {
  registerCatalog({
    id: ENTITY_NOTE_AREAS_CATALOG,
    label: "Note Areas",
    description:
      "Record types that can carry notes. Whether notes are switched on for an " +
      "area is operator configuration, not part of this catalog.",
    audience: "gated",
    viewPermission: "admin",
    entries: () =>
      listEntityNoteContexts().map((context) => ({
        id: context.id,
        name: context.label,
        ...(context.component !== undefined ? { component: context.component } : {}),
        detail: { recordLabel: context.recordLabel },
      })),
  });
}
