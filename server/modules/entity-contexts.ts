import type { TabEntityContext } from "@shared/tabRegistry";
import { isComponentEnabled } from "./components";
import { getEntityFileContext } from "../services/entity-files/registry";
import { getEntityFilesContextConfig } from "../services/entity-files/config";
import { getEntityNoteContext } from "../services/entity-notes/registry";
import { getEntityNotesContextConfig } from "../services/entity-notes/config";

/**
 * The ONE answer to "is this attachment area switched on for this record
 * type?", for both frameworks that have contexts: entity-files and
 * entity-notes.
 *
 * An area is on when its context is registered, its component (if it declares
 * one) is enabled, and an operator has configured it — configuration is
 * presence in the framework's config variable, nothing more.
 *
 * Callers: the notes routes (which refuse when off), the tab access
 * evaluation (which hides the tab when off), and the config pages' own
 * listings. They all go through here so a tab cannot be visible over routes
 * that refuse, or vice versa.
 */

export type EntityContextAvailability =
  | { available: true }
  | { available: false; status: 404 | 403; reason: string };

async function resolveFilesContext(contextId: string): Promise<EntityContextAvailability> {
  const context = getEntityFileContext(contextId);
  if (!context) {
    return { available: false, status: 404, reason: "Unknown entity file context" };
  }
  if (context.component && !(await isComponentEnabled(context.component))) {
    return { available: false, status: 404, reason: "Unknown entity file context" };
  }
  if (!(await getEntityFilesContextConfig(contextId))) {
    return {
      available: false,
      status: 403,
      reason:
        "File attachments are not configured for this area. An administrator can configure them under Config → Entity Files.",
    };
  }
  return { available: true };
}

async function resolveNotesContext(contextId: string): Promise<EntityContextAvailability> {
  const context = getEntityNoteContext(contextId);
  if (!context) {
    return { available: false, status: 404, reason: "Unknown entity note context" };
  }
  if (context.component && !(await isComponentEnabled(context.component))) {
    return { available: false, status: 404, reason: "Unknown entity note context" };
  }
  if (!(await getEntityNotesContextConfig(contextId))) {
    return {
      available: false,
      status: 403,
      reason:
        "Notes are not enabled for this area. An administrator can enable them under Config → Entity Notes.",
    };
  }
  return { available: true };
}

export async function resolveEntityContextAvailability(
  target: TabEntityContext,
): Promise<EntityContextAvailability> {
  switch (target.framework) {
    case "entity-files":
      return resolveFilesContext(target.contextId);
    case "entity-notes":
      return resolveNotesContext(target.contextId);
  }
}

/** Boolean form, for callers that only hide or show something. */
export async function isEntityContextAvailable(target: TabEntityContext): Promise<boolean> {
  return (await resolveEntityContextAvailability(target)).available;
}
