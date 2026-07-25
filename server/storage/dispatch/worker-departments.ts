import { createNoopValidator } from '../utils/validation';
import { getClient } from '../transaction-context';
import {
  workerDispatchDepartment,
  optionsDepartment,
  type WorkerDispatchDepartment,
  type InsertWorkerDispatchDepartment,
} from "@shared/schema";
import { eq, and, ne, asc } from "drizzle-orm";
import { defineLoggingConfig } from "../middleware/logging";
import { eventBus, EventType } from "../../services/event-bus";

/**
 * Stub validator - add validation logic here when needed
 */
export const validate = createNoopValidator<InsertWorkerDispatchDepartment, WorkerDispatchDepartment>();

/**
 * Thrown when a create/update would leave a worker with a mix of 'include'
 * and 'exclude' department preference rows. A worker's rows must all share
 * one preference mode.
 */
export class WorkerDispatchDepartmentModeError extends Error {
  constructor(public readonly existingPreference: string) {
    super(`Worker already has '${existingPreference}' department preferences; include and exclude cannot be mixed`);
    this.name = 'WorkerDispatchDepartmentModeError';
  }
}

export interface WorkerDispatchDepartmentWithDepartment extends WorkerDispatchDepartment {
  department?: {
    id: string;
    name: string;
  } | null;
}

export interface WorkerDispatchDepartmentStorage {
  get(id: string): Promise<WorkerDispatchDepartment | undefined>;
  getByWorker(workerId: string): Promise<WorkerDispatchDepartmentWithDepartment[]>;
  /**
   * Create a preference row. Throws WorkerDispatchDepartmentModeError if the
   * worker already has rows with the opposite preference (one mode per
   * worker), checked transactionally against the worker's existing rows.
   */
  create(entry: InsertWorkerDispatchDepartment): Promise<WorkerDispatchDepartment>;
  delete(id: string): Promise<boolean>;
}

async function getDepartmentName(departmentId: string | undefined): Promise<string> {
  if (!departmentId) return 'Unknown Department';
  const client = getClient();
  const [row] = await client
    .select({ name: optionsDepartment.name })
    .from(optionsDepartment)
    .where(eq(optionsDepartment.id, departmentId));
  return row?.name || 'Unknown Department';
}

async function getWorkerName(workerId: string | undefined): Promise<string> {
  if (!workerId) return 'Unknown Worker';
  const { storage } = await import('../index');
  return storage.workers.getWorkerDisplayName(workerId);
}

function emitDepartmentSaved(entry: WorkerDispatchDepartment, isDeleted?: boolean): void {
  setImmediate(() => {
    eventBus.emit(EventType.DISPATCH_DEPARTMENT_SAVED, {
      entryId: entry.id,
      workerId: entry.workerId,
      departmentId: entry.departmentId,
      preference: entry.preference,
      ...(isDeleted ? { isDeleted: true } : {}),
    }).catch(err => {
      console.error("Failed to emit DISPATCH_DEPARTMENT_SAVED event:", err);
    });
  });
}

export const workerDispatchDepartmentLoggingConfig = defineLoggingConfig<WorkerDispatchDepartmentStorage>({
  module: 'worker-dispatch-department',
  state: { key: 'entry' },
  hostEntityId: (args, result, before) =>
    result?.workerId ?? before?.entry?.workerId ?? args[0]?.workerId,
  methods: {
    create: {
      getEntityId: (_args, result) => result?.id || 'new worker dispatch department preference',
      getDescription: async (args, result) => {
        const workerName = await getWorkerName(result?.workerId || args[0]?.workerId);
        const departmentName = await getDepartmentName(result?.departmentId || args[0]?.departmentId);
        const preference = result?.preference || args[0]?.preference;
        return `Added department preference (${preference}) for ${workerName}: ${departmentName}`;
      },
    },
    delete: {
      getDescription: async (_args, _result, beforeState) => {
        if (beforeState?.entry) {
          const workerName = await getWorkerName(beforeState.entry.workerId);
          const departmentName = await getDepartmentName(beforeState.entry.departmentId);
          return `Removed department preference (${beforeState.entry.preference}) for ${workerName}: ${departmentName}`;
        }
        return 'Removed worker dispatch department preference';
      },
    },
  },
});

export function createWorkerDispatchDepartmentStorage(): WorkerDispatchDepartmentStorage {
  return {
    async get(id: string) {
      const client = getClient();
      const [result] = await client
        .select()
        .from(workerDispatchDepartment)
        .where(eq(workerDispatchDepartment.id, id));
      return result;
    },

    async getByWorker(workerId: string) {
      const client = getClient();
      const rows = await client
        .select({
          entry: workerDispatchDepartment,
          departmentName: optionsDepartment.name,
        })
        .from(workerDispatchDepartment)
        .leftJoin(optionsDepartment, eq(workerDispatchDepartment.departmentId, optionsDepartment.id))
        .where(eq(workerDispatchDepartment.workerId, workerId))
        .orderBy(asc(optionsDepartment.name));
      return rows.map(({ entry, departmentName }) => ({
        ...entry,
        department: departmentName ? { id: entry.departmentId, name: departmentName } : null,
      }));
    },

    async create(entry: InsertWorkerDispatchDepartment) {
      validate.validateOrThrow(entry);
      const client = getClient();
      const result = await client.transaction(async (tx) => {
        const [conflicting] = await tx
          .select({ preference: workerDispatchDepartment.preference })
          .from(workerDispatchDepartment)
          .where(and(
            eq(workerDispatchDepartment.workerId, entry.workerId),
            ne(workerDispatchDepartment.preference, entry.preference),
          ))
          .limit(1);
        if (conflicting) {
          throw new WorkerDispatchDepartmentModeError(conflicting.preference);
        }
        const [created] = await tx
          .insert(workerDispatchDepartment)
          .values(entry)
          .returning();
        return created;
      });

      emitDepartmentSaved(result);
      return result;
    },

    async delete(id: string) {
      const client = getClient();
      const [deleted] = await client
        .delete(workerDispatchDepartment)
        .where(eq(workerDispatchDepartment.id, id))
        .returning();

      if (deleted) {
        emitDepartmentSaved(deleted, true);
      }

      return !!deleted;
    },
  };
}
