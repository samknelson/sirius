import { createNoopValidator } from '../utils/validation';
import { getClient, runInTransaction } from '../transaction-context';
import { 
  dispatches, 
  dispatchJobs,
  optionsDispatchJobType,
  workers,
  contacts,
  comm,
  employers,
  workerDispatchStatus,
  type Dispatch, 
  type InsertDispatch,
  type DispatchStatus,
  type JobTypeData,
  type JobTypePrimarySetting,
  type Comm
} from "@shared/schema";
import { eq, desc, and, inArray, ne, arrayContains } from "drizzle-orm";
import { eventBus, EventType } from "../../services/event-bus";
import { defineLoggingConfig, withStorageLogging } from "../middleware/logging";
import { createWorkerDispatchStatusStorage, workerDispatchStatusLoggingConfig } from "./worker-status";

/**
 * Stub validator - add validation logic here when needed
 */
export const validate = createNoopValidator<InsertDispatch, Dispatch>();

/**
 * Name of the partial unique index enforcing "at most one accepted primary
 * dispatch per worker" (see shared/schema/dispatch/schema.ts and core
 * migration 1052).
 */
const ONE_PRIMARY_ACCEPTED_INDEX = "dispatches_one_primary_accepted_per_worker";

export const PRIMARY_DISPATCH_CONFLICT_MESSAGE =
  "This worker already has an accepted primary dispatch. A worker can only have one accepted primary dispatch at a time.";

/** Error thrown when a change would create a second accepted primary dispatch for a worker. */
export class PrimaryDispatchConflictError extends Error {
  constructor() {
    super(PRIMARY_DISPATCH_CONFLICT_MESSAGE);
    this.name = "PrimaryDispatchConflictError";
  }
}

function isPrimaryDispatchUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; constraint?: string; message?: string } | null;
  if (!e) return false;
  return (
    e.code === "23505" &&
    (e.constraint === ONE_PRIMARY_ACCEPTED_INDEX ||
      (typeof e.message === "string" && e.message.includes(ONE_PRIMARY_ACCEPTED_INDEX)))
  );
}

export interface CommSummary {
  id: string;
  medium: string;
  status: string;
  sent: Date | null;
}

export interface DispatchWithRelations extends Dispatch {
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
  job?: {
    id: string;
    title: string;
    employerId: string;
    startYmd: string;
    payRate: string | null;
    startTime: string | null;
    endTime: string | null;
    employer?: {
      id: string;
      name: string;
    } | null;
  } | null;
  comms?: CommSummary[];
}

export interface SetStatusResult {
  possible: boolean;
  reason?: string;
}

export interface DispatchStorage {
  getAll(): Promise<Dispatch[]>;
  get(id: string): Promise<Dispatch | undefined>;
  getWithRelations(id: string): Promise<DispatchWithRelations | undefined>;
  getByJob(jobId: string): Promise<DispatchWithRelations[]>;
  getByWorker(workerId: string): Promise<DispatchWithRelations[]>;
  create(dispatch: InsertDispatch): Promise<Dispatch>;
  update(id: string, dispatch: Partial<InsertDispatch>): Promise<Dispatch | undefined>;
  delete(id: string): Promise<boolean>;
  setStatusPossible(dispatchId: string, newStatus: DispatchStatus): Promise<SetStatusResult>;
  setStatus(dispatchId: string, newStatus: DispatchStatus): Promise<{ success: boolean; dispatch?: Dispatch; error?: string }>;
  findByCommId(commId: string): Promise<Dispatch | undefined>;
  expireRemainingIfJobFull(jobId: string): Promise<void>;
  /** Whether the worker currently has an accepted primary dispatch. Read-only. */
  hasAcceptedPrimary(workerId: string): Promise<boolean>;
  /**
   * Integrity-scan query for the `dispatch_primary_unavailable` denorm plugin:
   * distinct worker ids whose dispatch status is "available" while they hold
   * an accepted+primary dispatch (invariant violators), capped at `limit`.
   * Read-only.
   */
  findWorkerIdsAvailableWithAcceptedPrimary(limit: number): Promise<string[]>;
}

