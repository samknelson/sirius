import { createNoopValidator } from './utils/validation';
import { getClient } from './transaction-context';
import {
  workerWsh,
  optionsWorkerWs,
  workers,
  type WorkerWsh,
} from "@shared/schema";
import { eq, desc, sql } from "drizzle-orm";
import type { StorageLoggingConfig } from "./middleware/logging";
import { eventBus, EventType } from "../services/event-bus";

/**
 * Stub validator - add validation logic here when needed
 */
export const validate = createNoopValidator();

export interface WorkerWshStorage {
  getWorkerWsh(workerId: string): Promise<any[]>;
  createWorkerWsh(data: { workerId: string; date: string; wsId: string; data?: any }): Promise<WorkerWsh>;
  updateWorkerWsh(id: string, data: { date?: string; wsId?: string; data?: any }): Promise<WorkerWsh | undefined>;
  deleteWorkerWsh(id: string): Promise<boolean>;
}

export function createWorkerWshStorage(
  updateWorkerStatus: (workerId: string, denormWsId: string | null) => Promise<any>,
  onWorkerDataChanged?: (workerId: string) => Promise<void>
): WorkerWshStorage {
  async function syncWorkerCurrentWorkStatus(workerId: string): Promise<void> {
    const client = getClient();
    
    const [currentWorker] = await client
      .select({ denormWsId: workers.denormWsId })
      .from(workers)
      .where(eq(workers.id, workerId));
    
    const previousWsId = currentWorker?.denormWsId || null;
    
    const [mostRecent] = await client
      .select()
      .from(workerWsh)
      .where(eq(workerWsh.workerId, workerId))
      .orderBy(desc(workerWsh.date), sql`${workerWsh.createdAt} DESC NULLS LAST`, desc(workerWsh.id))
      .limit(1);

    const newWsId = mostRecent?.wsId || null;
    
    await updateWorkerStatus(workerId, newWsId);
    
    if (previousWsId !== newWsId) {
      await eventBus.emit(EventType.WORKER_WS_CHANGED, {
        workerId,
        wsId: newWsId,
        previousWsId,
      }).catch(err => {
        console.error("Failed to emit WORKER_WS_CHANGED event for worker", workerId, err);
      });
    }
    
    if (onWorkerDataChanged) {
      await onWorkerDataChanged(workerId).catch(err => {
        console.error("Failed to trigger scan invalidation for worker", workerId, err);
      });
    }
  }

  const storage: WorkerWshStorage = {
    async getWorkerWsh(workerId: string): Promise<any[]> {
      const client = getClient();
      const results = await client
        .select({
          id: workerWsh.id,
          date: workerWsh.date,
          workerId: workerWsh.workerId,
          wsId: workerWsh.wsId,
          data: workerWsh.data,
          ws: optionsWorkerWs,
        })
        .from(workerWsh)
        .leftJoin(optionsWorkerWs, eq(workerWsh.wsId, optionsWorkerWs.id))
        .where(eq(workerWsh.workerId, workerId))
        .orderBy(desc(workerWsh.date));

      return results;
    },

    async createWorkerWsh(data: { workerId: string; date: string; wsId: string; data?: any }): Promise<WorkerWsh> {
      validate.validateOrThrow(data);
      const client = getClient();
      const [wsh] = await client
        .insert(workerWsh)
        .values(data)
        .returning();
      
      await syncWorkerCurrentWorkStatus(data.workerId);
      
      return wsh;
    },

    async updateWorkerWsh(id: string, data: { date?: string; wsId?: string; data?: any }): Promise<WorkerWsh | undefined> {
      validate.validateOrThrow(data);
      const client = getClient();
      const [updated] = await client
        .update(workerWsh)
        .set(data)
        .where(eq(workerWsh.id, id))
        .returning();
      
      if (updated) {
        await syncWorkerCurrentWorkStatus(updated.workerId);
      }
      
      return updated || undefined;
    },

    async deleteWorkerWsh(id: string): Promise<boolean> {
      const client = getClient();
      const result = await client
        .delete(workerWsh)
        .where(eq(workerWsh.id, id))
        .returning();
      
      if (result.length > 0 && result[0].workerId) {
        await syncWorkerCurrentWorkStatus(result[0].workerId);
      }
      
      return result.length > 0;
    },
  };

  return storage;
}

