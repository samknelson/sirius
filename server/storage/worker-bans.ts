import { getClient } from './transaction-context';
import { 
  workerBans,
  workers,
  contacts,
  type WorkerBan, 
  type InsertWorkerBan
} from "@shared/schema";
import { eq, desc, and, lt, gte, or, isNull, isNotNull } from "drizzle-orm";
import { type StorageLoggingConfig } from "./middleware/logging";
import { eventBus, EventType } from "../services/event-bus";
import { 
  type ValidationError,
  createStorageValidator
} from "./utils/validation";
import { normalizeToDateOnly, getTodayDateOnly } from "@shared/utils";

export interface WorkerBanWithRelations extends WorkerBan {
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

export interface WorkerBanStorage {
  getAll(): Promise<WorkerBan[]>;
  get(id: string): Promise<WorkerBan | undefined>;
  getByWorker(workerId: string): Promise<WorkerBan[]>;
  create(ban: InsertWorkerBan): Promise<WorkerBan>;
  update(id: string, ban: Partial<InsertWorkerBan>): Promise<WorkerBan | undefined>;
  delete(id: string): Promise<boolean>;
  findExpiredButActive(): Promise<WorkerBan[]>;
  findNotExpiredButInactive(): Promise<WorkerBan[]>;
}

function calculateActive(endDate: Date | null | undefined): boolean {
  if (!endDate) return true;
  const end = normalizeToDateOnly(endDate);
  const today = getTodayDateOnly();
  return end !== null && end >= today;
}

/**
 * Validator for worker bans.
 * Use validate.validate() for ValidationResult or validate.validateOrThrow() for direct value.
 */
export const validate = createStorageValidator<InsertWorkerBan, WorkerBan, { active: boolean }>(
  (data, existing) => {
    const errors: ValidationError[] = [];
    
    const workerId = data.workerId ?? existing?.workerId;
    const startDate = data.startDate ?? existing?.startDate;
    const endDate = data.endDate !== undefined ? data.endDate : existing?.endDate;
    
    if (!workerId) {
      errors.push({ field: 'workerId', code: 'REQUIRED', message: 'Worker ID is required' });
    }
    
    if (!startDate) {
      errors.push({ field: 'startDate', code: 'REQUIRED', message: 'Start date is required' });
    } else {
      const normalizedStart = normalizeToDateOnly(startDate);
      const today = getTodayDateOnly();
      
      if (normalizedStart && normalizedStart > today) {
        errors.push({ field: 'startDate', code: 'FUTURE_DATE', message: 'Start date cannot be in the future' });
      }
      
      if (endDate) {
        const normalizedEnd = normalizeToDateOnly(endDate);
        if (normalizedStart && normalizedEnd && normalizedStart > normalizedEnd) {
          errors.push({ field: 'endDate', code: 'BEFORE_START', message: 'End date cannot be before start date' });
        }
      }
    }
    
    if (errors.length > 0) {
      return { ok: false, errors };
    }
    
    const active = calculateActive(endDate);
    
    return { ok: true, value: { active } };
  }
);

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

export const workerBanLoggingConfig: StorageLoggingConfig<WorkerBanStorage> = {
  module: 'worker-bans',
  methods: {
    create: {
      enabled: true,
      getEntityId: (args, result) => result?.id || 'new worker ban',
      getHostEntityId: (args, result) => result?.workerId || args[0]?.workerId,
      getDescription: async (args, result) => {
        const workerName = await getWorkerName(result?.workerId || args[0]?.workerId);
        return `Created ban (${result?.type || 'unspecified'}) for ${workerName}`;
      },
      after: async (args, result) => {
        return { ban: result };
      }
    },
    update: {
      enabled: true,
      getEntityId: (args) => args[0],
      getHostEntityId: async (args, result, beforeState) => {
        return result?.workerId || beforeState?.ban?.workerId;
      },
      getDescription: async (args, result, beforeState) => {
        const workerName = await getWorkerName(result?.workerId || beforeState?.ban?.workerId);
        return `Updated ban for ${workerName}`;
      },
      before: async (args, storage) => {
        const ban = await storage.get(args[0]);
        return { ban };
      },
      after: async (args, result) => {
        return { ban: result };
      }
    },
    delete: {
      enabled: true,
      getEntityId: (args) => args[0],
      getHostEntityId: async (args, result, beforeState) => {
        return beforeState?.ban?.workerId;
      },
      getDescription: async (args, result, beforeState) => {
        const workerName = await getWorkerName(beforeState?.ban?.workerId || '');
        return `Deleted ban for ${workerName}`;
      },
      before: async (args, storage) => {
        const ban = await storage.get(args[0]);
        return { ban };
      }
    }
  }
};

export function createWorkerBanStorage(): WorkerBanStorage {
  return {
    async getAll(): Promise<WorkerBan[]> {
      const client = getClient();
      return client.select().from(workerBans).orderBy(desc(workerBans.startDate));
    },

    async get(id: string): Promise<WorkerBan | undefined> {
      const client = getClient();
      const [ban] = await client.select().from(workerBans).where(eq(workerBans.id, id));
      return ban;
    },

    async getByWorker(workerId: string): Promise<WorkerBan[]> {
      const client = getClient();
      return client
        .select()
        .from(workerBans)
        .where(eq(workerBans.workerId, workerId))
        .orderBy(desc(workerBans.startDate));
    },

    async create(ban: InsertWorkerBan): Promise<WorkerBan> {
      const client = getClient();
      const validated = validate.validateOrThrow(ban);
      
      const [created] = await client
        .insert(workerBans)
        .values({
          ...ban,
          active: validated.active
        })
        .returning();
      
      eventBus.emit(EventType.WORKER_BAN_SAVED, {
        banId: created.id,
        workerId: created.workerId,
        type: created.type,
        startDate: created.startDate,
        endDate: created.endDate,
        active: created.active ?? true,
      });
      
      return created;
    },

    async update(id: string, ban: Partial<InsertWorkerBan>): Promise<WorkerBan | undefined> {
      const client = getClient();
      const existing = await this.get(id);
      if (!existing) return undefined;

      const validated = validate.validateOrThrow(ban, existing);

      const [updated] = await client
        .update(workerBans)
        .set({
          ...ban,
          active: validated.active
        })
        .where(eq(workerBans.id, id))
        .returning();
      
      if (updated) {
        eventBus.emit(EventType.WORKER_BAN_SAVED, {
          banId: updated.id,
          workerId: updated.workerId,
          type: updated.type,
          startDate: updated.startDate,
          endDate: updated.endDate,
          active: updated.active ?? true,
        });
      }
      
      return updated;
    },

    async delete(id: string): Promise<boolean> {
      const client = getClient();
      const existing = await this.get(id);
      const result = await client.delete(workerBans).where(eq(workerBans.id, id));
      const deleted = (result.rowCount ?? 0) > 0;
      
      if (deleted && existing) {
        eventBus.emit(EventType.WORKER_BAN_SAVED, {
          banId: existing.id,
          workerId: existing.workerId,
          type: existing.type,
          startDate: existing.startDate,
          endDate: existing.endDate,
          active: existing.active ?? true,
          isDeleted: true,
        });
      }
      
      return deleted;
    },

    async findExpiredButActive(): Promise<WorkerBan[]> {
      return composeQuery({ expired: true, active: true });
    },

    async findNotExpiredButInactive(): Promise<WorkerBan[]> {
      return composeQuery({ expired: false, active: false });
    }
  };
}

interface QueryFilters {
  expired?: boolean;
  active?: boolean;
  workerId?: string;
  id?: string;
}

async function composeQuery(filters: QueryFilters): Promise<WorkerBan[]> {
  const client = getClient();
  const conditions = [];
  
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (filters.active !== undefined) {
    conditions.push(eq(workerBans.active, filters.active));
  }

  if (filters.expired !== undefined) {
    if (filters.expired) {
      conditions.push(isNotNull(workerBans.endDate));
      conditions.push(lt(workerBans.endDate, today));
    } else {
      conditions.push(or(
        isNull(workerBans.endDate),
        gte(workerBans.endDate, today)
      ));
    }
  }

  if (filters.workerId) {
    conditions.push(eq(workerBans.workerId, filters.workerId));
  }

  if (filters.id) {
    conditions.push(eq(workerBans.id, filters.id));
  }

  if (conditions.length === 0) {
    return client.select().from(workerBans).orderBy(desc(workerBans.startDate));
  }

  return client
    .select()
    .from(workerBans)
    .where(and(...conditions))
    .orderBy(desc(workerBans.startDate));
}
