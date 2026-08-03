import type { Request } from "express";
import type { File } from "@shared/schema";
import type { InsertFile } from "@shared/schema";
import type { PolicyContext } from "@shared/access-policies";

/**
 * Generic entity file attachments framework — context registry.
 *
 * A "context" is a code-level registration that plugs one entity type into
 * the generic /api/entity-files routes. Each context supplies:
 *
 * - access control (a callback deciding view vs manage per request/entity),
 * - directory-token resolution (e.g. ":grievance-id" → the entity's id) used
 *   to expand the operator-configured directory template,
 * - a join-table adapter that persists the attachment rows for that entity
 *   (list/get/attach/update/remove against the entity's own join table).
 *
 * WHERE files land (which filesystem, which directory, which extensions are
 * allowed) is NOT code — it is operator configuration stored in the
 * `entity_files_config` variable (see ./config.ts). A context with no config
 * entry is visible but reports itself as unconfigured; uploads are rejected
 * until an admin configures it.
 */

/** One attachment row joined with its backing files row. */
export interface EntityFileRecord {
  /** Join-table row id (the "attachment id" in the API). */
  id: string;
  entityId: string;
  fileId: string;
  /** User-editable display name. */
  name: string;
  data: unknown;
  file: File;
}

/**
 * Join-table adapter. All row mutations happen inside the entity's own
 * storage namespace; `attach` and `remove` are transactional over BOTH the
 * join row and the files row (see e.g. storage.grievanceFiles).
 */
export interface EntityFilesAdapter {
  list(entityId: string): Promise<EntityFileRecord[]>;
  get(entityId: string, attachmentId: string): Promise<EntityFileRecord | undefined>;
  /**
   * Look up the attachment row by its backing files-row id. Used by the
   * generic /api/files/:id/download route to serve the user-editable
   * display name instead of the original filename.
   */
  getByFileId(entityId: string, fileId: string): Promise<EntityFileRecord | undefined>;
  /**
   * Create the files row AND the join row in one transaction. The bytes are
   * already uploaded by the route (bytes-first ordering: a failed insert
   * leaves a sweepable orphan object, never a row pointing at nothing).
   */
  attach(entityId: string, file: InsertFile, name: string): Promise<EntityFileRecord>;
  update(
    entityId: string,
    attachmentId: string,
    updates: { name?: string; data?: unknown },
  ): Promise<EntityFileRecord | undefined>;
  /**
   * Delete the join row AND the files row in ONE transaction (exceptions
   * bubble — no partial deletes). Provider byte removal is scheduled via
   * onAfterCommit inside the storage method; a failed byte delete leaves a
   * sweepable orphan object.
   */
  remove(entityId: string, attachmentId: string): Promise<{ file: File } | undefined>;
}

export type EntityFilesVerb = "view" | "manage";

export interface EntityFileContext {
  /** Stable id used in URLs and as the key in entity_files_config. */
  id: string;
  /** Human label for the admin config page. */
  label: string;
  /** Optional component gate; when set the context 404s while disabled. */
  component?: string;
  /**
   * Directory-template tokens this context can resolve (e.g.
   * [":grievance-id"]). The config page surfaces these to the operator and
   * config validation rejects unknown tokens in the directory template.
   */
  tokens: string[];
  /** Whether the entity exists (drives 404s before any file work). */
  entityExists(entityId: string): Promise<boolean>;
  /** Resolve token values for one entity (keys match `tokens`). */
  resolveTokens(entityId: string): Promise<Record<string, string>>;
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
  adapter: EntityFilesAdapter;
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
