import { createNoopValidator } from './utils/validation';
import { getClient } from './transaction-context';
import { 
  dispatches, 
  dispatchJobs,
  workers,
  contacts,
  type Dispatch, 
  type InsertDispatch,
  type DispatchStatus
} from "@shared/schema";
import { eq, desc, and } from "drizzle-orm";
import { eventBus, EventType } from "../services/event-bus";
import { type StorageLoggingConfig } from "./middleware/logging";

/**
 * Stub validator - add validation logic here when needed
 */
export const validate = createNoopValidator<InsertDispatch, Dispatch>();

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
  } | null;
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
}

async function getWorkerName(workerId: string): Promise<string> {
  const client = getClient();
  const [worker] = await client
    .select({ contactId: workers.contactId, siriusId: workers.siriusId })
    .from(workers)
    .where(eq(workers.id, workerId));
  if (!worker) return 'Unknown Worker';
  
  const [contact] = await client
    .select({ given: contacts.given, family: contacts.family, displayName: contacts.displayName })
    .from(contacts)
    .where(eq(contacts.id, worker.contactId));
  
  const name = contact ? `${contact.given || ''} ${contact.family || ''}`.trim() : '';
  return name || contact?.displayName || `Worker #${worker.siriusId}`;
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

export const dispatchLoggingConfig: StorageLoggingConfig<DispatchStorage> = {
  module: 'dispatches',
  methods: {
    create: {
      enabled: true,
      getEntityId: (args, result) => result?.id || 'new dispatch',
      getHostEntityId: async (args, result) => {
        const jobId = result?.jobId || args[0]?.jobId;
        return jobId ? await getJobEmployerId(jobId) : undefined;
      },
      getDescription: async (args, result) => {
        const workerName = await getWorkerName(result?.workerId || args[0]?.workerId);
        const jobTitle = await getJobTitle(result?.jobId || args[0]?.jobId);
        return `Created Dispatch for ${workerName} to "${jobTitle}"`;
      },
      after: async (args, result) => {
        return {
          dispatch: result,
          metadata: {
            dispatchId: result?.id,
            jobId: result?.jobId,
            workerId: result?.workerId,
            status: result?.status,
          }
        };
      }
    },
    update: {
      enabled: true,
      getEntityId: (args) => args[0],
      getHostEntityId: async (args, result, beforeState) => {
        const jobId = result?.jobId || beforeState?.dispatch?.jobId;
        return jobId ? await getJobEmployerId(jobId) : undefined;
      },
      getDescription: async (args, result, beforeState) => {
        const workerName = await getWorkerName(result?.workerId || beforeState?.dispatch?.workerId);
        const jobTitle = await getJobTitle(result?.jobId || beforeState?.dispatch?.jobId);
        const oldStatus = beforeState?.dispatch?.status;
        const newStatus = result?.status;
        if (oldStatus && newStatus && oldStatus !== newStatus) {
          return `Updated Dispatch for ${workerName} to "${jobTitle}": ${oldStatus} → ${newStatus}`;
        }
        return `Updated Dispatch for ${workerName} to "${jobTitle}"`;
      },
      before: async (args, storage) => {
        const dispatch = await storage.get(args[0]);
        return { dispatch };
      },
      after: async (args, result, storage, beforeState) => {
        return {
          dispatch: result,
          previousState: beforeState?.dispatch,
          metadata: {
            dispatchId: result?.id,
            jobId: result?.jobId,
            workerId: result?.workerId,
            status: result?.status,
            previousStatus: beforeState?.dispatch?.status,
          }
        };
      }
    },
    delete: {
      enabled: true,
      getEntityId: (args) => args[0],
      getHostEntityId: async (args, result, beforeState) => {
        const jobId = beforeState?.dispatch?.jobId;
        return jobId ? await getJobEmployerId(jobId) : undefined;
      },
      getDescription: async (args, result, beforeState) => {
        if (!beforeState?.dispatch) return 'Deleted Dispatch';
        const workerName = await getWorkerName(beforeState.dispatch.workerId);
        const jobTitle = await getJobTitle(beforeState.dispatch.jobId);
        return `Deleted Dispatch for ${workerName} from "${jobTitle}"`;
      },
      before: async (args, storage) => {
        const dispatch = await storage.get(args[0]);
        return { dispatch };
      }
    }
  }
};

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
          },
        })
        .from(dispatches)
        .leftJoin(workers, eq(dispatches.workerId, workers.id))
        .leftJoin(contacts, eq(workers.contactId, contacts.id))
        .leftJoin(dispatchJobs, eq(dispatches.jobId, dispatchJobs.id))
        .where(eq(dispatches.id, id));

      if (!row) return undefined;

      return {
        ...row.dispatch,
        worker: row.worker ? {
          ...row.worker,
          contact: row.contact,
        } : null,
        job: row.job,
      };
    },

    async getByJob(jobId: string): Promise<DispatchWithRelations[]> {
      const client = getClient();
      const rows = await client
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
          },
        })
        .from(dispatches)
        .leftJoin(workers, eq(dispatches.workerId, workers.id))
        .leftJoin(contacts, eq(workers.contactId, contacts.id))
        .leftJoin(dispatchJobs, eq(dispatches.jobId, dispatchJobs.id))
        .where(eq(dispatches.jobId, jobId))
        .orderBy(desc(dispatches.startDate));

      return rows.map(row => ({
        ...row.dispatch,
        worker: row.worker ? {
          ...row.worker,
          contact: row.contact,
        } : null,
        job: row.job,
      }));
    },

    async getByWorker(workerId: string): Promise<DispatchWithRelations[]> {
      const client = getClient();
      const rows = await client
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
          },
        })
        .from(dispatches)
        .leftJoin(workers, eq(dispatches.workerId, workers.id))
        .leftJoin(contacts, eq(workers.contactId, contacts.id))
        .leftJoin(dispatchJobs, eq(dispatches.jobId, dispatchJobs.id))
        .where(eq(dispatches.workerId, workerId))
        .orderBy(desc(dispatches.startDate));

      return rows.map(row => ({
        ...row.dispatch,
        worker: row.worker ? {
          ...row.worker,
          contact: row.contact,
        } : null,
        job: row.job,
      }));
    },

    async create(insertDispatch: InsertDispatch): Promise<Dispatch> {
      validate.validateOrThrow(insertDispatch);
      const client = getClient();
      const [dispatch] = await client.insert(dispatches).values(insertDispatch).returning();
      return dispatch;
    },

    async update(id: string, dispatchUpdate: Partial<InsertDispatch>): Promise<Dispatch | undefined> {
      validate.validateOrThrow(dispatchUpdate);
      const client = getClient();
      const [dispatch] = await client
        .update(dispatches)
        .set(dispatchUpdate)
        .where(eq(dispatches.id, id))
        .returning();
      return dispatch || undefined;
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

      const [updatedDispatch] = await client
        .update(dispatches)
        .set({ status: newStatus })
        .where(eq(dispatches.id, dispatchId))
        .returning();

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

      return { success: true, dispatch: updatedDispatch };
    }
  };
}
