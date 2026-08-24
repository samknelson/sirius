import { createNoopValidator } from '../utils/validation';
import { getClient, onAfterCommit, runInTransaction } from '../transaction-context';
import {
  dispatchJobFore,
  dispatches,
  dispatchJobs,
  workers,
  contacts,
  employers,
  type DispatchJob,
  type DispatchJobFore,
  type InsertDispatchJobFore,
} from "@shared/schema";
import { eq, and, notExists, asc, desc, sql } from "drizzle-orm";
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

export interface DispatchJobForeWithJob extends DispatchJobFore {
  job?: {
    id: string;
    title: string;
    startYmd: string;
    employer?: {
      id: string;
      name: string;
    } | null;
  } | null;
}

/** A foreperson row flattened with the names a picker needs to label it. */
export interface DispatchJobForeWithNames extends DispatchJobFore {
  jobTitle: string | null;
  employerName: string | null;
  workerName: string | null;
}

export interface DispatchJobForeStorage {
  getByJob(jobId: string): Promise<DispatchJobForeWithWorker[]>;
  /** Foreperson rows for a worker joined with job and employer info. Read-only. */
  getByWorker(workerId: string): Promise<DispatchJobForeWithJob[]>;
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

/**
 * The job the membership is on, read once per write: the whole row for the
 * event (a consumer that re-read it could describe a later rename — or find
 * the job deleted and drop a removal notice that was genuinely earned), plus
 * the employer's name for the activity-log wording.
 *
 * Called inside the writing transaction. Under READ COMMITTED a rename
 * committing between this read and the write is still possible; the job is
 * only NAMED by the notice (the membership is what it is about), so a title
 * a moment stale or fresh is not a correctness problem — and locking every
 * job a foreperson is added to would be.
 */
async function getJobContext(
  jobId: string | undefined,
): Promise<{ job: DispatchJob | null; title: string; employerName: string }> {
  if (!jobId) return { job: null, title: 'Unknown Job', employerName: 'Unknown Employer' };
  const client = getClient();
  const [row] = await client
    .select({ job: dispatchJobs, employerName: employers.name })
    .from(dispatchJobs)
    .leftJoin(employers, eq(dispatchJobs.employerId, employers.id))
    .where(eq(dispatchJobs.id, jobId));
  return {
    job: row?.job ?? null,
    title: row?.job?.title || 'Unknown Job',
    employerName: row?.employerName || 'Unknown Employer',
  };
}

/**
 * Emit after the writing transaction commits: handlers start the moment
 * `emit` is called, so emitting inside the transaction would notify a worker
 * of a foreperson change that can still roll back — and let handlers run
 * through the ambient transaction. The snapshots were already captured
 * inside it, so nothing is re-read here.
 */
function emitForeSaved(
  fore: DispatchJobFore,
  action: "added" | "removed",
  job: DispatchJob,
): void {
  onAfterCommit(() => {
    eventBus.emit(EventType.DISPATCH_FORE_SAVED, {
      foreId: fore.id,
      jobId: fore.jobId,
      workerId: fore.workerId,
      action,
      fore,
      job,
    }).catch(err => {
      console.error("Failed to emit DISPATCH_FORE_SAVED event:", err);
    });
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
        const jobLabel = await getJobContext(result?.jobId || args[0]?.jobId);
        return `Added ${workerName} as Foreperson on "${jobLabel.title}" (${jobLabel.employerName})`;
      },
    },
    delete: {
      getDescription: async (_args, _result, beforeState) => {
        if (beforeState?.fore) {
          const workerName = await getWorkerName(beforeState.fore.workerId);
          const jobLabel = await getJobContext(beforeState.fore.jobId);
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


    async getByWorker(workerId: string): Promise<DispatchJobForeWithJob[]> {
      const client = getClient();
      const rows = await client
        .select({
          fore: dispatchJobFore,
          job: {
            id: dispatchJobs.id,
            title: dispatchJobs.title,
            startYmd: dispatchJobs.startYmd,
          },
          employer: {
            id: employers.id,
            name: employers.name,
          },
        })
        .from(dispatchJobFore)
        .leftJoin(dispatchJobs, eq(dispatchJobFore.jobId, dispatchJobs.id))
        .leftJoin(employers, eq(dispatchJobs.employerId, employers.id))
        .where(eq(dispatchJobFore.workerId, workerId))
        .orderBy(asc(dispatchJobs.startYmd));

      return rows.map(row => ({
        ...row.fore,
        job: row.job ? { ...row.job, employer: row.employer } : null,
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
      // One transaction for the write and the job snapshot that rides on
      // its event: read the job separately and it is a different point in
      // time, so a concurrent rename or deletion could reword the notice or
      // leave it with no job to describe at all.
      return runInTransaction(async () => {
        const client = getClient();
        const { job } = await getJobContext(insertFore.jobId);
        const [fore] = await client.insert(dispatchJobFore).values(insertFore).returning();
        // The membership's FK guarantees the job exists in this transaction.
        if (job) emitForeSaved(fore, "added", job);
        return fore;
      });
    },

    async delete(id: string): Promise<boolean> {
      return runInTransaction(async () => {
        const client = getClient();
        // The membership row is gone after the delete, and the job it was
        // on can only be read while it is still there, so both are captured
        // inside the transaction that removes it.
        const existing = await this.get(id);
        const { job } = await getJobContext(existing?.jobId);
        const [deleted] = await client.delete(dispatchJobFore).where(eq(dispatchJobFore.id, id)).returning();
        if (!deleted) return false;
        if (job) emitForeSaved(deleted, "removed", job);
        return true;
      });
    },
  };
}