async function getJobTitle(jobId: string): Promise<string> {
  const client = getClient();
  const [job] = await client
    .select({ title: dispatchJobs.title })
    .from(dispatchJobs)
    .where(eq(dispatchJobs.id, jobId));
  return job?.title || 'Unknown Job';
}

async function getJobEmployerId(jobId: string): Promise<string | undefined> {
  const client = getClient();
  const [job] = await client
    .select({ employerId: dispatchJobs.employerId })
    .from(dispatchJobs)
    .where(eq(dispatchJobs.id, jobId));
  return job?.employerId;
}

/**
 * Resolve the "Primary?" setting for a job's job type. Defaults to
 * "secondary" when the job has no job type or the setting is absent.
 */
async function getJobPrimarySetting(jobId: string): Promise<JobTypePrimarySetting> {
  const client = getClient();
  const [row] = await client
    .select({ data: optionsDispatchJobType.data })
    .from(dispatchJobs)
    .leftJoin(optionsDispatchJobType, eq(dispatchJobs.jobTypeId, optionsDispatchJobType.id))
    .where(eq(dispatchJobs.id, jobId));
  const setting = (row?.data as JobTypeData | null)?.primary;
  return setting === "primary" || setting === "both" ? setting : "secondary";
}

/** Whether the worker already has an accepted primary dispatch (optionally excluding one dispatch). */
async function workerHasAcceptedPrimary(workerId: string, excludeDispatchId?: string): Promise<boolean> {
  const client = getClient();
  const conditions = [
    eq(dispatches.workerId, workerId),
    eq(dispatches.status, "accepted"),
    eq(dispatches.isPrimary, true),
  ];
  if (excludeDispatchId) {
    conditions.push(ne(dispatches.id, excludeDispatchId));
  }
  const [existing] = await client
    .select({ id: dispatches.id })
    .from(dispatches)
    .where(and(...conditions))
    .limit(1);
  return !!existing;
}

/**
 * Hard invariant: a worker on an accepted PRIMARY dispatch cannot be
 * "available". Called from the same transaction context that accepted the
 * dispatch, so the status flip commits (or rolls back) atomically with the
 * acceptance. Convergent no-op when the status is already `not_available`.
 * Uses the logging-wrapped status storage so the change is audit-logged.
 */
async function setWorkerNotAvailableForAcceptedPrimary(workerId: string): Promise<void> {
  const statusStorage = withStorageLogging(
    createWorkerDispatchStatusStorage(),
    workerDispatchStatusLoggingConfig,
  );
  const current = await statusStorage.getByWorker(workerId);
  if (current?.status === "not_available") return;
  await statusStorage.upsertByWorker(workerId, { status: "not_available" });
}

interface SearchDispatchesCriteria {
  jobId?: string;
  workerId?: string;
}