export const workerWshLoggingConfig: StorageLoggingConfig<WorkerWshStorage> = {
  module: 'worker-wsh',
  methods: {
    createWorkerWsh: {
      enabled: true,
      getEntityId: (args, result) => result?.id || 'new work status history',
      getHostEntityId: (args) => args[0]?.workerId,
      getDescription: async (args, result, beforeState, afterState) => {
        const workStatusName = afterState?.workStatus?.name || 'Unknown';
        const date = result?.date || args[0]?.date || 'Unknown';
        let formattedDate = date;
        if (date !== 'Unknown' && typeof date === 'string' && date.match(/^\d{4}-\d{2}-\d{2}$/)) {
          const [year, month, day] = date.split('-');
          formattedDate = `${parseInt(month)}/${parseInt(day)}/${year}`;
        }
        return `Created Work Status Entry [${workStatusName} ${formattedDate}]`;
      },
      after: async (args, result, storage) => {
        const client = getClient();
        const [workStatus] = await client.select().from(optionsWorkerWs).where(eq(optionsWorkerWs.id, result.wsId));
        return {
          wsh: result,
          workStatus: workStatus,
          metadata: {
            workerId: result.workerId,
            date: result.date,
            workStatusName: workStatus?.name || 'Unknown',
            note: `Work status history entry created: ${workStatus?.name || 'Unknown'} on ${result.date}`
          }
        };
      }
    },
    updateWorkerWsh: {
      enabled: true,
      getEntityId: (args) => args[0],
      getHostEntityId: async (args, result, beforeState) => {
        if (beforeState?.wsh?.workerId) {
          return beforeState.wsh.workerId;
        }
        const client = getClient();
        const [wshEntry] = await client.select().from(workerWsh).where(eq(workerWsh.id, args[0]));
        return wshEntry?.workerId;
      },
      getDescription: async (args, result, beforeState, afterState) => {
        const oldStatusName = beforeState?.workStatus?.name || 'Unknown';
        const newStatusName = afterState?.workStatus?.name || 'Unknown';
        const date = result?.date || beforeState?.wsh?.date || 'Unknown';
        let formattedDate = date;
        if (date !== 'Unknown' && typeof date === 'string' && date.match(/^\d{4}-\d{2}-\d{2}$/)) {
          const [year, month, day] = date.split('-');
          formattedDate = `${parseInt(month)}/${parseInt(day)}/${year}`;
        }
        return `Updated Work Status Entry [${oldStatusName} → ${newStatusName} ${formattedDate}]`;
      },
      before: async (args, storage) => {
        const client = getClient();
        const [wshEntry] = await client.select().from(workerWsh).where(eq(workerWsh.id, args[0]));
        if (!wshEntry) {
          return null;
        }
        
        const [workStatus] = await client.select().from(optionsWorkerWs).where(eq(optionsWorkerWs.id, wshEntry.wsId));
        return {
          wsh: wshEntry,
          workStatus: workStatus,
          metadata: {
            workerId: wshEntry.workerId,
            date: wshEntry.date,
            workStatusName: workStatus?.name || 'Unknown'
          }
        };
      },
      after: async (args, result, storage) => {
        if (!result) return null;
        
        const client = getClient();
        const [workStatus] = await client.select().from(optionsWorkerWs).where(eq(optionsWorkerWs.id, result.wsId));
        return {
          wsh: result,
          workStatus: workStatus,
          metadata: {
            workerId: result.workerId,
            date: result.date,
            workStatusName: workStatus?.name || 'Unknown',
            note: `Work status history entry updated to: ${workStatus?.name || 'Unknown'} on ${result.date}`
          }
        };
      }
    },
    deleteWorkerWsh: {
      enabled: true,
      getEntityId: (args) => args[0],
      getHostEntityId: async (args, result, beforeState) => {
        if (beforeState?.wsh?.workerId) {
          return beforeState.wsh.workerId;
        }
        const client = getClient();
        const [wshEntry] = await client.select().from(workerWsh).where(eq(workerWsh.id, args[0]));
        return wshEntry?.workerId;
      },
      getDescription: async (args, result, beforeState, afterState) => {
        const workStatusName = beforeState?.workStatus?.name || 'Unknown';
        const date = beforeState?.wsh?.date || 'Unknown';
        let formattedDate = date;
        if (date !== 'Unknown' && typeof date === 'string' && date.match(/^\d{4}-\d{2}-\d{2}$/)) {
          const [year, month, day] = date.split('-');
          formattedDate = `${parseInt(month)}/${parseInt(day)}/${year}`;
        }
        return `Deleted Work Status Entry [${workStatusName} ${formattedDate}]`;
      },
      before: async (args, storage) => {
        const client = getClient();
        const [wshEntry] = await client.select().from(workerWsh).where(eq(workerWsh.id, args[0]));
        if (!wshEntry) {
          return null;
        }
        
        const [workStatus] = await client.select().from(optionsWorkerWs).where(eq(optionsWorkerWs.id, wshEntry.wsId));
        return {
          wsh: wshEntry,
          workStatus: workStatus,
          metadata: {
            workerId: wshEntry.workerId,
            date: wshEntry.date,
            workStatusName: workStatus?.name || 'Unknown',
            note: `Work status history entry deleted: ${workStatus?.name || 'Unknown'} on ${wshEntry.date}`
          }
        };
      }
    }
  }
};
