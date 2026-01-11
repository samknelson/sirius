import { db } from './db';
import { 
  workerDispatchDnc,
  workers,
  contacts,
  employers,
  type WorkerDispatchDnc, 
  type InsertWorkerDispatchDnc
} from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { type StorageLoggingConfig } from "./middleware/logging";
import { eventBus, EventType } from "../services/event-bus";

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

async function getWorkerName(workerId: string): Promise<string> {
  const [worker] = await db
    .select({ contactId: workers.contactId, siriusId: workers.siriusId })
    .from(workers)
    .where(eq(workers.id, workerId));
  if (!worker) return 'Unknown Worker';
  
  const [contact] = await db
    .select({ given: contacts.given, family: contacts.family, displayName: contacts.displayName })
    .from(contacts)
    .where(eq(contacts.id, worker.contactId));
  
  const name = contact ? `${contact.given || ''} ${contact.family || ''}`.trim() : '';
  return name || contact?.displayName || `Worker #${worker.siriusId}`;
}

async function getEmployerName(employerId: string): Promise<string> {
  const [employer] = await db
    .select({ name: employers.name })
    .from(employers)
    .where(eq(employers.id, employerId));
  return employer?.name || 'Unknown Employer';
}

export const workerDispatchDncLoggingConfig: StorageLoggingConfig<WorkerDispatchDncStorage> = {
  module: 'worker-dispatch-dnc',
  methods: {
    create: {
      enabled: true,
      getEntityId: (args, result) => result?.id || 'new dispatch worker dnc',
      getHostEntityId: (args, result) => result?.workerId || args[0]?.workerId,
      getDescription: async (args, result) => {
        const workerName = await getWorkerName(result?.workerId || args[0]?.workerId);
        const employerName = await getEmployerName(result?.employerId || args[0]?.employerId);
        return `Created DNC entry (${result?.type}) for ${workerName} at ${employerName}`;
      },
      after: async (args, result) => {
        return { dnc: result };
      }
    },
    update: {
      enabled: true,
      getEntityId: (args) => args[0],
      getHostEntityId: async (args, result, beforeState) => {
        return result?.workerId || beforeState?.dnc?.workerId;
      },
      getDescription: async (args, result, beforeState) => {
        const workerName = await getWorkerName(result?.workerId || beforeState?.dnc?.workerId);
        const employerName = await getEmployerName(result?.employerId || beforeState?.dnc?.employerId);
        return `Updated DNC entry for ${workerName} at ${employerName}`;
      },
      before: async (args, storage) => {
        const dnc = await storage.get(args[0]);
        return { dnc };
      },
      after: async (args, result) => {
        return { dnc: result };
      }
    },
    delete: {
      enabled: true,
      getEntityId: (args) => args[0],
      getHostEntityId: async (args, result, beforeState) => {
        return beforeState?.dnc?.workerId;
      },
      getDescription: async (args, result, beforeState) => {
        if (beforeState?.dnc) {
          const workerName = await getWorkerName(beforeState.dnc.workerId);
          const employerName = await getEmployerName(beforeState.dnc.employerId);
          return `Deleted DNC entry (${beforeState.dnc.type}) for ${workerName} at ${employerName}`;
        }
        return 'Deleted dispatch worker DNC entry';
      },
      before: async (args, storage) => {
        const dnc = await storage.get(args[0]);
        return { dnc };
      }
    }
  }
};

export function createWorkerDispatchDncStorage(): WorkerDispatchDncStorage {
  return {
    async getAll() {
      return await db.select().from(workerDispatchDnc);
    },

    async get(id: string) {
      const [result] = await db
        .select()
        .from(workerDispatchDnc)
        .where(eq(workerDispatchDnc.id, id));
      return result;
    },

    async getByWorker(workerId: string) {
      return await db
        .select()
        .from(workerDispatchDnc)
        .where(eq(workerDispatchDnc.workerId, workerId));
    },

    async getByEmployer(employerId: string) {
      return await db
        .select()
        .from(workerDispatchDnc)
        .where(eq(workerDispatchDnc.employerId, employerId));
    },

    async getByWorkerAndEmployer(workerId: string, employerId: string) {
      return await db
        .select()
        .from(workerDispatchDnc)
        .where(and(
          eq(workerDispatchDnc.workerId, workerId),
          eq(workerDispatchDnc.employerId, employerId)
        ));
    },

    async create(dnc: InsertWorkerDispatchDnc) {
      const [result] = await db
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
      const [result] = await db
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
      const [deleted] = await db
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