async function searchDispatches(criteria: SearchDispatchesCriteria): Promise<DispatchWithRelations[]> {
  if (!criteria.jobId && !criteria.workerId) {
    throw new Error('searchDispatches requires at least one criterion (jobId or workerId)');
  }
  
  const client = getClient();
  
  const conditions = [];
  if (criteria.jobId) {
    conditions.push(eq(dispatches.jobId, criteria.jobId));
  }
  if (criteria.workerId) {
    conditions.push(eq(dispatches.workerId, criteria.workerId));
  }

  const baseQuery = client
    .select({
      dispatch: dispatches,
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
      job: {
        id: dispatchJobs.id,
        title: dispatchJobs.title,
        employerId: dispatchJobs.employerId,
        startYmd: dispatchJobs.startYmd,
        payRate: dispatchJobs.payRate,
        startTime: dispatchJobs.startTime,
        endTime: dispatchJobs.endTime,
      },
      employer: {
        id: employers.id,
        name: employers.name,
      },
    })
    .from(dispatches)
    .leftJoin(workers, eq(dispatches.workerId, workers.id))
    .leftJoin(contacts, eq(workers.contactId, contacts.id))
    .leftJoin(dispatchJobs, eq(dispatches.jobId, dispatchJobs.id))
    .leftJoin(employers, eq(dispatchJobs.employerId, employers.id));

  const rows = await baseQuery
    .where(and(...conditions))
    .orderBy(desc(dispatches.startDate));

  const allCommIds = rows.flatMap(row => row.dispatch.commIds || []);
  const commMap = new Map<string, CommSummary>();

  if (allCommIds.length > 0) {
    const commRecords = await client
      .select({
        id: comm.id,
        medium: comm.medium,
        status: comm.status,
        sent: comm.sent,
      })
      .from(comm)
      .where(inArray(comm.id, allCommIds));

    for (const c of commRecords) {
      commMap.set(c.id, {
        id: c.id,
        medium: c.medium,
        status: c.status,
        sent: c.sent,
      });
    }
  }

  return rows.map(row => ({
    ...row.dispatch,
    worker: row.worker ? {
      ...row.worker,
      contact: row.contact,
    } : null,
    job: row.job ? {
      ...row.job,
      employer: row.employer,
    } : null,
    comms: (row.dispatch.commIds || [])
      .map(id => commMap.get(id))
      .filter((c): c is CommSummary => c !== undefined),
  }));
}

export const dispatchLoggingConfig = defineLoggingConfig<DispatchStorage>({
  module: 'dispatches',
  state: { key: 'dispatch' },
  methods: {
    create: {
      state: { fallbackId: 'new dispatch' },
      getHostEntityId: async (args, result) => {
        const jobId = result?.jobId || args[0]?.jobId;
        return jobId ? await getJobEmployerId(jobId) : undefined;
      },
      metadata: (_args, result) => ({
        dispatchId: result?.id,
        jobId: result?.jobId,
        workerId: result?.workerId,
        status: result?.status,
      }),
      getDescription: async (args, result) => {
        const { storage } = await import('../index');
        const workerName = await storage.workers.getWorkerDisplayName(result?.workerId || args[0]?.workerId);
        const jobTitle = await getJobTitle(result?.jobId || args[0]?.jobId);
        return `Created Dispatch for ${workerName} to "${jobTitle}"`;
      },
    },
    update: {
      getHostEntityId: async (_args, result, beforeState) => {
        const jobId = result?.jobId || beforeState?.dispatch?.jobId;
        return jobId ? await getJobEmployerId(jobId) : undefined;
      },
      state: { previousKey: 'previousState' },
      metadata: (_args, result, beforeState) => ({
        dispatchId: result?.id,
        jobId: result?.jobId,
        workerId: result?.workerId,
        status: result?.status,
        previousStatus: beforeState?.dispatch?.status,
      }),
      getDescription: async (_args, result, beforeState) => {
        const { storage } = await import('../index');
        const workerName = await storage.workers.getWorkerDisplayName(result?.workerId || beforeState?.dispatch?.workerId);
        const jobTitle = await getJobTitle(result?.jobId || beforeState?.dispatch?.jobId);
        const oldStatus = beforeState?.dispatch?.status;
        const newStatus = result?.status;
        if (oldStatus && newStatus && oldStatus !== newStatus) {
          return `Updated Dispatch for ${workerName} to "${jobTitle}": ${oldStatus} → ${newStatus}`;
        }
        return `Updated Dispatch for ${workerName} to "${jobTitle}"`;
      },
    },
    delete: {
      getHostEntityId: async (_args, _result, beforeState) => {
        const jobId = beforeState?.dispatch?.jobId;
        return jobId ? await getJobEmployerId(jobId) : undefined;
      },
      getDescription: async (_args, _result, beforeState) => {
        if (!beforeState?.dispatch) return 'Deleted Dispatch';
        const { storage } = await import('../index');
        const workerName = await storage.workers.getWorkerDisplayName(beforeState.dispatch.workerId);
        const jobTitle = await getJobTitle(beforeState.dispatch.jobId);
        return `Deleted Dispatch for ${workerName} from "${jobTitle}"`;
      },
    },
  },
});

