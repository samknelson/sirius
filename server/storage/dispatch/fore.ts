import { createNoopValidator } from '../utils/validation';
import { getClient } from '../transaction-context';
import {
  dispatchJobFore,
  dispatches,
  dispatchJobs,
  workers,
  contacts,
  employers,
  type DispatchJobFore,
  type InsertDispatchJobFore,
} from "@shared/schema";
import { eq, and, notExists, asc } from "drizzle-orm";
import { defineLoggingConfig } from "../middleware/logging";
import { eventBus, EventType } from "../../services/event-bus";

/**
 * Stub validator - add validation logic here when needed
 */
export const validate = createNoopValidator<InsertDispatchJobFore, DispatchJobFore>();

export interface DispatchJobForeWithWorker extends DispatchJobFore {
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

export interface ForeEligibleWorker {
  id: string;
  siriusId: number | null;
  displayName: string | null;
}

export interface DispatchJobForeStorage {
  getByJob(jobId: string): Promise<DispatchJobForeWithWorker[]>;
  get(id: string): Promise<DispatchJobFore | undefined>;
  getByJobAndWorker(jobId: string, workerId: string): Promise<DispatchJobFore | undefined>;
  /**
   * Workers with an accepted primary dispatch at the job's employer who are
   * not already forepersons on the job. Pure read used by the add-foreperson
   * picker and the route-level eligibility check; the storage layer does NOT
   * enforce eligibility on create.
   */
  getEligibleWorkers(jobId: string): Promise<ForeEligibleWorker[]>;
  create(fore: InsertDispatchJobFore): Promise<DispatchJobFore>;
  delete(id: string): Promise<boolean>;
}

async function getWorkerName(workerId: string | undefined): Promise<string> {
  if (!workerId) return 'Unknown Worker';
  const { storage } = await import('../index');
  return storage.workers.getWorkerDisplayName(workerId);
}

async function getJobLabel(jobId: string | undefined): Promise<{ title: string; employerName: string }> {
  if (!jobId) return { title: 'Unknown Job', employerName: 'Unknown Employer' };
  const client = getClient();
  const [row] = await client
    .select({ title: dispatchJobs.title, employerName: employers.name })
    .from(dispatchJobs)
    .leftJoin(employers, eq(dispatchJobs.employerId, employers.id))
    .where(eq(dispatchJobs.id, jobId));
  return { title: row?.title || 'Unknown Job', employerName: row?.employerName || 'Unknown Employer' };
}

function emitForeSaved(
  fore: DispatchJobFore,
  action: "added" | "removed",
  jobLabel: { title: string; employerName: string },
): void {
  eventBus.emit(EventType.DISPATCH_FORE_SAVED, {
    foreId: fore.id,
    jobId: fore.jobId,
    workerId: fore.workerId,
    action,
    jobTitle: jobLabel.title,
    employerName: jobLabel.employerName,
  }).catch(err => {
    console.error("Failed to emit DISPATCH_FORE_SAVED event:", err);
  });
}

export const dispatchJobForeLoggingConfig = defineLoggingConfig<DispatchJobForeStorage>({
  module: 'dispatch-job-fore',
  state: { key: 'fore' },
  hostEntityId: (args, result, before) =>
    result?.workerId ?? before?.fore?.workerId ?? args[0]?.workerId,
  methods: {
    create: {
      getEntityId: (_args, result) => result?.id || 'new dispatch job foreperson',
      getDescription: async (args, result) => {
        const workerName = await getWorkerName(result?.workerId || args[0]?.workerId);
        const jobLabel = await getJobLabel(result?.jobId || args[0]?.jobId);
        return `Added ${workerName} as Foreperson on "${jobLabel.title}" (${jobLabel.employerName})`;
      },
    },
    delete: {
      getDescription: async (_args, _result, beforeState) => {
        if (beforeState?.fore) {
          const workerName = await getWorkerName(beforeState.fore.workerId);
          const jobLabel = await getJobLabel(beforeState.fore.jobId);
          return `Removed ${workerName} as Foreperson on "${jobLabel.title}" (${jobLabel.employerName})`;
        }
        return 'Removed dispatch job foreperson';
      },
    },
  },
});

export function createDispatchJobForeStorage(): DispatchJobForeStorage {
  return {
    async getByJob(jobId: string): Promise<DispatchJobForeWithWorker[]> {
      const client = getClient();
      const rows = await client
        .select({
          fore: dispatchJobFore,
          worker: {
            id: workers.id,
            siriusId: workers.siriusId,
          },
          contact: {
            id: contacts.id,
            given: contacts.given,
            family: contacts.family,
            displayName: contacts.displayName,
          },
        })
        .from(dispatchJobFore)
        .leftJoin(workers, eq(dispatchJobFore.workerId, workers.id))
        .leftJoin(contacts, eq(workers.contactId, contacts.id))
        .where(eq(dispatchJobFore.jobId, jobId))
        .orderBy(asc(contacts.displayName));

      return rows.map(row => ({
        ...row.fore,
        worker: row.worker
          ? { ...row.worker, contact: row.contact || null }
          : null,
      }));
    },

    async get(id: string): Promise<DispatchJobFore | undefined> {
      const client = getClient();
      const [row] = await client.select().from(dispatchJobFore).where(eq(dispatchJobFore.id, id));
      return row || undefined;
    },

    async getByJobAndWorker(jobId: string, workerId: string): Promise<DispatchJobFore | undefined> {
      const client = getClient();
      const [row] = await client
        .select()
        .from(dispatchJobFore)
        .where(and(eq(dispatchJobFore.jobId, jobId), eq(dispatchJobFore.workerId, workerId)));
      return row || undefined;
    },

    async getEligibleWorkers(jobId: string): Promise<ForeEligibleWorker[]> {
      const client = getClient();
      const [job] = await client
        .select({ id: dispatchJobs.id, employerId: dispatchJobs.employerId })
        .from(dispatchJobs)
        .where(eq(dispatchJobs.id, jobId));
      if (!job) return [];

      const rows = await client
        .selectDistinct({
          id: workers.id,
          siriusId: workers.siriusId,
          displayName: contacts.displayName,
        })
        .from(dispatches)
        .innerJoin(dispatchJobs, eq(dispatches.jobId, dispatchJobs.id))
        .innerJoin(workers, eq(dispatches.workerId, workers.id))
        .leftJoin(contacts, eq(workers.contactId, contacts.id))
        .where(and(
          eq(dispatchJobs.employerId, job.employerId),
          eq(dispatches.status, 'accepted'),
          eq(dispatches.isPrimary, true),
          notExists(
            client
              .select({ id: dispatchJobFore.id })
              .from(dispatchJobFore)
              .where(and(
                eq(dispatchJobFore.jobId, jobId),
                eq(dispatchJobFore.workerId, workers.id),
              ))
          ),
        ))
        .orderBy(asc(contacts.displayName));

      return rows;
    },

    async create(insertFore: InsertDispatchJobFore): Promise<DispatchJobFore> {
      validate.validateOrThrow(insertFore);
      const client = getClient();
      const [fore] = await client.insert(dispatchJobFore).values(insertFore).returning();
      const jobLabel = await getJobLabel(fore.jobId);
      emitForeSaved(fore, "added", jobLabel);
      return fore;
    },

    async delete(id: string): Promise<boolean> {
      const client = getClient();
      const [deleted] = await client.delete(dispatchJobFore).where(eq(dispatchJobFore.id, id)).returning();
      if (!deleted) return false;
      const jobLabel = await getJobLabel(deleted.jobId);
      emitForeSaved(deleted, "removed", jobLabel);
      return true;
    },
  };
}
