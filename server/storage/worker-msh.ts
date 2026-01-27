import { createNoopValidator } from './utils/validation';
import { getClient } from './transaction-context';
import {
  workerMsh,
  optionsWorkerMs,
  optionsIndustry,
  type WorkerMsh,
} from "@shared/schema";
import { eq, desc, sql } from "drizzle-orm";
import type { StorageLoggingConfig } from "./middleware/logging";

export const validate = createNoopValidator();

export interface WorkerMshStorage {
  getWorkerMsh(workerId: string): Promise<any[]>;
  createWorkerMsh(data: { workerId: string; date: string; msId: string; industryId: string; data?: any }): Promise<WorkerMsh>;
  updateWorkerMsh(id: string, data: { date?: string; msId?: string; industryId?: string; data?: any }): Promise<WorkerMsh | undefined>;
  deleteWorkerMsh(id: string): Promise<boolean>;
}

export function createWorkerMshStorage(
  updateWorkerMemberStatuses: (workerId: string, denormMsIds: string[] | null) => Promise<any>,
  onWorkerDataChanged?: (workerId: string) => Promise<void>
): WorkerMshStorage {
  async function syncWorkerCurrentMemberStatuses(workerId: string): Promise<void> {
    const client = getClient();
    
    const allEntries = await client
      .select({
        id: workerMsh.id,
        date: workerMsh.date,
        msId: workerMsh.msId,
        industryId: workerMsh.industryId,
        createdAt: workerMsh.createdAt,
      })
      .from(workerMsh)
      .where(eq(workerMsh.workerId, workerId))
      .orderBy(desc(workerMsh.date), sql`${workerMsh.createdAt} DESC NULLS LAST`, desc(workerMsh.id));
    
    const latestByIndustry = new Map<string, string>();
    for (const entry of allEntries) {
      if (!latestByIndustry.has(entry.industryId)) {
        latestByIndustry.set(entry.industryId, entry.msId);
      }
    }
    
    const msIds = Array.from(latestByIndustry.values());
    await updateWorkerMemberStatuses(workerId, msIds.length > 0 ? msIds : null);
    
    if (onWorkerDataChanged) {
      await onWorkerDataChanged(workerId).catch(err => {
        console.error("Failed to trigger scan invalidation for worker", workerId, err);
      });
    }
  }

  const storage: WorkerMshStorage = {
    async getWorkerMsh(workerId: string): Promise<any[]> {
      const client = getClient();
      const results = await client
        .select({
          id: workerMsh.id,
          date: workerMsh.date,
          workerId: workerMsh.workerId,
          msId: workerMsh.msId,
          industryId: workerMsh.industryId,
          data: workerMsh.data,
          ms: optionsWorkerMs,
          industry: optionsIndustry,
        })
        .from(workerMsh)
        .leftJoin(optionsWorkerMs, eq(workerMsh.msId, optionsWorkerMs.id))
        .leftJoin(optionsIndustry, eq(workerMsh.industryId, optionsIndustry.id))
        .where(eq(workerMsh.workerId, workerId))
        .orderBy(desc(workerMsh.date));

      return results;
    },

    async createWorkerMsh(data: { workerId: string; date: string; msId: string; industryId: string; data?: any }): Promise<WorkerMsh> {
      validate.validateOrThrow(data);
      const client = getClient();
      const [msh] = await client
        .insert(workerMsh)
        .values(data)
        .returning();
      
      await syncWorkerCurrentMemberStatuses(data.workerId);
      
      return msh;
    },

    async updateWorkerMsh(id: string, data: { date?: string; msId?: string; industryId?: string; data?: any }): Promise<WorkerMsh | undefined> {
      validate.validateOrThrow(data);
      const client = getClient();
      const [updated] = await client
        .update(workerMsh)
        .set(data)
        .where(eq(workerMsh.id, id))
        .returning();
      
      if (updated) {
        await syncWorkerCurrentMemberStatuses(updated.workerId);
      }
      
      return updated || undefined;
    },

    async deleteWorkerMsh(id: string): Promise<boolean> {
      const client = getClient();
      const result = await client
        .delete(workerMsh)
        .where(eq(workerMsh.id, id))
        .returning();
      
      if (result.length > 0 && result[0].workerId) {
        await syncWorkerCurrentMemberStatuses(result[0].workerId);
      }
      
      return result.length > 0;
    },
  };

  return storage;
}

