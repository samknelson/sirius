import { db } from './db';
import { cronJobs, cronJobRuns, users, type CronJob, type InsertCronJob, type CronJobRun, type InsertCronJobRun } from "@shared/schema";
import { eq, desc, and } from "drizzle-orm";
import { sql } from "drizzle-orm";

export interface CronJobStorage {
  list(): Promise<CronJob[]>;
  getByName(name: string): Promise<CronJob | undefined>;
  create(job: InsertCronJob): Promise<CronJob>;
  update(name: string, updates: Partial<InsertCronJob>): Promise<CronJob | undefined>;
}

export type CronJobRunWithUser = CronJobRun & {
  userFirstName?: string | null;
  userLastName?: string | null;
  userEmail?: string | null;
};

export interface CronJobRunStorage {
  list(filters?: { jobName?: string; status?: string }): Promise<CronJobRunWithUser[]>;
  getById(id: string): Promise<CronJobRunWithUser | undefined>;
  getLatestByJobName(jobName: string): Promise<CronJobRunWithUser | undefined>;
  create(run: InsertCronJobRun): Promise<CronJobRun>;
  update(id: string, updates: Partial<Omit<InsertCronJobRun, 'id'>>): Promise<CronJobRun | undefined>;
  delete(id: string): Promise<boolean>;
  deleteByJobName(jobName: string): Promise<number>;
}

export function createCronJobStorage(): CronJobStorage {
  return {
    async list(): Promise<CronJob[]> {
      return db
        .select()
        .from(cronJobs)
        .orderBy(cronJobs.name);
    },

    async getByName(name: string): Promise<CronJob | undefined> {
      const [job] = await db.select().from(cronJobs).where(eq(cronJobs.name, name));
      return job || undefined;
    },

    async create(insertJob: InsertCronJob): Promise<CronJob> {
      const [job] = await db
        .insert(cronJobs)
        .values(insertJob)
        .returning();
      return job;
    },

    async update(name: string, updates: Partial<InsertCronJob>): Promise<CronJob | undefined> {
      const [job] = await db
        .update(cronJobs)
        .set({ ...updates, updatedAt: new Date() })
        .where(eq(cronJobs.name, name))
        .returning();
      return job || undefined;
    },
  };
}

export function createCronJobRunStorage(): CronJobRunStorage {
  return {
    async list(filters?: { jobName?: string; status?: string }): Promise<CronJobRunWithUser[]> {
      const conditions = [];
      
      if (filters?.jobName) {
        conditions.push(eq(cronJobRuns.jobName, filters.jobName));
      }
      if (filters?.status) {
        conditions.push(eq(cronJobRuns.status, filters.status));
      }

      const query = db
        .select({
          id: cronJobRuns.id,
          jobName: cronJobRuns.jobName,
          status: cronJobRuns.status,
          mode: cronJobRuns.mode,
          output: cronJobRuns.output,
          error: cronJobRuns.error,
          startedAt: cronJobRuns.startedAt,
          completedAt: cronJobRuns.completedAt,
          triggeredBy: cronJobRuns.triggeredBy,
          userFirstName: users.firstName,
          userLastName: users.lastName,
          userEmail: users.email,
        })
        .from(cronJobRuns)
        .leftJoin(users, eq(cronJobRuns.triggeredBy, users.id))
        .orderBy(desc(cronJobRuns.startedAt));

      if (conditions.length > 0) {
        return query.where(and(...conditions));
      } else {
        return query;
      }
    },

    async getById(id: string): Promise<CronJobRunWithUser | undefined> {
      const [run] = await db
        .select({
          id: cronJobRuns.id,
          jobName: cronJobRuns.jobName,
          status: cronJobRuns.status,
          mode: cronJobRuns.mode,
          output: cronJobRuns.output,
          error: cronJobRuns.error,
          startedAt: cronJobRuns.startedAt,
          completedAt: cronJobRuns.completedAt,
          triggeredBy: cronJobRuns.triggeredBy,
          userFirstName: users.firstName,
          userLastName: users.lastName,
          userEmail: users.email,
        })
        .from(cronJobRuns)
        .leftJoin(users, eq(cronJobRuns.triggeredBy, users.id))
        .where(eq(cronJobRuns.id, id));
      return run || undefined;
    },

    async getLatestByJobName(jobName: string): Promise<CronJobRunWithUser | undefined> {
      const [run] = await db
        .select({
          id: cronJobRuns.id,
          jobName: cronJobRuns.jobName,
          status: cronJobRuns.status,
          mode: cronJobRuns.mode,
          output: cronJobRuns.output,
          error: cronJobRuns.error,
          startedAt: cronJobRuns.startedAt,
          completedAt: cronJobRuns.completedAt,
          triggeredBy: cronJobRuns.triggeredBy,
          userFirstName: users.firstName,
          userLastName: users.lastName,
          userEmail: users.email,
        })
        .from(cronJobRuns)
        .leftJoin(users, eq(cronJobRuns.triggeredBy, users.id))
        .where(eq(cronJobRuns.jobName, jobName))
        .orderBy(desc(cronJobRuns.startedAt))
        .limit(1);
      return run || undefined;
    },

    async create(insertRun: InsertCronJobRun): Promise<CronJobRun> {
      const [run] = await db
        .insert(cronJobRuns)
        .values(insertRun)
        .returning();
      return run;
    },

    async update(id: string, updates: Partial<Omit<InsertCronJobRun, 'id'>>): Promise<CronJobRun | undefined> {
      const [run] = await db
        .update(cronJobRuns)
        .set(updates)
        .where(eq(cronJobRuns.id, id))
        .returning();
      return run || undefined;
    },

    async delete(id: string): Promise<boolean> {
      const result = await db.delete(cronJobRuns).where(eq(cronJobRuns.id, id)).returning();
      return result.length > 0;
    },

    async deleteByJobName(jobName: string): Promise<number> {
      const result = await db
        .delete(cronJobRuns)
        .where(eq(cronJobRuns.jobName, jobName))
        .returning();
      return result.length;
    }
  };
}
