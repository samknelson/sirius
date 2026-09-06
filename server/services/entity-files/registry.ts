import type { Request } from "express";
import type { File } from "@shared/schema";
import type { PolicyContext } from "@shared/access-policies";

/**
 * Generic entity file attachments framework — context registry.
 *
 * A "context" (an "area" in the admin UI) is a code-level registration that
 * plugs one entity type into the generic /api/entity-files routes. The
 * framework supplies everything that used to be per-context boilerplate:
 * attachment rows all live in the shared `entity_files` table keyed by the
 * context id (see server/storage/entity-files.ts), and the one directory
 * token `:entity-id` is expanded by the framework (see ./config.ts).
 *
 * So a context declares only what is genuinely its own:
 * - its id and label (and an optional component gate),
 * - whether one of its entities exists,
 * - the two access callbacks (API and file download).
 *
 * Registering a new area is therefore a registration here plus operator
 * configuration — no table, no migration, no storage namespace.
 *
 * WHERE files land (which filesystem, which directory, which extensions are
 * allowed) is NOT code — it is operator configuration stored in the
 * `entity_files_config` variable (see ./config.ts). A context with no config
 * entry is visible but reports itself as unconfigured; uploads are rejected
 * until an admin configures it.
 */

export type EntityFilesVerb = "view" | "manage";

export interface EntityFileContext {
  /** Stable id used in URLs and as the key in entity_files_config. */
  id: string;
  /** Human label for the admin config page (plural: "Workers"). */
  label: string;
  /** Human label for ONE record of this area ("Worker"), used wherever a
   * single record kind is named — the file-type "Applies To" list. */
  recordLabel: string;
  /** Optional component gate; when set the context 404s while disabled. */
  component?: string;
  /** Whether the entity exists (drives 404s before any file work). */
  entityExists(entityId: string): Promise<boolean>;
  /** Access callback: may this request view/manage this entity's files? */
  checkAccess(verb: EntityFilesVerb, entityId: string, req: Request): Promise<boolean>;
  /**
   * Request-free twin of `checkAccess` used by the `file.read` access
   * policy (see server/services/entity-files/file-read-access.ts): may the
   * policy-context user view this entity's files? Must be exactly as
   * strict as `checkAccess("view", ...)`.
   */
  checkPolicyAccess(
    verb: EntityFilesVerb,
    entityId: string,
    ctx: PolicyContext,
  ): Promise<boolean>;
}

const contexts = new Map<string, EntityFileContext>();

export function registerEntityFileContext(context: EntityFileContext): void {
  if (contexts.has(context.id)) {
    throw new Error(`Entity file context "${context.id}" is already registered`);
  }
  contexts.set(context.id, context);
}

export function getEntityFileContext(id: string): EntityFileContext | undefined {
  return contexts.get(id);
}

export function listEntityFileContexts(): EntityFileContext[] {
  return Array.from(contexts.values());
}
