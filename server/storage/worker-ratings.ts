import { getClient } from './transaction-context';
import { 
  workerRatings,
  optionsWorkerRatings,
  workers,
  contacts,
  type WorkerRating, 
  type InsertWorkerRating,
  type OptionsWorkerRating
} from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { type StorageLoggingConfig } from "./middleware/logging";

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

async function getWorkerName(workerId: string | undefined): Promise<string> {
  if (!workerId) return 'Unknown Worker';
  const client = getClient();
  const [worker] = await client
    .select({ siriusId: workers.siriusId, contactId: workers.contactId })
    .from(workers)
    .where(eq(workers.id, workerId));
  if (!worker) return 'Unknown Worker';
  
  if (worker.contactId) {
    const [contact] = await client
      .select({ given: contacts.given, family: contacts.family, displayName: contacts.displayName })
      .from(contacts)
      .where(eq(contacts.id, worker.contactId));
    if (contact) {
      const name = `${contact.given || ''} ${contact.family || ''}`.trim();
      return name || contact.displayName || `Worker #${worker.siriusId}`;
    }
  }
  return `Worker #${worker.siriusId}`;
}

async function getRatingTypeName(ratingId: string): Promise<string> {
  const client = getClient();
  const [rating] = await client
    .select({ name: optionsWorkerRatings.name })
    .from(optionsWorkerRatings)
    .where(eq(optionsWorkerRatings.id, ratingId));
  return rating?.name || 'Unknown Rating Type';
}

export const workerRatingLoggingConfig: StorageLoggingConfig<WorkerRatingStorage> = {
  module: 'worker-ratings',
  methods: {
    create: {
      enabled: true,
      getEntityId: (args, result) => result?.id || 'new worker rating',
      getHostEntityId: (args, result) => result?.workerId || args[0]?.workerId,
      getDescription: async (args, result) => {
        const workerName = await getWorkerName(result?.workerId || args[0]?.workerId);
        const ratingName = await getRatingTypeName(result?.ratingId || args[0]?.ratingId);
        const value = result?.value ?? args[0]?.value;
        return `Set rating "${ratingName}" to ${value} for ${workerName}`;
      },
      after: async (args, result) => {
        return { workerRating: result };
      }
    },
    update: {
      enabled: true,
      getEntityId: (args) => args[0],
      getHostEntityId: async (args, result, beforeState) => {
        return beforeState?.workerRating?.workerId || result?.workerId;
      },
      getDescription: async (args, result, beforeState) => {
        const workerName = await getWorkerName(beforeState?.workerRating?.workerId || result?.workerId || '');
        const ratingName = await getRatingTypeName(beforeState?.workerRating?.ratingId || result?.ratingId || '');
        const oldValue = beforeState?.workerRating?.value;
        const newValue = result?.value ?? args[1]?.value;
        return `Changed rating "${ratingName}" from ${oldValue} to ${newValue} for ${workerName}`;
      },
      before: async (args, storage) => {
        const workerRating = await storage.get(args[0]);
        return { workerRating };
      }
    },
    delete: {
      enabled: true,
      getEntityId: (args) => args[0],
      getHostEntityId: async (args, result, beforeState) => {
        return beforeState?.workerRating?.workerId;
      },
      getDescription: async (args, result, beforeState) => {
        const workerName = await getWorkerName(beforeState?.workerRating?.workerId || '');
        const ratingName = await getRatingTypeName(beforeState?.workerRating?.ratingId || '');
        return `Removed rating "${ratingName}" from ${workerName}`;
      },
      before: async (args, storage) => {
        const workerRating = await storage.get(args[0]);
        return { workerRating };
      }
    },
    upsert: {
      enabled: true,
      getEntityId: (args, result) => result?.id || 'worker rating',
      getHostEntityId: (args) => args[0],
      getDescription: async (args, result) => {
        const [workerId, ratingId, value] = args;
        const workerName = await getWorkerName(workerId);
        const ratingName = await getRatingTypeName(ratingId);
        if (value === null) {
          return `Removed rating "${ratingName}" from ${workerName}`;
        }
        return `Set rating "${ratingName}" to ${value} for ${workerName}`;
      }
    }
  }
};

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
