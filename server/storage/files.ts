import { db } from './db';
import { files, type File, type InsertFile } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { type StorageLoggingConfig } from "./middleware/logging";

export interface FileStorage {
  list(filters?: { entityType?: string; entityId?: string; uploadedBy?: string }): Promise<File[]>;
  getById(id: string): Promise<File | undefined>;
  getByStoragePath(storagePath: string): Promise<File | undefined>;
  create(file: InsertFile): Promise<File>;
  update(id: string, updates: Partial<Omit<InsertFile, 'id' | 'uploadedAt'>>): Promise<File | undefined>;
  delete(id: string): Promise<boolean>;
}

export const fileLoggingConfig: StorageLoggingConfig<FileStorage> = {
  module: 'files',
  methods: {
    create: {
      enabled: true,
      getEntityId: (args) => args[0]?.fileName || 'new file',
      getHostEntityId: (args, result) => args[0]?.entityId,
      after: async (args, result, storage) => {
        return result;
      }
    },
    update: {
      enabled: true,
      getEntityId: (args) => args[0],
      getHostEntityId: async (args, result, storage) => {
        const file = await storage.getById(args[0]);
        return file?.entityId;
      },
      before: async (args, storage) => {
        return await storage.getById(args[0]);
      },
      after: async (args, result, storage) => {
        return result;
      }
    },
    delete: {
      enabled: true,
      getEntityId: (args) => args[0],
      getHostEntityId: async (args, result, storage) => {
        const file = await storage.getById(args[0]);
        return file?.entityId;
      },
      before: async (args, storage) => {
        return await storage.getById(args[0]);
      }
    }
  }
};

export function createFileStorage(): FileStorage {
  return {
    async list(filters?: { entityType?: string; entityId?: string; uploadedBy?: string }): Promise<File[]> {
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
        return db
          .select()
          .from(files)
          .where(and(...conditions))
          .orderBy(desc(files.uploadedAt));
      } else {
        return db
          .select()
          .from(files)
          .orderBy(desc(files.uploadedAt));
      }
    },

    async getById(id: string): Promise<File | undefined> {
      const [file] = await db.select().from(files).where(eq(files.id, id));
      return file || undefined;
    },

    async getByStoragePath(storagePath: string): Promise<File | undefined> {
      const [file] = await db.select().from(files).where(eq(files.storagePath, storagePath));
      return file || undefined;
    },

    async create(insertFile: InsertFile): Promise<File> {
      const [file] = await db
        .insert(files)
        .values(insertFile)
        .returning();
      return file;
    },

    async update(id: string, updates: Partial<Omit<InsertFile, 'id' | 'uploadedAt'>>): Promise<File | undefined> {
      const [file] = await db
        .update(files)
        .set(updates)
        .where(eq(files.id, id))
        .returning();
      return file || undefined;
    },

    async delete(id: string): Promise<boolean> {
      const result = await db.delete(files).where(eq(files.id, id)).returning();
      return result.length > 0;
    }
  };
}
