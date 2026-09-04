import type { Request } from "express";
import type { File, InsertFile } from "@shared/schema";
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

/**
 * One attachment as the generic routes present it. The shared-table path
 * (storage.entityFiles) returns a superset of this; an adapter-backed context
 * (see `EntityFilesAdapter`) builds it from its own rows.
 */
export interface EntityFileRecord {
  id: string;
  entityId: string;
  fileId: string;
  /** User-editable display name. */
  name: string;
  data: unknown;
  file: File;
  /** File-type name; adapter-backed contexts carry no file type. */
  typeName?: string | null;
}

/**
 * FORK EXTENSION (BAO): join-table adapter for a context whose attachment
 * rows live in the ENTITY'S OWN tables rather than the shared `entity_files`
 * table — BAO Disability Credit and BAO case documents, which carry their
 * own lifecycle (supersession, never-delete, dedicated reclassify routes).
 * Upstream retired this model in favour of the shared table; it is kept
 * here as an OPT-IN so those contexts keep their semantics and data.
 *
 * Contract: `attach` and `remove` are transactional over BOTH the join row
 * and the files row; bytes are uploaded by the route BEFORE `attach` (a
 * failed insert leaves a sweepable orphan object, never a row without
 * bytes). An adapter context takes no part in the shared-table orphan sweep
 * or delete cleanup — its FKs own that.
 */
export interface EntityFilesAdapter {
  list(entityId: string): Promise<EntityFileRecord[]>;
  get(entityId: string, attachmentId: string): Promise<EntityFileRecord | undefined>;
  /** Used by /api/files/:id/download to serve the display name. */
  getByFileId(entityId: string, fileId: string): Promise<EntityFileRecord | undefined>;
  attach(entityId: string, file: InsertFile, name: string): Promise<EntityFileRecord>;
  update(
    entityId: string,
    attachmentId: string,
    updates: { name?: string; data?: unknown },
  ): Promise<EntityFileRecord | undefined>;
  remove(entityId: string, attachmentId: string): Promise<{ file: File } | undefined>;
}

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
  /**
   * FORK EXTENSION (BAO): extra directory-template tokens this context can
   * resolve beyond the framework's `:entity-id` (e.g. ":worker-id"). Config
   * validation accepts them for this context only; `resolveTokens` supplies
   * their values at upload time. Both optional; absent = framework token only.
   */
  tokens?: string[];
  resolveTokens?(entityId: string): Promise<Record<string, string>>;
  /** FORK EXTENSION (BAO): see `EntityFilesAdapter`. Absent = shared table. */
  adapter?: EntityFilesAdapter;
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
