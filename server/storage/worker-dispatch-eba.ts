import { createNoopValidator } from './utils/validation';
import { getClient } from './transaction-context';
import { 
  workerDispatchEba,
  workers,
  contacts,
  type WorkerDispatchEba, 
  type InsertWorkerDispatchEba
} from "@shared/schema";
import { eq, and, inArray, lt } from "drizzle-orm";
import { type StorageLoggingConfig } from "./middleware/logging";
import { eventBus, EventType } from "../services/event-bus";

export const validate = createNoopValidator();

export interface WorkerDispatchEbaStorage {
  getAll(): Promise<WorkerDispatchEba[]>;
  get(id: string): Promise<WorkerDispatchEba | undefined>;
  getByWorker(workerId: string): Promise<WorkerDispatchEba[]>;
  syncDatesForWorker(workerId: string, dates: string[]): Promise<WorkerDispatchEba[]>;
  findExpired(daysAgo: number): Promise<WorkerDispatchEba[]>;
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

export const workerDispatchEbaLoggingConfig: StorageLoggingConfig<WorkerDispatchEbaStorage> = {
  module: 'worker-dispatch-eba',
  methods: {
    syncDatesForWorker: {
      enabled: true,
      getEntityId: (args: any[]) => args[0],
      getHostEntityId: (args: any[]) => args[0],
      getDescription: async (args, result) => {
        const workerName = await getWorkerName(args[0]);
        const dateCount = result?.length ?? 0;
        return `Synced ${dateCount} availability date(s) for ${workerName}`;
      },
      after: async (args, result) => {
        return { dates: result?.map((r: any) => r.ymd) };
      }
    },
    delete: {
      enabled: true,
      getEntityId: (args: any[]) => args[0],
      getHostEntityId: async (args: any[], result?: any, beforeState?: any) => {
        return beforeState?.entry?.workerId;
      },
      getDescription: async (args, result, beforeState) => {
        if (beforeState?.entry) {
          const workerName = await getWorkerName(beforeState.entry.workerId);
          return `Deleted availability date ${beforeState.entry.ymd} for ${workerName}`;
        }
        return 'Deleted availability date entry';
      },
      before: async (args, storage) => {
        const entry = await storage.get(args[0]);
        return { entry };
      }
    }
  }
};

export function createWorkerDispatchEbaStorage(): WorkerDispatchEbaStorage {
  return {
    async getAll() {
      const client = getClient();
      return await client.select().from(workerDispatchEba);
    },

    async get(id: string) {
      const client = getClient();
      const [result] = await client
        .select()
        .from(workerDispatchEba)
        .where(eq(workerDispatchEba.id, id));
      return result;
    },

    async getByWorker(workerId: string) {
      const client = getClient();
      return await client
        .select()
        .from(workerDispatchEba)
        .where(eq(workerDispatchEba.workerId, workerId));
    },

    async syncDatesForWorker(workerId: string, dates: string[]) {
      const client = getClient();
      
      const existing = await client
        .select()
        .from(workerDispatchEba)
        .where(eq(workerDispatchEba.workerId, workerId));
      
      const existingDates = new Set(existing.map(e => e.ymd));
      const desiredDates = new Set(dates);
      
      const toAdd = dates.filter(d => !existingDates.has(d));
      const toRemove = existing.filter(e => !desiredDates.has(e.ymd));
      
      if (toRemove.length > 0) {
        await client
          .delete(workerDispatchEba)
          .where(and(
            eq(workerDispatchEba.workerId, workerId),
            inArray(workerDispatchEba.id, toRemove.map(r => r.id))
          ));
      }
      
      if (toAdd.length > 0) {
        await client
          .insert(workerDispatchEba)
          .values(toAdd.map(ymd => ({ workerId, ymd })));
      }
      
      const result = await client
        .select()
        .from(workerDispatchEba)
        .where(eq(workerDispatchEba.workerId, workerId));
      
      eventBus.emit(EventType.DISPATCH_EBA_SAVED, { workerId });
      
      return result;
    },

    async findExpired(daysAgo: number) {
      const client = getClient();
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysAgo);
      const cutoffYmd = `${cutoffDate.getFullYear()}-${String(cutoffDate.getMonth() + 1).padStart(2, '0')}-${String(cutoffDate.getDate()).padStart(2, '0')}`;
      return await client
        .select()
        .from(workerDispatchEba)
        .where(lt(workerDispatchEba.ymd, cutoffYmd));
    },

    async delete(id: string) {
      const client = getClient();
      const [deleted] = await client
        .delete(workerDispatchEba)
        .where(eq(workerDispatchEba.id, id))
        .returning();
      return !!deleted;
    },
  };
}
