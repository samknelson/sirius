import { getClient } from './transaction-context';
import { 
  dispatches, 
  dispatchJobs,
  workers,
  contacts,
  type Dispatch, 
  type InsertDispatch
} from "@shared/schema";
import { eq, desc } from "drizzle-orm";
import { type StorageLoggingConfig } from "./middleware/logging";

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

export interface DispatchStorage {
  getAll(): Promise<Dispatch[]>;
  get(id: string): Promise<Dispatch | undefined>;
  getWithRelations(id: string): Promise<DispatchWithRelations | undefined>;
  getByJob(jobId: string): Promise<DispatchWithRelations[]>;
  getByWorker(workerId: string): Promise<DispatchWithRelations[]>;
  create(dispatch: InsertDispatch): Promise<Dispatch>;
  update(id: string, dispatch: Partial<InsertDispatch>): Promise<Dispatch | undefined>;
  delete(id: string): Promise<boolean>;
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
      const client = getClient();
      const [dispatch] = await client.insert(dispatches).values(insertDispatch).returning();
      return dispatch;
    },

    async update(id: string, dispatchUpdate: Partial<InsertDispatch>): Promise<Dispatch | undefined> {
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
    }
  };
}
