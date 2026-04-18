import { getClient } from './transaction-context';
import {
  workerTos,
  workers,
  contacts,
  type WorkerTos,
  type InsertWorkerTos,
} from "@shared/schema";
import { eq, and, desc, isNull, ne } from "drizzle-orm";
import { type StorageLoggingConfig } from "./middleware/logging";

export class WorkerTosValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkerTosValidationError';
  }
}

export class WorkerTosConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkerTosConflictError';
  }
}

export interface WorkerTosUpdate {
  workerId?: string;
  startDate?: Date;
  endDate?: Date | null;
  description?: string | null;
  siriusId?: string | null;
}

export interface WorkerTosStorage {
  getByWorker(workerId: string): Promise<WorkerTos[]>;
  get(id: string): Promise<WorkerTos | undefined>;
  getBySiriusId(siriusId: string): Promise<WorkerTos | undefined>;
  getActiveForWorker(workerId: string): Promise<WorkerTos | undefined>;
  listActive(): Promise<WorkerTos[]>;
  create(input: InsertWorkerTos): Promise<WorkerTos>;
  update(id: string, patch: WorkerTosUpdate): Promise<WorkerTos | undefined>;
  delete(id: string, message?: string): Promise<boolean>;
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

function formatDuration(start: Date, end: Date): string {
  const ms = end.getTime() - start.getTime();
  if (ms < 0) return '0m';
  const minutes = Math.floor(ms / 60000);
  const days = Math.floor(minutes / (60 * 24));
  const hours = Math.floor((minutes % (60 * 24)) / 60);
  const mins = minutes % 60;
  const parts: string[] = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (mins || parts.length === 0) parts.push(`${mins}m`);
  return parts.join(' ');
}

function validateDates(startDate: Date | null | undefined, endDate: Date | null | undefined): void {
  if (!startDate) {
    throw new WorkerTosValidationError('Start date is required');
  }
  const now = new Date();
  if (startDate.getTime() > now.getTime()) {
    throw new WorkerTosValidationError('Start date cannot be in the future');
  }
  if (endDate) {
    if (endDate.getTime() > now.getTime()) {
      throw new WorkerTosValidationError('End date cannot be in the future');
    }
    if (endDate.getTime() <= startDate.getTime()) {
      throw new WorkerTosValidationError('End date must be after start date');
    }
  }
}

async function ensureNoOtherActive(workerId: string, excludeId?: string): Promise<void> {
  const client = getClient();
  const conditions = [eq(workerTos.workerId, workerId), isNull(workerTos.endDate)];
  if (excludeId) conditions.push(ne(workerTos.id, excludeId));
  const [existing] = await client
    .select({ id: workerTos.id })
    .from(workerTos)
    .where(and(...conditions))
    .limit(1);
  if (existing) {
    throw new WorkerTosConflictError('This worker already has an active absence');
  }
}

interface BeforeState {
  record?: WorkerTos;
}

export const workerTosLoggingConfig: StorageLoggingConfig<WorkerTosStorage> = {
  module: 'worker-tos',
  methods: {
    create: {
      enabled: true,
      getEntityId: (args, result) => result?.id || 'new worker tos',
      getHostEntityId: (args, result) => result?.workerId || args[0]?.workerId,
      getDescription: async (args, result) => {
        const workerName = await getWorkerName(result?.workerId || args[0]?.workerId);
        return result?.endDate
          ? `Recorded absence for ${workerName}`
          : `Started absence for ${workerName}`;
      },
      after: async (args, result) => ({ record: result }),
    },
    update: {
      enabled: true,
      getEntityId: (args) => args[0],
      getHostEntityId: async (args, result, beforeState: BeforeState | undefined) => {
        return result?.workerId || beforeState?.record?.workerId;
      },
      getDescription: async (args, result, beforeState: BeforeState | undefined) => {
        const workerId = result?.workerId || beforeState?.record?.workerId || '';
        const workerName = await getWorkerName(workerId);
        const before = beforeState?.record;
        // Detect "stop" transition: was active, now ended
        if (before && !before.endDate && result?.endDate) {
          const dur = formatDuration(new Date(result.startDate), new Date(result.endDate));
          return `Ended absence for ${workerName} (${dur})`;
        }
        return `Updated absence for ${workerName}`;
      },
      before: async (args, storage) => {
        const record = await storage.get(args[0]);
        return { record };
      },
      after: async (args, result) => ({ record: result }),
    },
    delete: {
      enabled: true,
      getEntityId: (args) => args[0],
      getHostEntityId: async (args, result, beforeState: BeforeState | undefined) => {
        return beforeState?.record?.workerId;
      },
      getDescription: async (args, result, beforeState: BeforeState | undefined) => {
        const workerName = await getWorkerName(beforeState?.record?.workerId || '');
        const message = args[1];
        const base = `Deleted absence for ${workerName}`;
        return message ? `${base}: ${message}` : base;
      },
      before: async (args, storage) => {
        const record = await storage.get(args[0]);
        return { record };
      },
    },
  },
};

export function createWorkerTosStorage(): WorkerTosStorage {
  return {
    async getByWorker(workerId: string): Promise<WorkerTos[]> {
      const client = getClient();
      return client
        .select()
        .from(workerTos)
        .where(eq(workerTos.workerId, workerId))
        .orderBy(desc(workerTos.startDate));
    },

    async get(id: string): Promise<WorkerTos | undefined> {
      const client = getClient();
      const [row] = await client.select().from(workerTos).where(eq(workerTos.id, id));
      return row;
    },

    async getBySiriusId(siriusId: string): Promise<WorkerTos | undefined> {
      const client = getClient();
      const [row] = await client
        .select()
        .from(workerTos)
        .where(eq(workerTos.siriusId, siriusId))
        .limit(1);
      return row;
    },

    async listActive(): Promise<WorkerTos[]> {
      const client = getClient();
      return client
        .select()
        .from(workerTos)
        .where(isNull(workerTos.endDate));
    },

    async getActiveForWorker(workerId: string): Promise<WorkerTos | undefined> {
      const client = getClient();
      const [row] = await client
        .select()
        .from(workerTos)
        .where(and(eq(workerTos.workerId, workerId), isNull(workerTos.endDate)))
        .limit(1);
      return row;
    },

    async create(input: InsertWorkerTos): Promise<WorkerTos> {
      validateDates(input.startDate as Date, input.endDate as Date | null | undefined);
      if (!input.endDate) {
        await ensureNoOtherActive(input.workerId);
      }
      const client = getClient();
      try {
        const [created] = await client.insert(workerTos).values(input).returning();
        return created;
      } catch (err) {
        if (err instanceof Error && (err.message.includes('worker_tos_one_active_per_worker_idx') || err.message.includes('duplicate key'))) {
          throw new WorkerTosConflictError('This worker already has an active absence');
        }
        throw err;
      }
    },

    async update(id: string, patch: WorkerTosUpdate): Promise<WorkerTos | undefined> {
      const client = getClient();
      const [existing] = await client.select().from(workerTos).where(eq(workerTos.id, id));
      if (!existing) return undefined;

      const nextStart = patch.startDate !== undefined ? patch.startDate : existing.startDate;
      const nextEnd = patch.endDate !== undefined ? patch.endDate : existing.endDate;
      const nextWorkerId = patch.workerId !== undefined ? patch.workerId : existing.workerId;
      validateDates(nextStart, nextEnd);

      if (!nextEnd) {
        await ensureNoOtherActive(nextWorkerId, id);
      }

      const updateValues: Partial<typeof workerTos.$inferInsert> = {};
      if (patch.workerId !== undefined) updateValues.workerId = patch.workerId;
      if (patch.startDate !== undefined) updateValues.startDate = patch.startDate;
      if (patch.endDate !== undefined) updateValues.endDate = patch.endDate;
      if (patch.description !== undefined) updateValues.description = patch.description;
      if (patch.siriusId !== undefined) updateValues.siriusId = patch.siriusId;

      if (Object.keys(updateValues).length === 0) return existing;

      try {
        const [updated] = await client
          .update(workerTos)
          .set(updateValues)
          .where(eq(workerTos.id, id))
          .returning();
        return updated;
      } catch (err) {
        if (err instanceof Error && (err.message.includes('worker_tos_one_active_per_worker_idx') || err.message.includes('duplicate key'))) {
          throw new WorkerTosConflictError('This worker already has an active absence');
        }
        throw err;
      }
    },

    async delete(id: string, _message?: string): Promise<boolean> {
      const client = getClient();
      const result = await client.delete(workerTos).where(eq(workerTos.id, id));
      return (result.rowCount ?? 0) > 0;
    },
  };
}
