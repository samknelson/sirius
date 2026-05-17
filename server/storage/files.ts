import { createNoopValidator } from './utils/validation';
import { getClient } from './transaction-context';
import { files, type File, type InsertFile } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { defineLoggingConfig } from "./middleware/logging";

/**
 * Stub validator - add validation logic here when needed
 */
export const validate = createNoopValidator<InsertFile, File>();

export interface FileStorage {
  list(filters?: { entityType?: string; entityId?: string; uploadedBy?: string }): Promise<File[]>;
  getById(id: string): Promise<File | undefined>;
  getByStoragePath(storagePath: string): Promise<File | undefined>;
  create(file: InsertFile): Promise<File>;
  update(id: string, updates: Partial<Omit<InsertFile, 'id' | 'uploadedAt'>>): Promise<File | undefined>;
  delete(id: string): Promise<boolean>;
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
    async list(filters?: { entityType?: string; entityId?: string; uploadedBy?: string }): Promise<File[]> {
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

    async getByStoragePath(storagePath: string): Promise<File | undefined> {
      const client = getClient();
      const [file] = await client.select().from(files).where(eq(files.storagePath, storagePath));
      return file || undefined;
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
    }
  };
}
