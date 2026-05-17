import { getClient } from './transaction-context';
import { 
  workerBans,
  type WorkerBan, 
  type InsertWorkerBan
} from "@shared/schema";
import { eq, desc, and, lt, gte, or, isNull, isNotNull } from "drizzle-orm";
import { defineLoggingConfig, type StorageLoggingConfig } from "./middleware/logging";
import { eventBus, EventType } from "../services/event-bus";
import { 
  type ValidationError,
  createStorageValidator
} from "./utils/validation";
import { calculateDenormActive } from "./utils/denorm-active";
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


/**
 * Validator for worker bans.
 * Use validate.validate() for ValidationResult or validate.validateOrThrow() for direct value.
 */
export const validate = createStorageValidator<InsertWorkerBan, WorkerBan, { denormActive: boolean }>(
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
    
    const denormActive = calculateDenormActive({ endDate });
    
    return { ok: true, value: { denormActive } };
  }
);

export const workerBanLoggingConfig = defineLoggingConfig<WorkerBanStorage>({
  module: 'worker-bans',
  stateKey: 'ban',
  hostEntityId: (args, result, before) =>
    result?.workerId ?? before?.ban?.workerId ?? args[0]?.workerId,
  methods: {
    create: {
      getEntityId: (args, result) => result?.id || 'new worker ban',
      getDescription: async (args, result) => {
        const { storage } = await import('./index');
        const workerName = await storage.workers.getWorkerDisplayName(result?.workerId || args[0]?.workerId);
        return `Created ban (${result?.type || 'unspecified'}) for ${workerName}`;
      },
    },
    update: {
      getDescription: async (args, result, beforeState) => {
        const { storage } = await import('./index');
        const workerName = await storage.workers.getWorkerDisplayName(result?.workerId || beforeState?.ban?.workerId);
        return `Updated ban for ${workerName}`;
      },
    },
    delete: {
      getDescription: async (args, result, beforeState) => {
        const { storage } = await import('./index');
        const workerName = await storage.workers.getWorkerDisplayName(beforeState?.ban?.workerId);
        return `Deleted ban for ${workerName}`;
      },
    },
  },
});

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
          denormActive: validated.denormActive
        })
        .returning();
      
      eventBus.emit(EventType.WORKER_BAN_SAVED, {
        banId: created.id,
        workerId: created.workerId,
        type: created.type,
        startDate: created.startDate,
        endDate: created.endDate,
        active: created.denormActive ?? true,
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
          denormActive: validated.denormActive
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
          active: updated.denormActive ?? true,
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
          active: existing.denormActive ?? true,
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
    conditions.push(eq(workerBans.denormActive, filters.active));
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
