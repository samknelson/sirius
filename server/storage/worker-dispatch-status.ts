import { createNoopValidator } from './utils/validation';
import { getClient } from './transaction-context';
import { 
  workerDispatchStatus,
  workers,
  contacts,
  type WorkerDispatchStatus, 
  type InsertWorkerDispatchStatus
} from "@shared/schema";
import { eq } from "drizzle-orm";
import { type StorageLoggingConfig } from "./middleware/logging";
import { eventBus, EventType } from "../services/event-bus";

/**
 * Stub validator - add validation logic here when needed
 */
export const validate = createNoopValidator();

export interface WorkerDispatchStatusWithRelations extends WorkerDispatchStatus {
  worker?: {
    id: string;
    siriusId: number | null;
    contact?: {
      id: string;
      given: string | null;
      family: string | null;
      displayName: string | null;
    } | null;
  } | null;
}

export interface WorkerDispatchStatusStorage {
  getAll(): Promise<WorkerDispatchStatus[]>;
  get(id: string): Promise<WorkerDispatchStatus | undefined>;
  getByWorker(workerId: string): Promise<WorkerDispatchStatus | undefined>;
  create(status: InsertWorkerDispatchStatus): Promise<WorkerDispatchStatus>;
  update(id: string, status: Partial<InsertWorkerDispatchStatus>): Promise<WorkerDispatchStatus | undefined>;
  upsertByWorker(workerId: string, status: Partial<InsertWorkerDispatchStatus>): Promise<WorkerDispatchStatus>;
  delete(id: string): Promise<boolean>;
}

async function getWorkerName(workerId: string): Promise<string> {
  const client = getClient();
  const [worker] = await client
    .select({ contactId: workers.contactId, siriusId: workers.siriusId })
    .from(workers)
    .where(eq(workers.id, workerId));
  if (!worker) return 'Unknown Worker';
  
  const [contact] = await client
    .select({ given: contacts.given, family: contacts.family, displayName: contacts.displayName })
    .from(contacts)
    .where(eq(contacts.id, worker.contactId));
  
  const name = contact ? `${contact.given || ''} ${contact.family || ''}`.trim() : '';
  return name || contact?.displayName || `Worker #${worker.siriusId}`;
}

export const workerDispatchStatusLoggingConfig: StorageLoggingConfig<WorkerDispatchStatusStorage> = {
  module: 'worker-dispatch-status',
  methods: {
    create: {
      enabled: true,
      getEntityId: (args, result) => result?.id || 'new worker dispatch status',
      getHostEntityId: (args, result) => result?.workerId || args[0]?.workerId,
      getDescription: async (args, result) => {
        const workerName = await getWorkerName(result?.workerId || args[0]?.workerId);
        return `Set dispatch status to "${result?.status}" for ${workerName}`;
      },
      after: async (args, result) => {
        return { status: result };
      }
    },
    update: {
      enabled: true,
      getEntityId: (args) => args[0],
      getHostEntityId: async (args, result, beforeState) => {
        return result?.workerId || beforeState?.status?.workerId;
      },
      getDescription: async (args, result, beforeState) => {
        const workerName = await getWorkerName(result?.workerId || beforeState?.status?.workerId);
        const oldStatus = beforeState?.status?.status;
        const newStatus = result?.status;
        if (oldStatus && newStatus && oldStatus !== newStatus) {
          return `Updated dispatch status for ${workerName}: ${oldStatus} → ${newStatus}`;
        }
        return `Updated dispatch status for ${workerName}`;
      },
      before: async (args, storage) => {
        const status = await storage.get(args[0]);
        return { status };
      },
      after: async (args, result) => {
        return { status: result };
      }
    },
    upsertByWorker: {
      enabled: true,
      getEntityId: (args, result) => result?.id,
      getHostEntityId: (args, result) => result?.workerId || args[0],
      getDescription: async (args, result) => {
        const workerName = await getWorkerName(result?.workerId || args[0]);
        return `Set dispatch status to "${result?.status}" for ${workerName}`;
      },
      after: async (args, result) => {
        return { status: result };
      }
    },
    delete: {
      enabled: true,
      getEntityId: (args) => args[0],
      getDescription: async () => 'Deleted worker dispatch status',
      before: async (args, storage) => {
        const status = await storage.get(args[0]);
        return { status };
      }
    }
  }
};

export function createWorkerDispatchStatusStorage(): WorkerDispatchStatusStorage {
  return {
    async getAll(): Promise<WorkerDispatchStatus[]> {
      const client = getClient();
      return client.select().from(workerDispatchStatus);
    },

    async get(id: string): Promise<WorkerDispatchStatus | undefined> {
      const client = getClient();
      const [status] = await client
        .select()
        .from(workerDispatchStatus)
        .where(eq(workerDispatchStatus.id, id));
      return status;
    },

    async getByWorker(workerId: string): Promise<WorkerDispatchStatus | undefined> {
      const client = getClient();
      const [status] = await client
        .select()
        .from(workerDispatchStatus)
        .where(eq(workerDispatchStatus.workerId, workerId));
      return status;
    },

    async create(status: InsertWorkerDispatchStatus): Promise<WorkerDispatchStatus> {
      const client = getClient();
      const [created] = await client
        .insert(workerDispatchStatus)
        .values(status)
        .returning();
      
      eventBus.emit(EventType.DISPATCH_STATUS_SAVED, {
        statusId: created.id,
        workerId: created.workerId,
        status: created.status,
      });
      
      return created;
    },

    async update(id: string, status: Partial<InsertWorkerDispatchStatus>): Promise<WorkerDispatchStatus | undefined> {
      const client = getClient();
      const [updated] = await client
        .update(workerDispatchStatus)
        .set(status)
        .where(eq(workerDispatchStatus.id, id))
        .returning();
      
      if (updated) {
        eventBus.emit(EventType.DISPATCH_STATUS_SAVED, {
          statusId: updated.id,
          workerId: updated.workerId,
          status: updated.status,
        });
      }
      
      return updated;
    },

    async upsertByWorker(workerId: string, status: Partial<InsertWorkerDispatchStatus>): Promise<WorkerDispatchStatus> {
      const client = getClient();
      const existing = await this.getByWorker(workerId);
      let result: WorkerDispatchStatus;
      
      if (existing) {
        const [updated] = await client
          .update(workerDispatchStatus)
          .set(status)
          .where(eq(workerDispatchStatus.id, existing.id))
          .returning();
        result = updated;
      } else {
        const [created] = await client
          .insert(workerDispatchStatus)
          .values({ workerId, ...status })
          .returning();
        result = created;
      }
      
      eventBus.emit(EventType.DISPATCH_STATUS_SAVED, {
        statusId: result.id,
        workerId: result.workerId,
        status: result.status,
      });
      
      return result;
    },

    async delete(id: string): Promise<boolean> {
      const client = getClient();
      const existing = await this.get(id);
      const result = await client
        .delete(workerDispatchStatus)
        .where(eq(workerDispatchStatus.id, id))
        .returning();
      
      if (result.length > 0 && existing) {
        eventBus.emit(EventType.DISPATCH_STATUS_SAVED, {
          statusId: id,
          workerId: existing.workerId,
          status: existing.status,
          isDeleted: true,
        });
      }
      
      return result.length > 0;
    }
  };
}