export function createDispatchStorage(): DispatchStorage {
  return {
    async getAll(): Promise<Dispatch[]> {
      const client = getClient();
      return client.select().from(dispatches).orderBy(desc(dispatches.startDate));
    },

    async get(id: string): Promise<Dispatch | undefined> {
      const client = getClient();
      const [dispatch] = await client.select().from(dispatches).where(eq(dispatches.id, id));
      return dispatch || undefined;
    },

    async getWithRelations(id: string): Promise<DispatchWithRelations | undefined> {
      const client = getClient();
      const [row] = await client
        .select({
          dispatch: dispatches,
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
          job: {
            id: dispatchJobs.id,
            title: dispatchJobs.title,
            employerId: dispatchJobs.employerId,
            startYmd: dispatchJobs.startYmd,
            payRate: dispatchJobs.payRate,
            startTime: dispatchJobs.startTime,
            endTime: dispatchJobs.endTime,
          },
        })
        .from(dispatches)
        .leftJoin(workers, eq(dispatches.workerId, workers.id))
        .leftJoin(contacts, eq(workers.contactId, contacts.id))
        .leftJoin(dispatchJobs, eq(dispatches.jobId, dispatchJobs.id))
        .where(eq(dispatches.id, id));

      if (!row) return undefined;

      // Fetch comm records for this dispatch
      const commIds = row.dispatch.commIds || [];
      let comms: CommSummary[] = [];
      
      if (commIds.length > 0) {
        const commRecords = await client
          .select({
            id: comm.id,
            medium: comm.medium,
            status: comm.status,
            sent: comm.sent,
          })
          .from(comm)
          .where(inArray(comm.id, commIds));

        comms = commRecords.map(c => ({
          id: c.id,
          medium: c.medium,
          status: c.status,
          sent: c.sent,
        }));
      }

      return {
        ...row.dispatch,
        worker: row.worker ? {
          ...row.worker,
          contact: row.contact,
        } : null,
        job: row.job,
        comms,
      };
    },

    async getByJob(jobId: string): Promise<DispatchWithRelations[]> {
      return searchDispatches({ jobId });
    },

    async getByWorker(workerId: string): Promise<DispatchWithRelations[]> {
      return searchDispatches({ workerId });
    },

    async findByCommId(commId: string): Promise<Dispatch | undefined> {
      const client = getClient();
      const [dispatch] = await client
        .select()
        .from(dispatches)
        .where(arrayContains(dispatches.commIds, [commId]))
        .limit(1);
      return dispatch || undefined;
    },

    async create(insertDispatch: InsertDispatch): Promise<Dispatch> {
      validate.validateOrThrow(insertDispatch);
      const client = getClient();

      // is_primary is server-derived from the job type's "Primary?" setting.
      // Any caller-supplied value is ignored (the insert schema omits it too).
      const primarySetting = await getJobPrimarySetting(insertDispatch.jobId);
      let isPrimary = false;
      if (primarySetting === "primary") {
        isPrimary = true;
      } else if (primarySetting === "both") {
        isPrimary = !(await workerHasAcceptedPrimary(insertDispatch.workerId));
      }

      // Insert + (when accepted primary) the worker-status flip run in ONE
      // transaction so the hard rule "accepted primary ⇒ not available" is
      // atomic with the dispatch write. A unique violation aborts the whole
      // transaction, so the race-safe retry runs as a fresh transaction.
      const insertAttempt = (isPrimaryValue: boolean): Promise<Dispatch> =>
        runInTransaction(async () => {
          const tx = getClient();
          const [created] = await tx.insert(dispatches).values({ ...insertDispatch, isPrimary: isPrimaryValue }).returning();
          if (created.status === "accepted" && created.isPrimary) {
            await setWorkerNotAvailableForAcceptedPrimary(created.workerId);
          }
          return created;
        });

      let dispatch: Dispatch;
      try {
        dispatch = await insertAttempt(isPrimary);
      } catch (err) {
        if (isPrimaryDispatchUniqueViolation(err)) {
          if (primarySetting === "both") {
            // Race-safe fallback: someone else grabbed the primary slot
            // between our pre-check and the insert. Retry as secondary.
            dispatch = await insertAttempt(false);
            eventBus.emit(EventType.DISPATCH_SAVED, {
              dispatchId: dispatch.id,
              workerId: dispatch.workerId,
              jobId: dispatch.jobId,
              status: dispatch.status,
              previousStatus: undefined,
            }).catch(emitErr => {
              console.error("Failed to emit DISPATCH_SAVED event from create:", emitErr);
            });
            return dispatch;
          }
          throw new PrimaryDispatchConflictError();
        }
        throw err;
      }

      eventBus.emit(EventType.DISPATCH_SAVED, {
        dispatchId: dispatch.id,
        workerId: dispatch.workerId,
        jobId: dispatch.jobId,
        status: dispatch.status,
        previousStatus: undefined,
      }).catch(err => {
        console.error("Failed to emit DISPATCH_SAVED event from create:", err);
      });

      return dispatch;
    },

    async update(id: string, dispatchUpdate: Partial<InsertDispatch>): Promise<Dispatch | undefined> {
      validate.validateOrThrow(dispatchUpdate);
      const client = getClient();
      try {
        const [existing] = await client.select().from(dispatches).where(eq(dispatches.id, id));
        // Update + (when the row ends up accepted primary) the worker-status
        // flip run in ONE transaction: the hard rule "accepted primary ⇒ not
        // available" must hold for direct updates too, not just setStatus.
        const dispatch = await runInTransaction(async () => {
          const tx = getClient();
          const [updated] = await tx
            .update(dispatches)
            .set(dispatchUpdate)
            .where(eq(dispatches.id, id))
            .returning();
          if (updated && updated.status === "accepted" && updated.isPrimary) {
            await setWorkerNotAvailableForAcceptedPrimary(updated.workerId);
          }
          return updated;
        });
        if (dispatch) {
          eventBus.emit(EventType.DISPATCH_SAVED, {
            dispatchId: dispatch.id,
            workerId: dispatch.workerId,
            jobId: dispatch.jobId,
            status: dispatch.status,
            previousStatus: existing?.status,
          }).catch(err => {
            console.error("Failed to emit DISPATCH_SAVED event from update:", err);
          });
        }
        return dispatch || undefined;
      } catch (err) {
        if (isPrimaryDispatchUniqueViolation(err)) {
          throw new PrimaryDispatchConflictError();
        }
        throw err;
      }
    },

    async delete(id: string): Promise<boolean> {
      const client = getClient();
      const result = await client.delete(dispatches).where(eq(dispatches.id, id)).returning();
      return result.length > 0;
    },

    async setStatusPossible(dispatchId: string, newStatus: DispatchStatus): Promise<SetStatusResult> {
      const client = getClient();
      
      const [dispatch] = await client.select().from(dispatches).where(eq(dispatches.id, dispatchId));
      if (!dispatch) {
        return { possible: false, reason: "Dispatch not found" };
      }

      const [job] = await client.select().from(dispatchJobs).where(eq(dispatchJobs.id, dispatch.jobId));
      if (!job) {
        return { possible: false, reason: "Job not found" };
      }

      const currentStatus = dispatch.status;

      switch (newStatus) {
        case "pending":
          return { possible: true };
        
        case "notified": {
          if (job.status !== "open") {
            return { possible: false, reason: `Job must be open to notify workers (current status: ${job.status})` };
          }
          
          const workerCount = job.workerCount;
          if (workerCount != null && workerCount > 0) {
            const acceptedDispatches = await client
              .select()
              .from(dispatches)
              .where(and(
                eq(dispatches.jobId, dispatch.jobId),
                eq(dispatches.status, "accepted")
              ));
            
            if (acceptedDispatches.length >= workerCount) {
              return { possible: false, reason: `Job is full (${acceptedDispatches.length}/${workerCount} workers accepted)` };
            }
          }
          
          return { possible: true };
        }

        case "declined": {
          if (currentStatus !== "pending" && currentStatus !== "notified") {
            return { possible: false, reason: `Can only decline from pending or notified status (current: ${currentStatus})` };
          }
          return { possible: true };
        }

        case "layoff":
        case "resigned": {
          if (currentStatus !== "accepted") {
            return { possible: false, reason: `Can only set ${newStatus} from accepted status (current: ${currentStatus})` };
          }
          return { possible: true };
        }

        case "accepted": {
          const workerCount = job.workerCount;
          if (workerCount != null && workerCount > 0) {
            const acceptedDispatches = await client
              .select()
              .from(dispatches)
              .where(and(
                eq(dispatches.jobId, dispatch.jobId),
                eq(dispatches.status, "accepted"),
                ne(dispatches.id, dispatchId)
              ));
            
            if (acceptedDispatches.length >= workerCount) {
              return { possible: false, reason: `Job is full (${acceptedDispatches.length}/${workerCount} workers accepted)` };
            }
          }
          return { possible: true };
        }
        
        default:
          return { possible: false, reason: `Status transition to "${newStatus}" is not implemented` };
      }
    },

    async setStatus(dispatchId: string, newStatus: DispatchStatus): Promise<{ success: boolean; dispatch?: Dispatch; error?: string }> {
      const client = getClient();
      
      const checkResult = await this.setStatusPossible(dispatchId, newStatus);
      if (!checkResult.possible) {
        return { success: false, error: checkResult.reason };
      }

      const [currentDispatch] = await client.select().from(dispatches).where(eq(dispatches.id, dispatchId));
      if (!currentDispatch) {
        return { success: false, error: "Dispatch not found" };
      }

      const previousStatus = currentDispatch.status;

      // On acceptance, re-derive is_primary from the job type's "Primary?"
      // setting: "primary" → true (conflict surfaces as a clear error),
      // "secondary" → false, "both" → primary only if no other accepted
      // primary dispatch exists for the worker (race-safe fallback below).
      const updateSet: { status: DispatchStatus; isPrimary?: boolean } = { status: newStatus };
      let primarySetting: JobTypePrimarySetting | undefined;
      if (newStatus === "accepted") {
        primarySetting = await getJobPrimarySetting(currentDispatch.jobId);
        if (primarySetting === "primary") {
          updateSet.isPrimary = true;
        } else if (primarySetting === "secondary") {
          updateSet.isPrimary = false;
        } else {
          updateSet.isPrimary = !(await workerHasAcceptedPrimary(currentDispatch.workerId, dispatchId));
        }
      }

      // Status update + (when accepted primary) the worker-status flip run in
      // ONE transaction so the hard rule "accepted primary ⇒ not available"
      // is atomic with the acceptance. A unique violation aborts the whole
      // transaction, so the race-safe retry runs as a fresh transaction and
      // only fires the flip when the dispatch truly ended up primary (the
      // retry demotes a "both"-type to secondary).
      const updateAttempt = (set: { status: DispatchStatus; isPrimary?: boolean }): Promise<Dispatch | undefined> =>
        runInTransaction(async () => {
          const tx = getClient();
          const [updated] = await tx
            .update(dispatches)
            .set(set)
            .where(eq(dispatches.id, dispatchId))
            .returning();
          if (updated && updated.status === "accepted" && updated.isPrimary) {
            await setWorkerNotAvailableForAcceptedPrimary(updated.workerId);
          }
          return updated;
        });

      let updatedDispatch: Dispatch | undefined;
      try {
        updatedDispatch = await updateAttempt(updateSet);
      } catch (err) {
        if (isPrimaryDispatchUniqueViolation(err)) {
          if (newStatus === "accepted" && primarySetting === "both") {
            // Race-safe fallback: another dispatch became the accepted
            // primary between our pre-check and the update. Accept as secondary.
            try {
              updatedDispatch = await updateAttempt({ status: newStatus, isPrimary: false });
            } catch (retryErr) {
              if (isPrimaryDispatchUniqueViolation(retryErr)) {
                return { success: false, error: PRIMARY_DISPATCH_CONFLICT_MESSAGE };
              }
              throw retryErr;
            }
          } else {
            return { success: false, error: PRIMARY_DISPATCH_CONFLICT_MESSAGE };
          }
        } else {
          throw err;
        }
      }

      if (!updatedDispatch) {
        return { success: false, error: "Failed to update dispatch status" };
      }

      eventBus.emit(EventType.DISPATCH_SAVED, {
        dispatchId: updatedDispatch.id,
        workerId: updatedDispatch.workerId,
        jobId: updatedDispatch.jobId,
        status: updatedDispatch.status,
        previousStatus,
      }).catch(err => {
        console.error("Failed to emit DISPATCH_SAVED event:", err);
      });

      if (newStatus === "accepted") {
        this.expireRemainingIfJobFull(updatedDispatch.jobId).catch(err => {
          console.error("Failed to expire remaining dispatches after accept:", err);
        });
      }

      return { success: true, dispatch: updatedDispatch };
    },

    async hasAcceptedPrimary(workerId: string): Promise<boolean> {
      return workerHasAcceptedPrimary(workerId);
    },

    async findWorkerIdsAvailableWithAcceptedPrimary(limit: number): Promise<string[]> {
      const client = getClient();
      const rows = await client
        .selectDistinct({ workerId: dispatches.workerId })
        .from(dispatches)
        .innerJoin(
          workerDispatchStatus,
          eq(workerDispatchStatus.workerId, dispatches.workerId),
        )
        .where(and(
          eq(dispatches.status, "accepted"),
          eq(dispatches.isPrimary, true),
          eq(workerDispatchStatus.status, "available"),
        ))
        .limit(limit);
      return rows.map((r) => r.workerId);
    },

    async expireRemainingIfJobFull(jobId: string): Promise<void> {
      const client = getClient();

      const [job] = await client.select().from(dispatchJobs).where(eq(dispatchJobs.id, jobId));
      if (!job) return;

      const workerCount = job.workerCount;
      if (workerCount == null || workerCount <= 0) return;

      const acceptedDispatches = await client
        .select()
        .from(dispatches)
        .where(and(
          eq(dispatches.jobId, jobId),
          eq(dispatches.status, "accepted")
        ));

      if (acceptedDispatches.length < workerCount) return;

      const remaining = await client
        .select()
        .from(dispatches)
        .where(and(
          eq(dispatches.jobId, jobId),
          inArray(dispatches.status, ["pending", "notified"])
        ));

      for (const d of remaining) {
        await client
          .update(dispatches)
          .set({ status: "declined" })
          .where(eq(dispatches.id, d.id));

        eventBus.emit(EventType.DISPATCH_SAVED, {
          dispatchId: d.id,
          workerId: d.workerId,
          jobId: d.jobId,
          status: "declined",
          previousStatus: d.status,
        }).catch(err => {
          console.error("Failed to emit DISPATCH_SAVED event for auto-declined dispatch:", err);
        });
      }
    }
  };
}
