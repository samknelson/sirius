import { db } from "../db";
import { 
  dispatchJobs, 
  type DispatchJob, 
  type InsertDispatchJob
} from "@shared/schema";
import { eq, desc } from "drizzle-orm";
import { type StorageLoggingConfig } from "./middleware/logging";

export interface DispatchJobStorage {
  getAll(): Promise<DispatchJob[]>;
  get(id: string): Promise<DispatchJob | undefined>;
  getByEmployer(employerId: string): Promise<DispatchJob[]>;
  create(job: InsertDispatchJob): Promise<DispatchJob>;
  update(id: string, job: Partial<InsertDispatchJob>): Promise<DispatchJob | undefined>;
  delete(id: string): Promise<boolean>;
}

export const dispatchJobLoggingConfig: StorageLoggingConfig<DispatchJobStorage> = {
  module: 'dispatchJobs',
  methods: {
    create: {
      enabled: true,
      getEntityId: (args) => args[0]?.title || 'new dispatch job',
      after: async (args, result) => result
    },
    update: {
      enabled: true,
      getEntityId: (args) => args[0],
      before: async (args, storage) => await storage.get(args[0]),
      after: async (args, result) => result
    },
    delete: {
      enabled: true,
      getEntityId: (args) => args[0],
      before: async (args, storage) => await storage.get(args[0])
    }
  }
};

export function createDispatchJobStorage(): DispatchJobStorage {
  return {
    async getAll(): Promise<DispatchJob[]> {
      return db.select().from(dispatchJobs).orderBy(desc(dispatchJobs.createdAt));
    },

    async get(id: string): Promise<DispatchJob | undefined> {
      const [job] = await db.select().from(dispatchJobs).where(eq(dispatchJobs.id, id));
      return job || undefined;
    },

    async getByEmployer(employerId: string): Promise<DispatchJob[]> {
      return db.select().from(dispatchJobs)
        .where(eq(dispatchJobs.employerId, employerId))
        .orderBy(desc(dispatchJobs.startDate));
    },

    async create(insertJob: InsertDispatchJob): Promise<DispatchJob> {
      const [job] = await db.insert(dispatchJobs).values(insertJob).returning();
      return job;
    },

    async update(id: string, jobUpdate: Partial<InsertDispatchJob>): Promise<DispatchJob | undefined> {
      const [job] = await db
        .update(dispatchJobs)
        .set(jobUpdate)
        .where(eq(dispatchJobs.id, id))
        .returning();
      return job || undefined;
    },

    async delete(id: string): Promise<boolean> {
      const result = await db.delete(dispatchJobs).where(eq(dispatchJobs.id, id)).returning();
      return result.length > 0;
    }
  };
}
