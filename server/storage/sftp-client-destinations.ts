import { createNoopValidator } from './utils/validation';
import { getClient } from './transaction-context';
import { sftpClientDestinations, type SftpClientDestination, type InsertSftpClientDestination } from "../../shared/schema/system/sftp-client-schema";
import { eq } from "drizzle-orm";
import type { StorageLoggingConfig } from "./middleware/logging";

export const validate = createNoopValidator<InsertSftpClientDestination, SftpClientDestination>();

export interface SftpClientDestinationStorage {
  getAll(): Promise<SftpClientDestination[]>;
  getById(id: string): Promise<SftpClientDestination | undefined>;
  getBySiriusId(siriusId: string): Promise<SftpClientDestination | undefined>;
  create(data: InsertSftpClientDestination): Promise<SftpClientDestination>;
  update(id: string, data: Partial<InsertSftpClientDestination>): Promise<SftpClientDestination | undefined>;
  delete(id: string): Promise<boolean>;
}

export function createSftpClientDestinationStorage(): SftpClientDestinationStorage {
  const storage: SftpClientDestinationStorage = {
    async getAll(): Promise<SftpClientDestination[]> {
      const client = getClient();
      return await client.select().from(sftpClientDestinations);
    },

    async getById(id: string): Promise<SftpClientDestination | undefined> {
      const client = getClient();
      const [row] = await client
        .select()
        .from(sftpClientDestinations)
        .where(eq(sftpClientDestinations.id, id));
      return row || undefined;
    },

    async getBySiriusId(siriusId: string): Promise<SftpClientDestination | undefined> {
      const client = getClient();
      const [row] = await client
        .select()
        .from(sftpClientDestinations)
        .where(eq(sftpClientDestinations.siriusId, siriusId));
      return row || undefined;
    },

    async create(data: InsertSftpClientDestination): Promise<SftpClientDestination> {
      validate.validateOrThrow(data);
      const client = getClient();
      const [row] = await client
        .insert(sftpClientDestinations)
        .values(data)
        .returning();
      return row;
    },

    async update(id: string, data: Partial<InsertSftpClientDestination>): Promise<SftpClientDestination | undefined> {
      const client = getClient();
      const [updated] = await client
        .update(sftpClientDestinations)
        .set(data)
        .where(eq(sftpClientDestinations.id, id))
        .returning();
      return updated || undefined;
    },

    async delete(id: string): Promise<boolean> {
      const client = getClient();
      const result = await client
        .delete(sftpClientDestinations)
        .where(eq(sftpClientDestinations.id, id))
        .returning();
      return result.length > 0;
    },
  };

  return storage;
}

export const sftpClientDestinationLoggingConfig: StorageLoggingConfig<SftpClientDestinationStorage> = {
  module: 'sftpClientDestinations',
  methods: {
    create: {
      enabled: true,
      getEntityId: (args, result) => result?.id || 'new sftp client',
      getHostEntityId: (args, result) => result?.id,
      getDescription: async (args, result) => {
        const name = result?.name || args[0]?.name || 'Unnamed';
        return `Created SFTP Client Destination "${name}"`;
      },
      after: async (args, result) => {
        return {
          sftpClientDestination: result,
          metadata: {
            sftpClientDestinationId: result?.id,
            siriusId: result?.siriusId,
            name: result?.name,
          }
        };
      }
    },
    update: {
      enabled: true,
      getEntityId: (args) => args[0],
      getHostEntityId: (args) => args[0],
      getDescription: async (args, result, beforeState) => {
        const oldName = beforeState?.sftpClientDestination?.name || 'Unknown';
        const newName = result?.name || oldName;
        if (oldName !== newName) {
          return `Updated SFTP Client Destination "${oldName}" → "${newName}"`;
        }
        return `Updated SFTP Client Destination "${newName}"`;
      },
      before: async (args, storage) => {
        const sftpClientDestination = await storage.getById(args[0]);
        return { sftpClientDestination };
      },
      after: async (args, result, _storage, beforeState) => {
        return {
          sftpClientDestination: result,
          previousSftpClientDestination: beforeState?.sftpClientDestination,
          metadata: {
            sftpClientDestinationId: result?.id,
            siriusId: result?.siriusId,
            name: result?.name,
          }
        };
      }
    },
    delete: {
      enabled: true,
      getEntityId: (args) => args[0],
      getHostEntityId: (args) => args[0],
      getDescription: async (args, result, beforeState) => {
        const name = beforeState?.sftpClientDestination?.name || 'Unknown';
        return `Deleted SFTP Client Destination "${name}"`;
      },
      before: async (args, storage) => {
        const sftpClientDestination = await storage.getById(args[0]);
        return { sftpClientDestination };
      },
      after: async (args, result, _storage, beforeState) => {
        return {
          deleted: result,
          sftpClientDestination: beforeState?.sftpClientDestination,
          metadata: {
            sftpClientDestinationId: args[0],
            siriusId: beforeState?.sftpClientDestination?.siriusId,
            name: beforeState?.sftpClientDestination?.name,
          }
        };
      }
    },
  }
};
