import { getClient, onAfterCommit, runInTransaction } from "./transaction-context";
import {
  entityFiles,
  files,
  optionsFileType,
  type EntityFile,
  type File,
  type InsertFile,
} from "@shared/schema";
import { eq, and, asc, count, isNull } from "drizzle-orm";
import { type StorageLoggingConfig } from "./middleware/logging";
import { fileSystemService } from "../services/files";
import { logger } from "../logger";
import { fileContextTables, isFileContextAvailable } from "./entity-files-context-tables";

export interface EntityFileWithFile extends EntityFile {
  file: File;
  /** Name of the attachment's file type, or null when it has none. */
  typeName: string | null;
}

/**
 * Storage for the shared entity-files attachment table (`entity_files`) —
 * ONE context-agnostic namespace serving every registered area. Each row
 * links exactly one `files` row (file_id UNIQUE) to a (context, entity)
 * pair and carries the user-editable display `name` and freeform `data`
 * jsonb.
 *
 * Transactional contract:
 * - `createWithFile` inserts the files row AND the attachment row in ONE
 *   transaction (bytes are uploaded by the caller BEFORE this runs; a failed
 *   insert leaves a sweepable orphan object, never a row without bytes).
 * - `deleteWithFile` deletes the attachment row AND the files row in ONE
 *   transaction — exceptions bubble, no partial deletes. Provider byte
 *   removal is scheduled via onAfterCommit; if it fails the orphan object is
 *   left for the consistency sweep.
 */
export interface EntityFilesStorage {
  list(contextId: string, entityId: string): Promise<EntityFileWithFile[]>;
  get(
    contextId: string,
    entityId: string,
    attachmentId: string,
  ): Promise<EntityFileWithFile | undefined>;
  getByFileId(
    contextId: string,
    entityId: string,
    fileId: string,
  ): Promise<EntityFileWithFile | undefined>;
  createWithFile(
    contextId: string,
    entityId: string,
    file: InsertFile,
    name: string,
    typeId?: string | null,
  ): Promise<EntityFileWithFile>;
  update(
    contextId: string,
    entityId: string,
    attachmentId: string,
    updates: { name?: string; data?: unknown; typeId?: string | null },
  ): Promise<EntityFileWithFile | undefined>;
  /** How many attachments name this file type (drives the delete guard). */
  countByTypeId(typeId: string): Promise<number>;
  /**
   * Attachments in one context whose parent record no longer exists.
   *
   * Drives the orphan sweep; one anti-join per registered context. Returns an
   * empty list for a context whose table is not currently present (component
   * off) — attachments are kept, not swept, while their record type is
   * unavailable. The entity id comes back alongside the attachment id because
   * removal goes through `deleteWithFile`, which is scoped to
   * (context, entity, attachment).
   *
   * A per-record existence check does NOT live here: the routes ask the
   * context's own `entityExists` (see server/services/entity-files/registry.ts).
   * The table map (server/storage/entity-files-context-tables.ts) exists for
   * this bulk anti-join, which cannot be expressed record by record.
   */
  findOrphans(contextId: string, limit: number): Promise<Array<{ id: string; entityId: string }>>;
  deleteWithFile(
    contextId: string,
    entityId: string,
    attachmentId: string,
  ): Promise<{ attachment: EntityFile; file: File } | undefined>;
}

function rowToRecord(row: {
  entity_files: EntityFile;
  files: File;
  options_file_type: { name: string } | null;
}): EntityFileWithFile {
  return {
    ...row.entity_files,
    file: row.files,
    typeName: row.options_file_type?.name ?? null,
  };
}

/** Display name of one file type, for the records assembled without a join. */
async function typeNameFor(typeId: string | null): Promise<string | null> {
  if (!typeId) return null;
  const [row] = await getClient()
    .select({ name: optionsFileType.name })
    .from(optionsFileType)
    .where(eq(optionsFileType.id, typeId));
  return row?.name ?? null;
}

function scope(contextId: string, entityId: string) {
  return and(eq(entityFiles.contextId, contextId), eq(entityFiles.entityId, entityId));
}

