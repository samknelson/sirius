import { createNoopValidator } from './utils/validation';
import { getClient, onAfterCommit } from './transaction-context';
import {
  workerMsh,
  optionsWorkerMs,
  optionsIndustry,
  type WorkerMsh,
} from "@shared/schema";
import { eq, desc, sql, inArray } from "drizzle-orm";
import type { StorageLoggingConfig } from "./middleware/logging";
import { eventBus, EventType } from "../services/event-bus";
import { logger } from "../logger";

export const validate = createNoopValidator();

export interface WorkerMshStorage {
  getWorkerMsh(workerId: string): Promise<any[]>;
  /**
   * The worker's current member statuses: the latest member status per industry,
   * derived from the member-status history. This is the source of truth the
   * `worker_ms` denorm plugin reads when recomputing `worker_msh_denorm`.
   */
  getCurrentMemberStatusIds(workerId: string): Promise<string[]>;
  /**
   * All workers whose CURRENT member status (latest history entry per
   * industry, same tie-breaking as getCurrentMemberStatusIds) is one of the
   * given status option IDs. Authoritative (reads worker_msh directly, not
   * the denorm table). Returns one row per (worker, matching status).
   */
  getWorkerIdsWithCurrentMs(msIds: string[]): Promise<Array<{ workerId: string; msId: string }>>;
  createWorkerMsh(data: { workerId: string; date: string; msId: string; industryId: string; data?: any }): Promise<WorkerMsh>;
  updateWorkerMsh(id: string, data: { date?: string; msId?: string; industryId?: string; data?: any }): Promise<WorkerMsh | undefined>;
  deleteWorkerMsh(id: string): Promise<boolean>;
}

export function createWorkerMshStorage(
  onWorkerDataChanged?: (workerId: string) => Promise<void>
): WorkerMshStorage {
  // After a member-status history change, kick off the dependent denorm work.
  // The employer denorm + scan invalidation run inline (preserving prior
  // behaviour), and the member-status denorm is recomputed asynchronously by
  // the `worker_ms` plugin, which subscribes to WORKER_MSH_SAVED. The event is
  // emitted only AFTER the surrounding transaction commits so the plugin reads
  // committed history rows (eventually consistent by design).
  async function onMemberStatusHistoryChanged(workerId: string): Promise<void> {
    if (onWorkerDataChanged) {
      await onWorkerDataChanged(workerId).catch(err => {
        console.error("Failed to trigger scan invalidation for worker", workerId, err);
      });
    }

    onAfterCommit(() => {
      void eventBus.emit(EventType.WORKER_MSH_SAVED, { workerId }).catch((err) => {
        logger.error("Failed to emit WORKER_MSH_SAVED", {
          service: "worker-msh",
          workerId,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    });
  }

  const storage: WorkerMshStorage = {
    async getCurrentMemberStatusIds(workerId: string): Promise<string[]> {
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

      return Array.from(latestByIndustry.values());
    },

    async getWorkerIdsWithCurrentMs(msIds: string[]): Promise<Array<{ workerId: string; msId: string }>> {
      if (msIds.length === 0) return [];
      const client = getClient();
      const latest = client
        .selectDistinctOn([workerMsh.workerId, workerMsh.industryId], {
          workerId: workerMsh.workerId,
          msId: workerMsh.msId,
        })
        .from(workerMsh)
        .orderBy(
          workerMsh.workerId,
          workerMsh.industryId,
          desc(workerMsh.date),
          sql`${workerMsh.createdAt} DESC NULLS LAST`,
          desc(workerMsh.id),
        )
        .as("latest");
      return client
        .select({ workerId: latest.workerId, msId: latest.msId })
        .from(latest)
        .where(inArray(latest.msId, msIds));
    },

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
      
      await onMemberStatusHistoryChanged(data.workerId);
      
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
        await onMemberStatusHistoryChanged(updated.workerId);
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
        await onMemberStatusHistoryChanged(result[0].workerId);
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
