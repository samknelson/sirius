import { getClient } from '../transaction-context';
import {
  workerTos,
  workers,
  contacts,
  type WorkerTos,
  type InsertWorkerTos,
} from "@shared/schema";
import { eq, and, desc, isNull, ne, inArray } from "drizzle-orm";
import { defineLoggingConfig, type StorageLoggingConfig } from "../middleware/logging";

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

export interface ActiveWorkerTosWorker {
  id: string;
  siriusId: number | null;
  displayName: string | null;
  given: string | null;
  family: string | null;
}

export interface ActiveWorkerTosWithWorker extends WorkerTos {
  worker: ActiveWorkerTosWorker;
}

export interface WorkerTosStorage {
  getByWorker(workerId: string): Promise<WorkerTos[]>;
  get(id: string): Promise<WorkerTos | undefined>;
  getBySiriusId(siriusId: string): Promise<WorkerTos | undefined>;
  getActiveForWorker(workerId: string): Promise<WorkerTos | undefined>;
  listActive(): Promise<WorkerTos[]>;
  listActiveWithWorker(): Promise<ActiveWorkerTosWithWorker[]>;
  /**
   * Given a set of TOS ids, return the subset that still exist AND are still
   * open (no `end_date`). Used by the TOS absence-reminder denorm plugin's
   * widow scan: any scheduled-reminder whose TOS id is NOT in the returned set
   * (deleted or ended) is a widow whose denorm row should be removed.
   */
  getOpenIdsIn(ids: string[]): Promise<string[]>;
  create(input: InsertWorkerTos): Promise<WorkerTos>;
  update(id: string, patch: WorkerTosUpdate): Promise<WorkerTos | undefined>;
  delete(id: string, message?: string): Promise<boolean>;
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

export const workerTosLoggingConfig = defineLoggingConfig<WorkerTosStorage>({
  module: 'worker-tos',
  state: { key: 'record' },
  hostEntityId: (args, result, before) =>
    (before as BeforeState | undefined)?.record?.workerId
    ?? result?.workerId
    ?? args[0]?.workerId,
  methods: {
    create: {
      getEntityId: (args, result) => result?.id || 'new worker tos',
      getDescription: async (args, result) => {
        const { storage } = await import('../index');
        const workerName = await storage.workers.getWorkerDisplayName(result?.workerId || args[0]?.workerId);
        return result?.endDate
          ? `Recorded absence for ${workerName}`
          : `Started absence for ${workerName}`;
      },
    },
    update: {
      getDescription: async (args, result, beforeState: BeforeState | undefined) => {
        const workerId = result?.workerId || beforeState?.record?.workerId || '';
        const { storage } = await import('../index');
        const workerName = await storage.workers.getWorkerDisplayName(workerId);
        const before = beforeState?.record;
        // Detect "stop" transition: was active, now ended
        if (before && !before.endDate && result?.endDate) {
          const dur = formatDuration(new Date(result.startDate), new Date(result.endDate));
          return `Ended absence for ${workerName} (${dur})`;
        }
        return `Updated absence for ${workerName}`;
      },
    },
    delete: {
      getDescription: async (args, result, beforeState: BeforeState | undefined) => {
        const { storage } = await import('../index');
        const workerName = await storage.workers.getWorkerDisplayName(beforeState?.record?.workerId);
        const message = args[1];
        const base = `Deleted absence for ${workerName}`;
        return message ? `${base}: ${message}` : base;
      },
    },
  },
});

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

    async listActiveWithWorker(): Promise<ActiveWorkerTosWithWorker[]> {
      const client = getClient();
      const rows = await client
        .select({
          tos: workerTos,
          worker: {
            id: workers.id,
            siriusId: workers.siriusId,
            displayName: contacts.displayName,
            given: contacts.given,
            family: contacts.family,
          },
        })
        .from(workerTos)
        .innerJoin(workers, eq(workerTos.workerId, workers.id))
        .innerJoin(contacts, eq(workers.contactId, contacts.id))
        .where(isNull(workerTos.endDate))
        .orderBy(contacts.family, contacts.given);
      return rows.map((row) => ({ ...row.tos, worker: row.worker }));
    },

    async getOpenIdsIn(ids: string[]): Promise<string[]> {
      if (ids.length === 0) return [];
      const client = getClient();
      const rows = await client
        .select({ id: workerTos.id })
        .from(workerTos)
        .where(and(inArray(workerTos.id, ids), isNull(workerTos.endDate)));
      return rows.map((r) => r.id);
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