export const workerMshLoggingConfig: StorageLoggingConfig<WorkerMshStorage> = {
  module: 'worker-msh',
  methods: {
    createWorkerMsh: {
      enabled: true,
      getEntityId: (args, result) => result?.id || 'new member status history',
      getHostEntityId: (args) => args[0]?.workerId,
      getDescription: async (args, result, beforeState, afterState) => {
        const memberStatusName = afterState?.memberStatus?.name || 'Unknown';
        const industryName = afterState?.industry?.name || 'Unknown';
        const date = result?.date || args[0]?.date || 'Unknown';
        let formattedDate = date;
        if (date !== 'Unknown' && typeof date === 'string' && date.match(/^\d{4}-\d{2}-\d{2}$/)) {
          const [year, month, day] = date.split('-');
          formattedDate = `${parseInt(month)}/${parseInt(day)}/${year}`;
        }
        return `Created Member Status Entry [${memberStatusName} (${industryName}) ${formattedDate}]`;
      },
      after: async (args, result, storage) => {
        const client = getClient();
        const [memberStatus] = await client.select().from(optionsWorkerMs).where(eq(optionsWorkerMs.id, result.msId));
        const [industry] = await client.select().from(optionsIndustry).where(eq(optionsIndustry.id, result.industryId));
        return {
          msh: result,
          memberStatus: memberStatus,
          industry: industry,
          metadata: {
            workerId: result.workerId,
            date: result.date,
            memberStatusName: memberStatus?.name || 'Unknown',
            industryName: industry?.name || 'Unknown',
            note: `Member status history entry created: ${memberStatus?.name || 'Unknown'} (${industry?.name || 'Unknown'}) on ${result.date}`
          }
        };
      }
    },
    updateWorkerMsh: {
      enabled: true,
      getEntityId: (args) => args[0],
      getHostEntityId: async (args, result, beforeState) => {
        if (beforeState?.msh?.workerId) {
          return beforeState.msh.workerId;
        }
        const client = getClient();
        const [mshEntry] = await client.select().from(workerMsh).where(eq(workerMsh.id, args[0]));
        return mshEntry?.workerId;
      },
      getDescription: async (args, result, beforeState, afterState) => {
        const oldStatusName = beforeState?.memberStatus?.name || 'Unknown';
        const newStatusName = afterState?.memberStatus?.name || 'Unknown';
        const industryName = afterState?.industry?.name || beforeState?.industry?.name || 'Unknown';
        const date = result?.date || beforeState?.msh?.date || 'Unknown';
        let formattedDate = date;
        if (date !== 'Unknown' && typeof date === 'string' && date.match(/^\d{4}-\d{2}-\d{2}$/)) {
          const [year, month, day] = date.split('-');
          formattedDate = `${parseInt(month)}/${parseInt(day)}/${year}`;
        }
        return `Updated Member Status Entry [${oldStatusName} → ${newStatusName} (${industryName}) ${formattedDate}]`;
      },
      before: async (args, storage) => {
        const client = getClient();
        const [mshEntry] = await client.select().from(workerMsh).where(eq(workerMsh.id, args[0]));
        if (!mshEntry) {
          return null;
        }
        
        const [memberStatus] = await client.select().from(optionsWorkerMs).where(eq(optionsWorkerMs.id, mshEntry.msId));
        const [industry] = await client.select().from(optionsIndustry).where(eq(optionsIndustry.id, mshEntry.industryId));
        return {
          msh: mshEntry,
          memberStatus: memberStatus,
          industry: industry,
          metadata: {
            workerId: mshEntry.workerId,
            date: mshEntry.date,
            memberStatusName: memberStatus?.name || 'Unknown',
            industryName: industry?.name || 'Unknown'
          }
        };
      },
      after: async (args, result, storage) => {
        if (!result) return null;
        
        const client = getClient();
        const [memberStatus] = await client.select().from(optionsWorkerMs).where(eq(optionsWorkerMs.id, result.msId));
        const [industry] = await client.select().from(optionsIndustry).where(eq(optionsIndustry.id, result.industryId));
        return {
          msh: result,
          memberStatus: memberStatus,
          industry: industry,
          metadata: {
            workerId: result.workerId,
            date: result.date,
            memberStatusName: memberStatus?.name || 'Unknown',
            industryName: industry?.name || 'Unknown',
            note: `Member status history entry updated to: ${memberStatus?.name || 'Unknown'} (${industry?.name || 'Unknown'}) on ${result.date}`
          }
        };
      }
    },
    deleteWorkerMsh: {
      enabled: true,
      getEntityId: (args) => args[0],
      getHostEntityId: async (args, result, beforeState) => {
        if (beforeState?.msh?.workerId) {
          return beforeState.msh.workerId;
        }
        const client = getClient();
        const [mshEntry] = await client.select().from(workerMsh).where(eq(workerMsh.id, args[0]));
        return mshEntry?.workerId;
      },
      getDescription: async (args, result, beforeState, afterState) => {
        const memberStatusName = beforeState?.memberStatus?.name || 'Unknown';
        const industryName = beforeState?.industry?.name || 'Unknown';
        const date = beforeState?.msh?.date || 'Unknown';
        let formattedDate = date;
        if (date !== 'Unknown' && typeof date === 'string' && date.match(/^\d{4}-\d{2}-\d{2}$/)) {
          const [year, month, day] = date.split('-');
          formattedDate = `${parseInt(month)}/${parseInt(day)}/${year}`;
        }
        return `Deleted Member Status Entry [${memberStatusName} (${industryName}) ${formattedDate}]`;
      },
      before: async (args, storage) => {
        const client = getClient();
        const [mshEntry] = await client.select().from(workerMsh).where(eq(workerMsh.id, args[0]));
        if (!mshEntry) {
          return null;
        }
        
        const [memberStatus] = await client.select().from(optionsWorkerMs).where(eq(optionsWorkerMs.id, mshEntry.msId));
        const [industry] = await client.select().from(optionsIndustry).where(eq(optionsIndustry.id, mshEntry.industryId));
        return {
          msh: mshEntry,
          memberStatus: memberStatus,
          industry: industry,
          metadata: {
            workerId: mshEntry.workerId,
            date: mshEntry.date,
            memberStatusName: memberStatus?.name || 'Unknown',
            industryName: industry?.name || 'Unknown',
            note: `Member status history entry deleted: ${memberStatus?.name || 'Unknown'} (${industry?.name || 'Unknown'}) on ${mshEntry.date}`
          }
        };
      }
    }
  }
};
