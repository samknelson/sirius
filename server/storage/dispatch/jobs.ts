import { createNoopValidator } from '../utils/validation';
import { getClient } from '../transaction-context';
import { 
  dispatchJobs, 
  dispatches,
  employers,
  optionsDispatchJobType,
  type DispatchJob, 
  type InsertDispatchJob
} from "@shared/schema";
import { eq, desc, and, gte, lte, sql, SQL, inArray } from "drizzle-orm";
import { defineLoggingConfig } from "../middleware/logging";

/**
 * Stub validator - add validation logic here when needed
 */
export const validate = createNoopValidator<InsertDispatchJob, DispatchJob>();

export interface DispatchJobFilters {
  employerId?: string;
  status?: string;
  jobTypeId?: string;
  startYmdFrom?: string;
  startYmdTo?: string;
  running?: boolean;
}

export interface DispatchStatusCounts {
  pending: number;
  notified: number;
  accepted: number;
  layoff: number;
  resigned: number;
  declined: number;
}

export interface DispatchJobWithRelations extends DispatchJob {
  employer?: { id: string; name: string };
  jobType?: { id: string; name: string; data: unknown } | null;
  acceptedCount?: number;
  statusCounts?: DispatchStatusCounts;
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
  const client = getClient();
  const [jobType] = await client.select({ name: optionsDispatchJobType.name })
    .from(optionsDispatchJobType)
    .where(eq(optionsDispatchJobType.id, jobTypeId));
  return jobType?.name || '';
}

