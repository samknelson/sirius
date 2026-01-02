import { db } from "../db";
import { 
  workerBans,
  workers,
  contacts,
  type WorkerBan, 
  type InsertWorkerBan
} from "@shared/schema";
import { eq, desc } from "drizzle-orm";
import { type StorageLoggingConfig } from "./middleware/logging";

export interface WorkerBanWithRelations extends WorkerBan {
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

export interface WorkerBanStorage {
  getAll(): Promise<WorkerBan[]>;
  get(id: string): Promise<WorkerBan | undefined>;
  getByWorker(workerId: string): Promise<WorkerBan[]>;
  create(ban: InsertWorkerBan): Promise<WorkerBan>;
  update(id: string, ban: Partial<InsertWorkerBan>): Promise<WorkerBan | undefined>;
  delete(id: string): Promise<boolean>;
}

function calculateActive(endDate: Date | null | undefined): boolean {
  if (!endDate) return true;
  return new Date(endDate) >= new Date();
}

function validateDateRange(startDate: Date, endDate: Date | null | undefined): void {
  if (endDate && new Date(endDate) < new Date(startDate)) {
    throw new Error("End date cannot be before start date");
  }
}

function validateStartDateNotFuture(startDate: Date): void {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = new Date(startDate);
  start.setHours(0, 0, 0, 0);
  if (start > today) {
    throw new Error("Start date cannot be in the future");
  }
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

export const workerBanLoggingConfig: StorageLoggingConfig<WorkerBanStorage> = {
  module: 'worker-bans',
  methods: {
    create: {
      enabled: true,
      getEntityId: (args, result) => result?.id || 'new worker ban',
      getHostEntityId: (args, result) => result?.workerId || args[0]?.workerId,
      getDescription: async (args, result) => {
        const workerName = await getWorkerName(result?.workerId || args[0]?.workerId);
        return `Created ban (${result?.type || 'unspecified'}) for ${workerName}`;
      },
      after: async (args, result) => {
        return { ban: result };
      }
    },
    update: {
      enabled: true,
      getEntityId: (args) => args[0],
      getHostEntityId: async (args, result, beforeState) => {
        return result?.workerId || beforeState?.ban?.workerId;
      },
      getDescription: async (args, result, beforeState) => {
        const workerName = await getWorkerName(result?.workerId || beforeState?.ban?.workerId);
        return `Updated ban for ${workerName}`;
      },
      before: async (args, storage) => {
        const ban = await storage.get(args[0]);
        return { ban };
      },
      after: async (args, result) => {
        return { ban: result };
      }
    },
    delete: {
      enabled: true,
      getEntityId: (args) => args[0],
      getHostEntityId: async (args, result, beforeState) => {
        return beforeState?.ban?.workerId;
      },
      getDescription: async (args, result, beforeState) => {
        const workerName = await getWorkerName(beforeState?.ban?.workerId || '');
        return `Deleted ban for ${workerName}`;
      },
      before: async (args, storage) => {
        const ban = await storage.get(args[0]);
        return { ban };
      }
    }
  }
};

export function createWorkerBanStorage(): WorkerBanStorage {
  return {
    async getAll(): Promise<WorkerBan[]> {
      return db.select().from(workerBans).orderBy(desc(workerBans.startDate));
    },

    async get(id: string): Promise<WorkerBan | undefined> {
      const [ban] = await db.select().from(workerBans).where(eq(workerBans.id, id));
      return ban;
    },

    async getByWorker(workerId: string): Promise<WorkerBan[]> {
      return db
        .select()
        .from(workerBans)
        .where(eq(workerBans.workerId, workerId))
        .orderBy(desc(workerBans.startDate));
    },

    async create(ban: InsertWorkerBan): Promise<WorkerBan> {
      validateStartDateNotFuture(ban.startDate);
      validateDateRange(ban.startDate, ban.endDate);
      const active = calculateActive(ban.endDate);
      const [created] = await db
        .insert(workerBans)
        .values({
          ...ban,
          active
        })
        .returning();
      return created;
    },

    async update(id: string, ban: Partial<InsertWorkerBan>): Promise<WorkerBan | undefined> {
      const existing = await this.get(id);
      if (!existing) return undefined;

      const startDate = ban.startDate !== undefined ? ban.startDate : existing.startDate;
      const endDate = ban.endDate !== undefined ? ban.endDate : existing.endDate;
      
      if (ban.startDate !== undefined) {
        validateStartDateNotFuture(startDate);
      }
      validateDateRange(startDate, endDate);
      const active = calculateActive(endDate);

      const [updated] = await db
        .update(workerBans)
        .set({
          ...ban,
          active
        })
        .where(eq(workerBans.id, id))
        .returning();
      return updated;
    },

    async delete(id: string): Promise<boolean> {
      const result = await db.delete(workerBans).where(eq(workerBans.id, id));
      return (result.rowCount ?? 0) > 0;
    }
  };
}
