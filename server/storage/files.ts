import { createNoopValidator } from './utils/validation';
import { getClient } from './transaction-context';
import { files, type File, type InsertFile } from "@shared/schema";
import { eq, and, desc, asc, gt, lt, inArray, like, sql } from "drizzle-orm";
import { defineLoggingConfig } from "./middleware/logging";

/** Escape LIKE metacharacters so a path prefix matches literally. */
function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * Stub validator - add validation logic here when needed
 */
export const validate = createNoopValidator<InsertFile, File>();

export interface FileStorage {
  list(filters?: { entityType?: string; entityId?: string; uploadedBy?: string; fileSystemId?: string; status?: string }): Promise<File[]>;
  getById(id: string): Promise<File | undefined>;
  getByStoragePath(storagePath: string, fileSystemId?: string): Promise<File | undefined>;
  /**
   * Batch lookup of file rows by storage path (one query for a whole
   * browse page). Returns a map keyed by storagePath; when multiple rows
   * share a path, the first row returned wins (matching getByStoragePath).
   */
  getByStoragePaths(storagePaths: string[], fileSystemId?: string): Promise<Map<string, File>>;
  create(file: InsertFile): Promise<File>;
  update(id: string, updates: Partial<Omit<InsertFile, 'id' | 'uploadedAt'>>): Promise<File | undefined>;
  delete(id: string): Promise<boolean>;
  /** Distinct file_system_id values referenced by rows — used by the boot warning. */
  listDistinctFileSystemIds(): Promise<string[]>;
  /**
   * Rewrite the storage_path prefix for every row of a filesystem whose
   * path lives under `fromPrefix/` (folder rename/move). Returns the number
   * of rows updated.
   */
  renameStoragePathPrefix(fileSystemId: string, fromPrefix: string, toPrefix: string): Promise<number>;
  /**
   * Keyset-paged listing for the consistency sweep: rows for one filesystem,
   * ordered by id, resuming after `cursor` (the last id of the previous page).
   * `uploadedBefore` bounds `uploaded_at` (used for the orphan grace period).
   */
  listPage(filters: {
    fileSystemId: string;
    status?: string;
    uploadedBefore?: Date;
  }, options?: { cursor?: string; limit?: number }): Promise<{ rows: File[]; cursor?: string }>;
}

export const fileLoggingConfig = defineLoggingConfig<FileStorage>({
  module: 'files',
  getter: 'getById',
  methods: {
    create: {
      getEntityId: (args) => args[0]?.fileName || 'new file',
      getHostEntityId: (args) => args[0]?.entityId,
    },
    // Note: legacy update/delete configs called `storage.getById(args[0])`
    // from inside getHostEntityId, but the third arg there is `beforeState`,
    // not `storage` — the call threw and the deferred logger swallowed the
    // error, so `host_entity_id` was always undefined on update/delete.
    // We preserve that emitted shape by leaving getHostEntityId unset and
    // omitting `hostEntityIdField`.
    update: {},
    delete: {},
  },
});

