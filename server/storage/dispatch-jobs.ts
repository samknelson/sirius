import { db } from "../db";
import { 
  dispatchJobs, 
  employers,
  optionsDispatchJobType,
  type DispatchJob, 
  type InsertDispatchJob
} from "@shared/schema";
import { eq, desc, and, gte, lte, sql, SQL } from "drizzle-orm";
import { type StorageLoggingConfig } from "./middleware/logging";

export interface DispatchJobFilters {
  employerId?: string;
  status?: string;
  jobTypeId?: string;
  startDateFrom?: Date;
  startDateTo?: Date;
}

export interface DispatchJobWithRelations extends DispatchJob {
  employer?: { id: string; name: string };
  jobType?: { id: string; name: string; data: unknown } | null;
}

export interface PaginatedDispatchJobs {
  data: DispatchJobWithRelations[];
  total: number;
  page: number;
  limit: number;
}

export interface DispatchJobStorage {
  getAll(): Promise<DispatchJob[]>;
  getPaginated(page: number, limit: number, filters?: DispatchJobFilters): Promise<PaginatedDispatchJobs>;
  get(id: string): Promise<DispatchJob | undefined>;
  getWithRelations(id: string): Promise<DispatchJobWithRelations | undefined>;
  getByEmployer(employerId: string): Promise<DispatchJob[]>;
  create(job: InsertDispatchJob): Promise<DispatchJob>;
  update(id: string, job: Partial<InsertDispatchJob>): Promise<DispatchJob | undefined>;
  delete(id: string): Promise<boolean>;
}

async function getJobTypeName(jobTypeId: string | null | undefined): Promise<string> {
  if (!jobTypeId) return '';
  const [jobType] = await db.select({ name: optionsDispatchJobType.name })
    .from(optionsDispatchJobType)
    .where(eq(optionsDispatchJobType.id, jobTypeId));
  return jobType?.name || '';
}

export const dispatchJobLoggingConfig: StorageLoggingConfig<DispatchJobStorage> = {
  module: 'dispatchJobs',
  methods: {
    create: {
      enabled: true,
      getEntityId: (args, result) => result?.id || 'new dispatch job',
      getHostEntityId: (args, result) => result?.employerId || args[0]?.employerId,
      getDescription: async (args, result) => {
        const title = result?.title || args[0]?.title || 'Unnamed';
        const jobTypeName = await getJobTypeName(result?.jobTypeId || args[0]?.jobTypeId);
        const typeLabel = jobTypeName ? ` (${jobTypeName})` : '';
        return `Created Dispatch Job "${title}"${typeLabel}`;
      },
      after: async (args, result) => {
        const jobTypeName = await getJobTypeName(result?.jobTypeId);
        return {
          job: result,
          metadata: {
            jobId: result?.id,
            employerId: result?.employerId,
            title: result?.title,
            jobTypeName,
            status: result?.status,
          }
        };
      }
    },
    update: {
      enabled: true,
      getEntityId: (args) => args[0],
      getHostEntityId: async (args, result, beforeState) => {
        return result?.employerId || beforeState?.job?.employerId;
      },
      getDescription: async (args, result, beforeState) => {
        const title = result?.title || beforeState?.job?.title || 'Unnamed';
        const jobTypeName = await getJobTypeName(result?.jobTypeId || beforeState?.job?.jobTypeId);
        const typeLabel = jobTypeName ? ` (${jobTypeName})` : '';
        const oldStatus = beforeState?.job?.status;
        const newStatus = result?.status;
        if (oldStatus && newStatus && oldStatus !== newStatus) {
          return `Updated Dispatch Job "${title}"${typeLabel}: ${oldStatus} → ${newStatus}`;
        }
        return `Updated Dispatch Job "${title}"${typeLabel}`;
      },
      before: async (args, storage) => {
        const job = await storage.get(args[0]);
        if (!job) return null;
        const jobTypeName = await getJobTypeName(job.jobTypeId);
        return { job, jobTypeName };
      },
      after: async (args, result, storage, beforeState) => {
        const jobTypeName = await getJobTypeName(result?.jobTypeId);
        return {
          job: result,
          previousState: beforeState?.job,
          metadata: {
            jobId: result?.id,
            employerId: result?.employerId,
            title: result?.title,
            jobTypeName,
            status: result?.status,
            previousStatus: beforeState?.job?.status,
          }
        };
      }
    },
    delete: {
      enabled: true,
      getEntityId: (args) => args[0],
      getHostEntityId: (args, result, beforeState) => beforeState?.job?.employerId,
      getDescription: async (args, result, beforeState) => {
        const title = beforeState?.job?.title || 'Unknown';
        const jobTypeName = beforeState?.jobTypeName || '';
        const typeLabel = jobTypeName ? ` (${jobTypeName})` : '';
        return `Deleted Dispatch Job "${title}"${typeLabel}`;
      },
      before: async (args, storage) => {
        const job = await storage.get(args[0]);
        if (!job) return null;
        const jobTypeName = await getJobTypeName(job.jobTypeId);
        return { job, jobTypeName };
      }
    }
  }
};

