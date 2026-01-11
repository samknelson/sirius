import { getClient } from './transaction-context';
import { workerIds, optionsWorkerIdType, type WorkerId, type InsertWorkerId } from "@shared/schema";
import { eq } from "drizzle-orm";
import { type StorageLoggingConfig } from "./middleware/logging";

export interface WorkerIdStorage {
  getWorkerIdsByWorkerId(workerId: string): Promise<WorkerId[]>;
  getWorkerId(id: string): Promise<WorkerId | undefined>;
  createWorkerId(workerId: InsertWorkerId): Promise<WorkerId>;
  updateWorkerId(id: string, workerId: Partial<InsertWorkerId>): Promise<WorkerId | undefined>;
  deleteWorkerId(id: string): Promise<boolean>;
}

export function createWorkerIdStorage(): WorkerIdStorage {
  return {
    async getWorkerIdsByWorkerId(workerId: string): Promise<WorkerId[]> {
      const client = getClient();
      return client.select().from(workerIds).where(eq(workerIds.workerId, workerId));
    },

    async getWorkerId(id: string): Promise<WorkerId | undefined> {
      const client = getClient();
      const [workerId] = await client.select().from(workerIds).where(eq(workerIds.id, id));
      return workerId || undefined;
    },

    async createWorkerId(insertWorkerId: InsertWorkerId): Promise<WorkerId> {
      const client = getClient();
      const [workerId] = await client
        .insert(workerIds)
        .values(insertWorkerId)
        .returning();
      return workerId;
    },

    async updateWorkerId(id: string, workerIdUpdate: Partial<InsertWorkerId>): Promise<WorkerId | undefined> {
      const client = getClient();
      const [workerId] = await client
        .update(workerIds)
        .set(workerIdUpdate)
        .where(eq(workerIds.id, id))
        .returning();
      return workerId || undefined;
    },

    async deleteWorkerId(id: string): Promise<boolean> {
      const client = getClient();
      const result = await client.delete(workerIds).where(eq(workerIds.id, id)).returning();
      return result.length > 0;
    }
  };
}

/**
 * Logging configuration for worker ID storage operations
 * 
 * Logs all worker ID mutations with full argument capture and change tracking.
 */
export const workerIdLoggingConfig: StorageLoggingConfig<WorkerIdStorage> = {
  module: 'workerIds',
  methods: {
    createWorkerId: {
      enabled: true,
      getEntityId: (args) => args[0]?.workerId || 'new worker ID',
      getHostEntityId: (args, result) => result?.workerId || args[0]?.workerId, // Worker ID is the host
      after: async (args, result, storage) => {
        return result; // Capture created worker ID
      },
      getDescription: async (args, result, beforeState, afterState, storage) => {
        const client = getClient();
        const workerId = result;
        
        // Get the type name directly from the database
        const typeId = workerId?.typeId;
        let typeName = 'Unknown type';
        if (typeId) {
          const [type] = await client.select().from(optionsWorkerIdType).where(eq(optionsWorkerIdType.id, typeId));
          typeName = type?.name || 'Unknown type';
        }
        
        // Get the value
        const value = workerId?.value || 'unknown';
        
        return `Created ${typeName} with value "${value}"`;
      }
    },
    updateWorkerId: {
      enabled: true,
      getEntityId: (args) => args[0], // Worker ID record ID
      getHostEntityId: (args, result, beforeState) => result?.workerId || beforeState?.workerId, // Worker ID is the host
      before: async (args, storage) => {
        return await storage.getWorkerId(args[0]); // Current state
      },
      after: async (args, result, storage) => {
        return result; // New state (diff auto-calculated)
      },
      getDescription: async (args, result, beforeState, afterState, storage) => {
        const client = getClient();
        const updates = args[1];
        const workerId = result;
        
        // Get the type name directly from the database
        const typeId = workerId?.typeId;
        let typeName = 'Unknown type';
        if (typeId) {
          const [type] = await client.select().from(optionsWorkerIdType).where(eq(optionsWorkerIdType.id, typeId));
          typeName = type?.name || 'Unknown type';
        }
        
        // Get the new value
        const newValue = updates?.value || workerId?.value || 'unknown';
        
        return `Updated ${typeName} to "${newValue}"`;
      }
    },
    deleteWorkerId: {
      enabled: true,
      getEntityId: (args) => args[0], // Worker ID record ID
      getHostEntityId: (args, result, beforeState) => beforeState?.workerId, // Worker ID is the host
      before: async (args, storage) => {
        return await storage.getWorkerId(args[0]); // Capture what's being deleted
      },
      getDescription: async (args, result, beforeState, afterState, storage) => {
        const client = getClient();
        const workerId = beforeState;
        
        // Get the type name directly from the database
        const typeId = workerId?.typeId;
        let typeName = 'Unknown type';
        if (typeId) {
          const [type] = await client.select().from(optionsWorkerIdType).where(eq(optionsWorkerIdType.id, typeId));
          typeName = type?.name || 'Unknown type';
        }
        
        // Get the value
        const value = workerId?.value || 'unknown';
        
        return `Deleted ${typeName} with value "${value}"`;
      }
    }
  }
};