export function createEntityFilesStorage(): EntityFilesStorage {
  return {
    async list(contextId: string, entityId: string): Promise<EntityFileWithFile[]> {
      const client = getClient();
      const rows = await client
        .select()
        .from(entityFiles)
        .innerJoin(files, eq(entityFiles.fileId, files.id))
        .leftJoin(optionsFileType, eq(optionsFileType.id, entityFiles.typeId))
        .where(scope(contextId, entityId))
        .orderBy(asc(files.uploadedAt), asc(entityFiles.id));
      return rows.map(rowToRecord);
    },

    async get(
      contextId: string,
      entityId: string,
      attachmentId: string,
    ): Promise<EntityFileWithFile | undefined> {
      const client = getClient();
      const rows = await client
        .select()
        .from(entityFiles)
        .innerJoin(files, eq(entityFiles.fileId, files.id))
        .leftJoin(optionsFileType, eq(optionsFileType.id, entityFiles.typeId))
        .where(and(scope(contextId, entityId), eq(entityFiles.id, attachmentId)));
      return rows[0] ? rowToRecord(rows[0]) : undefined;
    },

    async getByFileId(
      contextId: string,
      entityId: string,
      fileId: string,
    ): Promise<EntityFileWithFile | undefined> {
      const client = getClient();
      const rows = await client
        .select()
        .from(entityFiles)
        .innerJoin(files, eq(entityFiles.fileId, files.id))
        .leftJoin(optionsFileType, eq(optionsFileType.id, entityFiles.typeId))
        .where(and(scope(contextId, entityId), eq(entityFiles.fileId, fileId)));
      return rows[0] ? rowToRecord(rows[0]) : undefined;
    },

    async createWithFile(
      contextId: string,
      entityId: string,
      file: InsertFile,
      name: string,
      typeId?: string | null,
    ): Promise<EntityFileWithFile> {
      return runInTransaction(async () => {
        const client = getClient();
        const [fileRow] = await client.insert(files).values(file).returning();
        const [attachment] = await client
          .insert(entityFiles)
          .values({ contextId, entityId, fileId: fileRow.id, name, typeId: typeId ?? null })
          .returning();
        return { ...attachment, file: fileRow, typeName: await typeNameFor(attachment.typeId) };
      });
    },

    async update(
      contextId: string,
      entityId: string,
      attachmentId: string,
      updates: { name?: string; data?: unknown; typeId?: string | null },
    ): Promise<EntityFileWithFile | undefined> {
      const client = getClient();
      const set: Record<string, unknown> = {};
      if (updates.name !== undefined) set.name = updates.name;
      if (updates.data !== undefined) set.data = updates.data;
      // null is a value here, not an absence: it clears the type.
      if (updates.typeId !== undefined) set.typeId = updates.typeId;
      if (Object.keys(set).length === 0) {
        return this.get(contextId, entityId, attachmentId);
      }
      const [updated] = await client
        .update(entityFiles)
        .set(set)
        .where(and(scope(contextId, entityId), eq(entityFiles.id, attachmentId)))
        .returning();
      if (!updated) return undefined;
      const [fileRow] = await client.select().from(files).where(eq(files.id, updated.fileId));
      return fileRow
        ? { ...updated, file: fileRow, typeName: await typeNameFor(updated.typeId) }
        : undefined;
    },

    async countByTypeId(typeId: string): Promise<number> {
      const client = getClient();
      const [row] = await client
        .select({ value: count() })
        .from(entityFiles)
        .where(eq(entityFiles.typeId, typeId));
      return Number(row?.value ?? 0);
    },

    async findOrphans(
      contextId: string,
      limit: number,
    ): Promise<Array<{ id: string; entityId: string }>> {
      const table = fileContextTables[contextId];
      // Never anti-join against a table that may not exist: a disabled
      // component's attachments are left alone rather than treated as orphans.
      if (!table || !isFileContextAvailable(contextId)) return [];
      const client = getClient();
      const idColumn = (table as any).id;
      const rows = await client
        .select({ id: entityFiles.id, entityId: entityFiles.entityId })
        .from(entityFiles)
        .leftJoin(table, eq(idColumn, entityFiles.entityId))
        .where(and(eq(entityFiles.contextId, contextId), isNull(idColumn)))
        .limit(limit);
      return rows.map((r) => ({ id: r.id, entityId: r.entityId }));
    },

    async deleteWithFile(
      contextId: string,
      entityId: string,
      attachmentId: string,
    ): Promise<{ attachment: EntityFile; file: File } | undefined> {
      return runInTransaction(async () => {
        const client = getClient();
        const [attachment] = await client
          .delete(entityFiles)
          .where(and(scope(contextId, entityId), eq(entityFiles.id, attachmentId)))
          .returning();
        if (!attachment) return undefined;
        const [fileRow] = await client
          .delete(files)
          .where(eq(files.id, attachment.fileId))
          .returning();
        if (!fileRow) {
          // FK guarantees the files row existed; treat absence as corruption.
          throw new Error(
            `entity_files row ${attachmentId} pointed at missing files row ${attachment.fileId}`,
          );
        }
        // Byte removal only after the row deletes are durable. A failure
        // here leaves an orphan object for the consistency sweep.
        onAfterCommit(() => {
          void fileSystemService
            .remove(fileRow.fileSystemId, fileRow.storagePath)
            .catch((error) => {
              logger.warn(
                "Attachment rows deleted but object removal failed - orphan object left for sweep",
                {
                  service: "entityFiles",
                  fileId: fileRow.id,
                  fileSystemId: fileRow.fileSystemId,
                  storagePath: fileRow.storagePath,
                  error: error instanceof Error ? error.message : String(error),
                },
              );
            });
        });
        return { attachment, file: fileRow };
      });
    },
  };
}

export const entityFilesLoggingConfig: StorageLoggingConfig<EntityFilesStorage> = {
  module: "entityFiles",
  methods: {
    createWithFile: {
      enabled: true,
      getEntityId: (_args, result) => result?.id,
      getHostEntityId: (args) => args[1],
      after: async (_args, result) => result,
      getDescription: async (args) => `Attached file "${args[3]}" to ${args[0]}`,
    },
    update: {
      enabled: true,
      getEntityId: (args) => args[2],
      getHostEntityId: (args) => args[1],
      after: async (_args, result) => result,
      getDescription: async (args) => `Updated file attachment on ${args[0]}`,
    },
    deleteWithFile: {
      enabled: true,
      getEntityId: (args) => args[2],
      getHostEntityId: (args) => args[1],
      getDescription: async (args) => `Removed file attachment from ${args[0]}`,
    },
  },
};
