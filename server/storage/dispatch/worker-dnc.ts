import { createNoopValidator } from '../utils/validation';
import { getClient } from '../transaction-context';
import { 
  workerDispatchDnc,
  employers,
  type WorkerDispatchDnc, 
  type InsertWorkerDispatchDnc
} from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { defineLoggingConfig, type StorageLoggingConfig } from "../middleware/logging";
import { eventBus, EventType } from "../../services/event-bus";

/**
 * Stub validator - add validation logic here when needed
 */
export const validate = createNoopValidator();

export interface WorkerDispatchDncWithRelations extends WorkerDispatchDnc {
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
  employer?: {
    id: string;
    name: string;
  } | null;
}

export interface WorkerDispatchDncStorage {
  getAll(): Promise<WorkerDispatchDnc[]>;
  get(id: string): Promise<WorkerDispatchDnc | undefined>;
  getByWorker(workerId: string): Promise<WorkerDispatchDnc[]>;
  getByEmployer(employerId: string): Promise<WorkerDispatchDnc[]>;
  getByWorkerAndEmployer(workerId: string, employerId: string): Promise<WorkerDispatchDnc[]>;
  create(dnc: InsertWorkerDispatchDnc): Promise<WorkerDispatchDnc>;
  update(id: string, dnc: Partial<InsertWorkerDispatchDnc>): Promise<WorkerDispatchDnc | undefined>;
  delete(id: string): Promise<boolean>;
}

async function getEmployerName(employerId: string): Promise<string> {
  const client = getClient();
  const [employer] = await client
    .select({ name: employers.name })
    .from(employers)
    .where(eq(employers.id, employerId));
  return employer?.name || 'Unknown Employer';
}

export const workerDispatchDncLoggingConfig = defineLoggingConfig<WorkerDispatchDncStorage>({
  module: 'worker-dispatch-dnc',
  state: { key: 'dnc' },
  hostEntityId: (args, result, before) =>
    result?.workerId ?? before?.dnc?.workerId ?? args[0]?.workerId,
  methods: {
    create: {
      getEntityId: (args, result) => result?.id || 'new dispatch worker dnc',
      getDescription: async (args, result) => {
        const { storage } = await import('../index');
        const workerName = await storage.workers.getWorkerDisplayName(result?.workerId || args[0]?.workerId);
        const employerName = await getEmployerName(result?.employerId || args[0]?.employerId);
        return `Created DNC entry (${result?.type}) for ${workerName} at ${employerName}`;
      },
    },
    update: {
      getDescription: async (args, result, beforeState) => {
        const { storage } = await import('../index');
        const workerName = await storage.workers.getWorkerDisplayName(result?.workerId || beforeState?.dnc?.workerId);
        const employerName = await getEmployerName(result?.employerId || beforeState?.dnc?.employerId);
        return `Updated DNC entry for ${workerName} at ${employerName}`;
      },
    },
    delete: {
      getDescription: async (args, result, beforeState) => {
        if (beforeState?.dnc) {
          const { storage } = await import('../index');
          const workerName = await storage.workers.getWorkerDisplayName(beforeState.dnc.workerId);
          const employerName = await getEmployerName(beforeState.dnc.employerId);
          return `Deleted DNC entry (${beforeState.dnc.type}) for ${workerName} at ${employerName}`;
        }
        return 'Deleted dispatch worker DNC entry';
      },
    },
  },
});

export function createWorkerDispatchDncStorage(): WorkerDispatchDncStorage {
  return {
    async getAll() {
      const client = getClient();
      return await client.select().from(workerDispatchDnc);
    },

    async get(id: string) {
      const client = getClient();
      const [result] = await client
        .select()
        .from(workerDispatchDnc)
        .where(eq(workerDispatchDnc.id, id));
      return result;
    },

    async getByWorker(workerId: string) {
      const client = getClient();
      return await client
        .select()
        .from(workerDispatchDnc)
        .where(eq(workerDispatchDnc.workerId, workerId));
    },

    async getByEmployer(employerId: string) {
      const client = getClient();
      return await client
        .select()
        .from(workerDispatchDnc)
        .where(eq(workerDispatchDnc.employerId, employerId));
    },

    async getByWorkerAndEmployer(workerId: string, employerId: string) {
      const client = getClient();
      return await client
        .select()
        .from(workerDispatchDnc)
        .where(and(
          eq(workerDispatchDnc.workerId, workerId),
          eq(workerDispatchDnc.employerId, employerId)
        ));
    },

    async create(dnc: InsertWorkerDispatchDnc) {
      validate.validateOrThrow(dnc);
      const client = getClient();
      const [result] = await client
        .insert(workerDispatchDnc)
        .values(dnc)
        .returning();
      
      setImmediate(() => {
        eventBus.emit(EventType.DISPATCH_DNC_SAVED, {
          dncId: result.id,
          workerId: result.workerId,
          employerId: result.employerId,
          type: result.type,
        });
      });
      
      return result;
    },

    async update(id: string, dnc: Partial<InsertWorkerDispatchDnc>) {
      validate.validateOrThrow(id);
      const client = getClient();
      const [result] = await client
        .update(workerDispatchDnc)
        .set(dnc)
        .where(eq(workerDispatchDnc.id, id))
        .returning();
      
      if (result) {
        setImmediate(() => {
          eventBus.emit(EventType.DISPATCH_DNC_SAVED, {
            dncId: result.id,
            workerId: result.workerId,
            employerId: result.employerId,
            type: result.type,
          });
        });
      }
      
      return result;
    },

    async delete(id: string) {
      const client = getClient();
      const [deleted] = await client
        .delete(workerDispatchDnc)
        .where(eq(workerDispatchDnc.id, id))
        .returning();
      
      if (deleted) {
        setImmediate(() => {
          eventBus.emit(EventType.DISPATCH_DNC_SAVED, {
            dncId: deleted.id,
            workerId: deleted.workerId,
            employerId: deleted.employerId,
            type: deleted.type,
            isDeleted: true,
          });
        });
      }
      
      return !!deleted;
    }
  };
}
