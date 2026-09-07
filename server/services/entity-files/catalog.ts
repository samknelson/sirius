import { registerCatalog } from "@shared/catalog";
import { listEntityFileContexts } from "./registry";

/**
 * The file areas, as a shared catalog.
 *
 * A projection of the context registry (./registry.ts), not a replacement for
 * it. The registry keeps everything that cannot be serialized and must not
 * leave the server: whether a record exists, and the two access callbacks. What
 * moves here is the descriptive half — what areas there are, what they are
 * called, and which component supplies each — which is precisely the half every
 * reader outside this framework actually wants.
 *
 * Deriving from the registry rather than duplicating it means the two cannot
 * disagree about which areas exist.
 */

export const ENTITY_FILE_AREAS_CATALOG = "entity-file-areas";

export function registerEntityFileAreasCatalog(): void {
  registerCatalog({
    id: ENTITY_FILE_AREAS_CATALOG,
    label: "File Areas",
    description:
      "Record types that can carry file attachments. Where the files land is " +
      "operator configuration, not part of this catalog.",
    audience: "gated",
    viewPermission: "admin",
    entries: () =>
      listEntityFileContexts().map((context) => ({
        id: context.id,
        name: context.label,
        ...(context.component !== undefined ? { component: context.component } : {}),
        // The singular name for one record of this area. Callers that name a
        // single record — the file-type "Applies To" list — need it, and it is
        // code-supplied, so it belongs here rather than being looked up
        // separately.
        detail: { recordLabel: context.recordLabel },
      })),
  });
}
