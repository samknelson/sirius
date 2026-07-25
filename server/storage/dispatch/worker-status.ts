import { createNoopValidator } from '../utils/validation';
import { getClient } from '../transaction-context';
import { 
  workerDispatchStatus,
  type WorkerDispatchStatus, 
  type InsertWorkerDispatchStatus
} from "@shared/schema";
import { eq } from "drizzle-orm";
import { type StorageLoggingConfig } from "../middleware/logging";
import { eventBus, EventType } from "../../services/event-bus";

/**
 * Stub validator - add validation logic here when needed
 */
export const validate = createNoopValidator();

export const WORKER_ON_PRIMARY_DISPATCH_MESSAGE =
  "This worker is on an accepted primary dispatch and cannot be set to Available.";

/**
 * Thrown when an attempt is made to set a worker's dispatch status to
 * "available" while they hold an accepted primary dispatch. Hard invariant:
 * on an accepted primary dispatch ⇒ not available. Routes map this to 409.
 */
export class WorkerOnPrimaryDispatchError extends Error {
  constructor() {
    super(WORKER_ON_PRIMARY_DISPATCH_MESSAGE);
    this.name = "WorkerOnPrimaryDispatchError";
  }
}

/**
 * Guard for the "available" status: rejects when the worker currently holds
 * an accepted primary dispatch. Writes of "not_available" are always allowed
 * (that direction is the invariant-restoring one).
 */
async function assertAvailableAllowed(workerId: string): Promise<void> {
  const { storage } = await import('../index');
  if (await storage.dispatches.hasAcceptedPrimary(workerId)) {
    throw new WorkerOnPrimaryDispatchError();
  }
}

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

export const workerDispatchStatusLoggingConfig: StorageLoggingConfig<WorkerDispatchStatusStorage> = {
  module: 'worker-dispatch-status',
  methods: {
    create: {
      enabled: true,
      getEntityId: (args, result) => result?.id || 'new worker dispatch status',
      getHostEntityId: (args, result) => result?.workerId || args[0]?.workerId,
      getDescription: async (args, result) => {
        const { storage } = await import('../index');
        const workerName = await storage.workers.getWorkerDisplayName(result?.workerId || args[0]?.workerId);
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
        const { storage } = await import('../index');
        const workerName = await storage.workers.getWorkerDisplayName(result?.workerId || beforeState?.status?.workerId);
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
        const { storage } = await import('../index');
        const workerName = await storage.workers.getWorkerDisplayName(result?.workerId || args[0]);
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
      validate.validateOrThrow(status);
      // Schema/DB default the status to "available", so an omitted status is
      // an "available" write and must pass the primary-dispatch guard too.
      if ((status.status ?? "available") === "available") {
        await assertAvailableAllowed(status.workerId);
      }
      const client = getClient();
      const [created] = await client
        .insert(workerDispatchStatus)
        .values(status)
        .returning();
      
      eventBus.emit(EventType.DISPATCH_STATUS_SAVED, {
        statusId: created.id,
        workerId: created.workerId,
        status: created.status,
        previousStatus: null,
      });
      
      return created;
    },

    async update(id: string, status: Partial<InsertWorkerDispatchStatus>): Promise<WorkerDispatchStatus | undefined> {
      validate.validateOrThrow(id);
      const client = getClient();
      const existing = await this.get(id);
      if (status.status === "available" && existing) {
        await assertAvailableAllowed(existing.workerId);
      }
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
          previousStatus: existing?.status ?? null,
        });
      }
      
      return updated;
    },

    async upsertByWorker(workerId: string, status: Partial<InsertWorkerDispatchStatus>): Promise<WorkerDispatchStatus> {
      const client = getClient();
      const existing = await this.getByWorker(workerId);
      // Guard explicit "available" writes, and creates that would default to
      // "available" (no existing row + no status supplied).
      if (status.status === "available" || (!existing && status.status === undefined)) {
        await assertAvailableAllowed(workerId);
      }
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
        previousStatus: existing?.status ?? null,
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