export function createDispatchJobStorage(): DispatchJobStorage {
  return {
    async getAll(): Promise<DispatchJob[]> {
      return db.select().from(dispatchJobs).orderBy(desc(dispatchJobs.createdAt));
    },

    async getPaginated(page: number, limit: number, filters?: DispatchJobFilters): Promise<PaginatedDispatchJobs> {
      const conditions: SQL[] = [];
      
      if (filters?.employerId) {
        conditions.push(eq(dispatchJobs.employerId, filters.employerId));
      }
      if (filters?.status) {
        conditions.push(eq(dispatchJobs.status, filters.status));
      }
      if (filters?.jobTypeId) {
        conditions.push(eq(dispatchJobs.jobTypeId, filters.jobTypeId));
      }
      if (filters?.startDateFrom) {
        conditions.push(gte(dispatchJobs.startDate, filters.startDateFrom));
      }
      if (filters?.startDateTo) {
        conditions.push(lte(dispatchJobs.startDate, filters.startDateTo));
      }
      
      const hasFilters = conditions.length > 0;
      const whereClause = hasFilters ? and(...conditions) : undefined;
      
      const countQuery = db
        .select({ count: sql<number>`count(*)::int` })
        .from(dispatchJobs);
      
      const [countResult] = hasFilters 
        ? await countQuery.where(whereClause!)
        : await countQuery;
      
      const total = countResult?.count || 0;
      
      const baseQuery = db
        .select({
          job: dispatchJobs,
          employer: {
            id: employers.id,
            name: employers.name,
          },
          jobType: {
            id: optionsDispatchJobType.id,
            name: optionsDispatchJobType.name,
            data: optionsDispatchJobType.data,
          },
        })
        .from(dispatchJobs)
        .leftJoin(employers, eq(dispatchJobs.employerId, employers.id))
        .leftJoin(optionsDispatchJobType, eq(dispatchJobs.jobTypeId, optionsDispatchJobType.id));
      
      const rows = hasFilters
        ? await baseQuery.where(whereClause!).orderBy(desc(dispatchJobs.startDate)).limit(limit).offset(page * limit)
        : await baseQuery.orderBy(desc(dispatchJobs.startDate)).limit(limit).offset(page * limit);
      
      const data: DispatchJobWithRelations[] = rows.map(row => ({
        ...row.job,
        employer: row.employer || undefined,
        jobType: row.jobType,
      }));
      
      return { data, total, page, limit };
    },

    async get(id: string): Promise<DispatchJob | undefined> {
      const [job] = await db.select().from(dispatchJobs).where(eq(dispatchJobs.id, id));
      return job || undefined;
    },

    async getWithRelations(id: string): Promise<DispatchJobWithRelations | undefined> {
      const [row] = await db
        .select({
          job: dispatchJobs,
          employer: {
            id: employers.id,
            name: employers.name,
          },
          jobType: {
            id: optionsDispatchJobType.id,
            name: optionsDispatchJobType.name,
            data: optionsDispatchJobType.data,
          },
        })
        .from(dispatchJobs)
        .leftJoin(employers, eq(dispatchJobs.employerId, employers.id))
        .leftJoin(optionsDispatchJobType, eq(dispatchJobs.jobTypeId, optionsDispatchJobType.id))
        .where(eq(dispatchJobs.id, id));
      
      if (!row) return undefined;
      
      return {
        ...row.job,
        employer: row.employer || undefined,
        jobType: row.jobType,
      };
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
