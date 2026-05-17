import { getClient } from '../transaction-context';
import { 
  workerRatings,
  optionsWorkerRatings,
  type WorkerRating, 
  type InsertWorkerRating,
  type OptionsWorkerRating
} from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { defineLoggingConfig, type StorageLoggingConfig } from "../middleware/logging";

export interface WorkerRatingWithDetails extends WorkerRating {
  ratingType?: OptionsWorkerRating | null;
}

export interface WorkerRatingStorage {
  getByWorker(workerId: string): Promise<WorkerRatingWithDetails[]>;
  get(id: string): Promise<WorkerRatingWithDetails | undefined>;
  getByWorkerAndRating(workerId: string, ratingId: string): Promise<WorkerRating | undefined>;
  create(data: InsertWorkerRating): Promise<WorkerRating>;
  update(id: string, data: Partial<InsertWorkerRating>): Promise<WorkerRating | undefined>;
  delete(id: string): Promise<boolean>;
  upsert(workerId: string, ratingId: string, value: number | null): Promise<WorkerRating | null>;
}

async function getRatingTypeName(ratingId: string): Promise<string> {
  const client = getClient();
  const [rating] = await client
    .select({ name: optionsWorkerRatings.name })
    .from(optionsWorkerRatings)
    .where(eq(optionsWorkerRatings.id, ratingId));
  return rating?.name || 'Unknown Rating Type';
}

export const workerRatingLoggingConfig = defineLoggingConfig<WorkerRatingStorage>({
  module: 'worker-ratings',
  state: { key: 'workerRating' },
  hostEntityId: (args, result, before) =>
    before?.workerRating?.workerId ?? result?.workerId ?? args[0]?.workerId,
  methods: {
    create: {
      getEntityId: (args, result) => result?.id || 'new worker rating',
      getDescription: async (args, result) => {
        const { storage } = await import('../index');
        const workerName = await storage.workers.getWorkerDisplayName(result?.workerId || args[0]?.workerId);
        const ratingName = await getRatingTypeName(result?.ratingId || args[0]?.ratingId);
        const value = result?.value ?? args[0]?.value;
        return `Set rating "${ratingName}" to ${value} for ${workerName}`;
      },
    },
    update: {
      after: undefined,
      getDescription: async (args, result, beforeState) => {
        const { storage } = await import('../index');
        const workerName = await storage.workers.getWorkerDisplayName(beforeState?.workerRating?.workerId || result?.workerId);
        const ratingName = await getRatingTypeName(beforeState?.workerRating?.ratingId || result?.ratingId || '');
        const oldValue = beforeState?.workerRating?.value;
        const newValue = result?.value ?? args[1]?.value;
        return `Changed rating "${ratingName}" from ${oldValue} to ${newValue} for ${workerName}`;
      },
    },
    delete: {
      getDescription: async (args, result, beforeState) => {
        const { storage } = await import('../index');
        const workerName = await storage.workers.getWorkerDisplayName(beforeState?.workerRating?.workerId);
        const ratingName = await getRatingTypeName(beforeState?.workerRating?.ratingId || '');
        return `Removed rating "${ratingName}" from ${workerName}`;
      },
    },
    upsert: {
      getEntityId: (args, result) => {
        const [workerId, ratingId] = args;
        return result?.id || `${workerId}:${ratingId}`;
      },
      getHostEntityId: (args) => {
        const [workerId] = args;
        return workerId;
      },
      getDescription: async (args, result) => {
        const [workerId, ratingId, value] = args;
        const { storage } = await import('../index');
        const workerName = await storage.workers.getWorkerDisplayName(workerId);
        const ratingName = await getRatingTypeName(ratingId);
        if (value === null) {
          return `Removed rating "${ratingName}" from ${workerName}`;
        }
        return `Set rating "${ratingName}" to ${value} for ${workerName}`;
      },
    },
  },
});

export function createWorkerRatingStorage(): WorkerRatingStorage {
  return {
    async getByWorker(workerId: string): Promise<WorkerRatingWithDetails[]> {
      const client = getClient();
      const results = await client
        .select({
          workerRating: workerRatings,
          ratingType: optionsWorkerRatings,
        })
        .from(workerRatings)
        .leftJoin(optionsWorkerRatings, eq(workerRatings.ratingId, optionsWorkerRatings.id))
        .where(eq(workerRatings.workerId, workerId));
      
      return results.map(r => ({
        ...r.workerRating,
        ratingType: r.ratingType,
      }));
    },

    async get(id: string): Promise<WorkerRatingWithDetails | undefined> {
      const client = getClient();
      const [result] = await client
        .select({
          workerRating: workerRatings,
          ratingType: optionsWorkerRatings,
        })
        .from(workerRatings)
        .leftJoin(optionsWorkerRatings, eq(workerRatings.ratingId, optionsWorkerRatings.id))
        .where(eq(workerRatings.id, id));
      
      if (!result) return undefined;
      
      return {
        ...result.workerRating,
        ratingType: result.ratingType,
      };
    },

    async getByWorkerAndRating(workerId: string, ratingId: string): Promise<WorkerRating | undefined> {
      const client = getClient();
      const [result] = await client
        .select()
        .from(workerRatings)
        .where(and(
          eq(workerRatings.workerId, workerId),
          eq(workerRatings.ratingId, ratingId)
        ));
      return result;
    },

    async create(data: InsertWorkerRating): Promise<WorkerRating> {
      const client = getClient();
      const [result] = await client
        .insert(workerRatings)
        .values(data)
        .returning();
      return result;
    },

    async update(id: string, data: Partial<InsertWorkerRating>): Promise<WorkerRating | undefined> {
      const client = getClient();
      const [result] = await client
        .update(workerRatings)
        .set(data)
        .where(eq(workerRatings.id, id))
        .returning();
      return result;
    },

    async delete(id: string): Promise<boolean> {
      const client = getClient();
      const result = await client
        .delete(workerRatings)
        .where(eq(workerRatings.id, id))
        .returning();
      return result.length > 0;
    },

    async upsert(workerId: string, ratingId: string, value: number | null): Promise<WorkerRating | null> {
      const client = getClient();
      
      const [existing] = await client
        .select()
        .from(workerRatings)
        .where(and(
          eq(workerRatings.workerId, workerId),
          eq(workerRatings.ratingId, ratingId)
        ));
      
      if (value === null) {
        if (existing) {
          await client
            .delete(workerRatings)
            .where(eq(workerRatings.id, existing.id));
        }
        return null;
      }
      
      if (existing) {
        const [result] = await client
          .update(workerRatings)
          .set({ value })
          .where(eq(workerRatings.id, existing.id))
          .returning();
        return result;
      } else {
        const [result] = await client
          .insert(workerRatings)
          .values({ workerId, ratingId, value })
          .returning();
        return result;
      }
    }
  };
}
