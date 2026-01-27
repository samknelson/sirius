import { createNoopValidator } from './utils/validation';
import { getClient } from './transaction-context';
import { 
  workerDispatchHfe,
  workers,
  contacts,
  employers,
  type WorkerDispatchHfe, 
  type InsertWorkerDispatchHfe
} from "@shared/schema";
import { eq, lt } from "drizzle-orm";
import { type StorageLoggingConfig } from "./middleware/logging";
import { eventBus, EventType } from "../services/event-bus";

/**
 * Stub validator - add validation logic here when needed
 */
export const validate = createNoopValidator();

export interface WorkerDispatchHfeWithRelations extends WorkerDispatchHfe {
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

export interface WorkerDispatchHfeStorage {
  getAll(): Promise<WorkerDispatchHfe[]>;
  get(id: string): Promise<WorkerDispatchHfe | undefined>;
  getByWorker(workerId: string): Promise<WorkerDispatchHfe[]>;
  getByEmployer(employerId: string): Promise<WorkerDispatchHfe[]>;
  create(hfe: InsertWorkerDispatchHfe): Promise<WorkerDispatchHfe>;
  update(id: string, hfe: Partial<InsertWorkerDispatchHfe>): Promise<WorkerDispatchHfe | undefined>;
  delete(id: string): Promise<boolean>;
  findExpired(): Promise<WorkerDispatchHfe[]>;
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

async function getEmployerName(employerId: string): Promise<string> {
  const client = getClient();
  const [employer] = await client
    .select({ name: employers.name })
    .from(employers)
    .where(eq(employers.id, employerId));
  return employer?.name || 'Unknown Employer';
}

export const workerDispatchHfeLoggingConfig: StorageLoggingConfig<WorkerDispatchHfeStorage> = {
  module: 'worker-dispatch-hfe',
  methods: {
    create: {
      enabled: true,
      getEntityId: (args: any[], result?: any) => result?.id || 'new dispatch worker hfe',
      getHostEntityId: (args: any[], result?: any) => result?.workerId || args[0]?.workerId,
      getDescription: async (args, result) => {
        const workerName = await getWorkerName(result?.workerId || args[0]?.workerId);
        const employerName = await getEmployerName(result?.employerId || args[0]?.employerId);
        const holdUntil = result?.holdUntil ? new Date(result.holdUntil).toLocaleDateString() : 'unspecified';
        return `Created Hold for Employer entry for ${workerName} at ${employerName} until ${holdUntil}`;
      },
      after: async (args, result) => {
        return { hfe: result };
      }
    },
    update: {
      enabled: true,
      getEntityId: (args: any[]) => args[0],
      getHostEntityId: async (args: any[], result?: any, beforeState?: any) => {
        return result?.workerId || beforeState?.hfe?.workerId;
      },
      getDescription: async (args, result, beforeState) => {
        const workerName = await getWorkerName(result?.workerId || beforeState?.hfe?.workerId);
        const employerName = await getEmployerName(result?.employerId || beforeState?.hfe?.employerId);
        const holdUntil = result?.holdUntil ? new Date(result.holdUntil).toLocaleDateString() : 'unspecified';
        return `Updated Hold for Employer entry for ${workerName} at ${employerName} until ${holdUntil}`;
      },
      before: async (args, storage) => {
        const hfe = await storage.get(args[0]);
        return { hfe };
      },
      after: async (args, result) => {
        return { hfe: result };
      }
    },
    delete: {
      enabled: true,
      getEntityId: (args: any[]) => args[0],
      getHostEntityId: async (args: any[], result?: any, beforeState?: any) => {
        return beforeState?.hfe?.workerId;
      },
      getDescription: async (args, result, beforeState) => {
        if (beforeState?.hfe) {
          const workerName = await getWorkerName(beforeState.hfe.workerId);
          const employerName = await getEmployerName(beforeState.hfe.employerId);
          return `Deleted Hold for Employer entry for ${workerName} at ${employerName}`;
        }
        return 'Deleted Hold for Employer entry';
      },
      before: async (args, storage) => {
        const hfe = await storage.get(args[0]);
        return { hfe };
      }
    }
  }
};

export function createWorkerDispatchHfeStorage(): WorkerDispatchHfeStorage {
  return {
    async getAll() {
      const client = getClient();
      return await client.select().from(workerDispatchHfe);
    },

    async get(id: string) {
      const client = getClient();
      const [result] = await client
        .select()
        .from(workerDispatchHfe)
        .where(eq(workerDispatchHfe.id, id));
      return result;
    },

    async getByWorker(workerId: string) {
      const client = getClient();
      return await client
        .select()
        .from(workerDispatchHfe)
        .where(eq(workerDispatchHfe.workerId, workerId));
    },

    async getByEmployer(employerId: string) {
      const client = getClient();
      return await client
        .select()
        .from(workerDispatchHfe)
        .where(eq(workerDispatchHfe.employerId, employerId));
    },

    async create(hfe: InsertWorkerDispatchHfe) {
      validate.validateOrThrow(hfe);
      const client = getClient();
      const [result] = await client
        .insert(workerDispatchHfe)
        .values(hfe)
        .returning();
      
      setImmediate(() => {
        eventBus.emit(EventType.DISPATCH_HFE_SAVED, {
          hfeId: result.id,
          workerId: result.workerId,
          employerId: result.employerId,
        });
      });
      
      return result;
    },

    async update(id: string, hfe: Partial<InsertWorkerDispatchHfe>) {
      validate.validateOrThrow(id);
      const client = getClient();
      const [result] = await client
        .update(workerDispatchHfe)
        .set(hfe)
        .where(eq(workerDispatchHfe.id, id))
        .returning();
      
      if (result) {
        setImmediate(() => {
          eventBus.emit(EventType.DISPATCH_HFE_SAVED, {
            hfeId: result.id,
            workerId: result.workerId,
            employerId: result.employerId,
          });
        });
      }
      
      return result;
    },

    async delete(id: string) {
      const client = getClient();
      const [deleted] = await client
        .delete(workerDispatchHfe)
        .where(eq(workerDispatchHfe.id, id))
        .returning();
      
      if (deleted) {
        setImmediate(() => {
          eventBus.emit(EventType.DISPATCH_HFE_SAVED, {
            hfeId: deleted.id,
            workerId: deleted.workerId,
            employerId: deleted.employerId,
            isDeleted: true,
          });
        });
      }
      
      return !!deleted;
    },

    async findExpired() {
      const client = getClient();
      const today = new Date().toISOString().split('T')[0];
      return await client
        .select()
        .from(workerDispatchHfe)
        .where(lt(workerDispatchHfe.holdUntil, today));
    }
  };
}