export const dispatchJobLoggingConfig = defineLoggingConfig<DispatchJobStorage>({
  module: 'dispatchJobs',
  state: { key: 'job' },
  hostEntityIdField: 'employerId',
  methods: {
    create: {
      state: { fallbackId: 'new dispatch job' },
      // Legacy semantics: fall back to the insert payload's employerId on the
      // error path (when result is undefined). The create shortcut only reads
      // result, so override here.
      getHostEntityId: (args, result) => result?.employerId || args[0]?.employerId,
      metadata: async (_args, result) => ({
        jobId: result?.id,
        employerId: result?.employerId,
        title: result?.title,
        jobTypeName: await getJobTypeName(result?.jobTypeId),
        status: result?.status,
      }),
      getDescription: async (args, result) => {
        const title = result?.title || args[0]?.title || 'Unnamed';
        const jobTypeName = await getJobTypeName(result?.jobTypeId || args[0]?.jobTypeId);
        const typeLabel = jobTypeName ? ` (${jobTypeName})` : '';
        return `Created Dispatch Job "${title}"${typeLabel}`;
      },
    },
    update: {
      // Custom before: also caches jobTypeName so the delete-style description
      // path has it available without an extra query. The default before would
      // only return `{ job }`.
      before: async (args, storage) => {
        const job = await storage.get(args[0]);
        if (!job) return null;
        const jobTypeName = await getJobTypeName(job.jobTypeId);
        return { job, jobTypeName };
      },
      state: { previousKey: 'previousState' },
      metadata: async (_args, result, beforeState) => ({
        jobId: result?.id,
        employerId: result?.employerId,
        title: result?.title,
        jobTypeName: await getJobTypeName(result?.jobTypeId),
        status: result?.status,
        previousStatus: beforeState?.job?.status,
      }),
      getDescription: async (_args, result, beforeState) => {
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
    },
    delete: {
      before: async (args, storage) => {
        const job = await storage.get(args[0]);
        if (!job) return null;
        const jobTypeName = await getJobTypeName(job.jobTypeId);
        return { job, jobTypeName };
      },
      getDescription: async (_args, _result, beforeState) => {
        const title = beforeState?.job?.title || 'Unknown';
        const jobTypeName = beforeState?.jobTypeName || '';
        const typeLabel = jobTypeName ? ` (${jobTypeName})` : '';
        return `Deleted Dispatch Job "${title}"${typeLabel}`;
      },
    },
  },
});

export function createDispatchJobStorage(): DispatchJobStorage {
  return {
    async getAll(): Promise<DispatchJob[]> {
      const client = getClient();
      return client.select().from(dispatchJobs).orderBy(desc(dispatchJobs.createdAt));
    },

    async getPaginated(page: number, limit: number, filters?: DispatchJobFilters): Promise<PaginatedDispatchJobs> {
      const client = getClient();
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
      if (filters?.startYmdFrom) {
        conditions.push(gte(dispatchJobs.startYmd, filters.startYmdFrom));
      }
      if (filters?.startYmdTo) {
        conditions.push(lte(dispatchJobs.startYmd, filters.startYmdTo));
      }
      if (filters?.running !== undefined) {
        conditions.push(eq(dispatchJobs.running, filters.running));
      }
      
      const hasFilters = conditions.length > 0;
      const whereClause = hasFilters ? and(...conditions) : undefined;
      
      const countQuery = client
        .select({ count: sql<number>`count(*)::int` })
        .from(dispatchJobs);
      
      const [countResult] = hasFilters 
        ? await countQuery.where(whereClause!)
        : await countQuery;
      
      const total = countResult?.count || 0;
      
      const baseQuery = client
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
        ? await baseQuery.where(whereClause!).orderBy(desc(dispatchJobs.startYmd)).limit(limit).offset(page * limit)
        : await baseQuery.orderBy(desc(dispatchJobs.startYmd)).limit(limit).offset(page * limit);
      
      const jobIds = rows.map(r => r.job.id);
      
      const acceptedCounts = jobIds.length > 0 
        ? await client
            .select({ 
              jobId: dispatches.jobId,
              count: sql<number>`count(*)::int` 
            })
            .from(dispatches)
            .where(and(
              inArray(dispatches.jobId, jobIds),
              eq(dispatches.status, 'accepted')
            ))
            .groupBy(dispatches.jobId)
        : [];
      
      const acceptedCountMap = new Map(acceptedCounts.map(r => [r.jobId, r.count]));
      
      const data: DispatchJobWithRelations[] = rows.map(row => ({
        ...row.job,
        employer: row.employer || undefined,
        jobType: row.jobType,
        acceptedCount: acceptedCountMap.get(row.job.id) || 0,
      }));
      
      return { data, total, page, limit };
    },

    async get(id: string): Promise<DispatchJob | undefined> {
      const client = getClient();
      const [job] = await client.select().from(dispatchJobs).where(eq(dispatchJobs.id, id));
      return job || undefined;
    },

    async getWithRelations(id: string): Promise<DispatchJobWithRelations | undefined> {
      const client = getClient();
      const [row] = await client
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
      
      const statusCountsResult = await client
        .select({ 
          status: dispatches.status,
          count: sql<number>`count(*)::int` 
        })
        .from(dispatches)
        .where(eq(dispatches.jobId, id))
        .groupBy(dispatches.status);
      
      const statusCounts: DispatchStatusCounts = {
        pending: 0,
        notified: 0,
        accepted: 0,
        layoff: 0,
        resigned: 0,
        declined: 0,
      };
      
      for (const row of statusCountsResult) {
        if (row.status in statusCounts) {
          statusCounts[row.status as keyof DispatchStatusCounts] = row.count;
        }
      }
      
      return {
        ...row.job,
        employer: row.employer || undefined,
        jobType: row.jobType,
        acceptedCount: statusCounts.accepted,
        statusCounts,
      };
    },

    async getByEmployer(employerId: string): Promise<DispatchJob[]> {
      const client = getClient();
      return client.select().from(dispatchJobs)
        .where(eq(dispatchJobs.employerId, employerId))
        .orderBy(desc(dispatchJobs.startYmd));
    },

    async create(insertJob: InsertDispatchJob): Promise<DispatchJob> {
      validate.validateOrThrow(insertJob);
      const client = getClient();
      const [job] = await client.insert(dispatchJobs).values(insertJob).returning();
      return job;
    },

    async update(id: string, jobUpdate: Partial<InsertDispatchJob & { running?: boolean }>): Promise<DispatchJob | undefined> {
      const client = getClient();
      
      const [existingJob] = await client.select().from(dispatchJobs).where(eq(dispatchJobs.id, id));
      if (!existingJob) {
        return undefined;
      }
      
      const updates = { ...jobUpdate };
      
      if (updates.running === true && existingJob.status !== 'open') {
        throw new Error('Cannot set job to running unless status is open');
      }
      
      if (updates.status !== undefined && updates.status !== 'open' && existingJob.running) {
        updates.running = false;
      }
      
      const [job] = await client
        .update(dispatchJobs)
        .set(updates)
        .where(eq(dispatchJobs.id, id))
        .returning();
      return job || undefined;
    },

    async delete(id: string): Promise<boolean> {
      const client = getClient();
      const result = await client.delete(dispatchJobs).where(eq(dispatchJobs.id, id)).returning();
      return result.length > 0;
    }
  };
}