export function createFileStorage(): FileStorage {
  return {
    async list(filters?: { entityType?: string; entityId?: string; uploadedBy?: string; fileSystemId?: string; status?: string }): Promise<File[]> {
      const client = getClient();
      const conditions = [];
      
      if (filters?.entityType) {
        conditions.push(eq(files.entityType, filters.entityType));
      }
      if (filters?.entityId) {
        conditions.push(eq(files.entityId, filters.entityId));
      }
      if (filters?.uploadedBy) {
        conditions.push(eq(files.uploadedBy, filters.uploadedBy));
      }
      if (filters?.fileSystemId) {
        conditions.push(eq(files.fileSystemId, filters.fileSystemId));
      }
      if (filters?.status) {
        conditions.push(eq(files.status, filters.status));
      }

      if (conditions.length > 0) {
        return client
          .select()
          .from(files)
          .where(and(...conditions))
          .orderBy(desc(files.uploadedAt));
      } else {
        return client
          .select()
          .from(files)
          .orderBy(desc(files.uploadedAt));
      }
    },

    async getById(id: string): Promise<File | undefined> {
      const client = getClient();
      const [file] = await client.select().from(files).where(eq(files.id, id));
      return file || undefined;
    },

    async getByStoragePath(storagePath: string, fileSystemId?: string): Promise<File | undefined> {
      const client = getClient();
      const condition = fileSystemId
        ? and(eq(files.storagePath, storagePath), eq(files.fileSystemId, fileSystemId))
        : eq(files.storagePath, storagePath);
      const [file] = await client.select().from(files).where(condition);
      return file || undefined;
    },

    async getByStoragePaths(storagePaths: string[], fileSystemId?: string): Promise<Map<string, File>> {
      const result = new Map<string, File>();
      if (storagePaths.length === 0) return result;
      const client = getClient();
      const condition = fileSystemId
        ? and(inArray(files.storagePath, storagePaths), eq(files.fileSystemId, fileSystemId))
        : inArray(files.storagePath, storagePaths);
      const rows = await client.select().from(files).where(condition);
      for (const row of rows) {
        if (!result.has(row.storagePath)) {
          result.set(row.storagePath, row);
        }
      }
      return result;
    },

    async create(insertFile: InsertFile): Promise<File> {
      validate.validateOrThrow(insertFile);
      const client = getClient();
      const [file] = await client
        .insert(files)
        .values(insertFile)
        .returning();
      return file;
    },

    async update(id: string, updates: Partial<Omit<InsertFile, 'id' | 'uploadedAt'>>): Promise<File | undefined> {
      validate.validateOrThrow(updates);
      const client = getClient();
      const [file] = await client
        .update(files)
        .set(updates)
        .where(eq(files.id, id))
        .returning();
      return file || undefined;
    },

    async delete(id: string): Promise<boolean> {
      const client = getClient();
      const result = await client.delete(files).where(eq(files.id, id)).returning();
      return result.length > 0;
    },

    async listPage(
      filters: { fileSystemId: string; status?: string; uploadedBefore?: Date },
      options?: { cursor?: string; limit?: number },
    ): Promise<{ rows: File[]; cursor?: string }> {
      const client = getClient();
      const limit = Math.min(Math.max(options?.limit ?? 200, 1), 1000);
      const conditions = [eq(files.fileSystemId, filters.fileSystemId)];
      if (filters.status) {
        conditions.push(eq(files.status, filters.status));
      }
      if (filters.uploadedBefore) {
        conditions.push(lt(files.uploadedAt, filters.uploadedBefore));
      }
      if (options?.cursor) {
        conditions.push(gt(files.id, options.cursor));
      }
      const rows = await client
        .select()
        .from(files)
        .where(and(...conditions))
        .orderBy(asc(files.id))
        .limit(limit);
      return {
        rows,
        cursor: rows.length === limit ? rows[rows.length - 1].id : undefined,
      };
    },

    async renameStoragePathPrefix(fileSystemId: string, fromPrefix: string, toPrefix: string): Promise<number> {
      const client = getClient();
      const from = fromPrefix.replace(/\/+$/, "") + "/";
      const to = toPrefix.replace(/\/+$/, "") + "/";
      const rows = await client
        .update(files)
        .set({
          storagePath: sql`${to} || substring(${files.storagePath} from ${from.length + 1}::int)`,
        })
        .where(
          and(
            eq(files.fileSystemId, fileSystemId),
            like(files.storagePath, escapeLikePattern(from) + "%"),
          ),
        )
        .returning({ id: files.id });
      return rows.length;
    },

    async listDistinctFileSystemIds(): Promise<string[]> {
      const client = getClient();
      const rows = await client
        .selectDistinct({ fileSystemId: files.fileSystemId })
        .from(files);
      return rows.map((r) => r.fileSystemId);
    }
  };
}
