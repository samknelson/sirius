import { getClient } from '../transaction-context';
import {
  workerRelations,
  optionsWorkerRelationType,
  workers,
  contacts,
  type WorkerRelation,
  type InsertWorkerRelation,
} from '@shared/schema';
import {
  eq,
  and,
  or,
  desc,
  lte,
  gte,
  isNull,
  inArray,
  type SQL,
} from 'drizzle-orm';
import { type StorageLoggingConfig } from '../middleware/logging';
import { normalizeToDateOnly, getTodayDateOnly } from '@shared/utils';

export interface WorkerRelationOtherWorker {
  id: string;
  siriusId: number | null;
  displayName: string | null;
  given: string | null;
  family: string | null;
}

export interface WorkerRelationWithDetails extends WorkerRelation {
  role: 'worker_1' | 'worker_2';
  isActive: boolean;
  otherWorker: WorkerRelationOtherWorker | null;
  relationTypeName: string | null;
}

export interface SearchWorkerRelationsParams {
  workerId?: string;
  role?: 'worker_1' | 'worker_2' | 'either';
  activeAt?: Date | null;
  relationTypeId?: string;
  limit?: number;
  offset?: number;
}

export interface WorkerRelationsStorage {
  searchWorkerRelations(params: SearchWorkerRelationsParams): Promise<WorkerRelationWithDetails[]>;
  get(id: string): Promise<WorkerRelation | undefined>;
  create(data: InsertWorkerRelation): Promise<WorkerRelation>;
  update(id: string, data: Partial<InsertWorkerRelation>): Promise<WorkerRelation | undefined>;
  delete(id: string): Promise<boolean>;
}

export class WorkerRelationValidationError extends Error {
  constructor(public field: string, message: string) {
    super(message);
    this.name = 'WorkerRelationValidationError';
  }
}

function toYmd(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const d = normalizeToDateOnly(value);
  if (!d) return null;
  const yr = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const dy = String(d.getDate()).padStart(2, '0');
  return `${yr}-${mo}-${dy}`;
}

interface ValidationInput {
  worker1?: string | null;
  worker2?: string | null;
  relationType?: string | null;
  startYmd?: Date | string | null;
  endYmd?: Date | string | null;
}

async function validateRelation(
  data: ValidationInput,
  existing?: WorkerRelation,
): Promise<{ worker1: string; worker2: string; relationType: string; startYmd: string; endYmd: string | null }> {
  const worker1 = data.worker1 ?? existing?.worker1 ?? undefined;
  const worker2 = data.worker2 ?? existing?.worker2 ?? undefined;
  const relationType = data.relationType ?? existing?.relationType ?? undefined;
  const startSource = data.startYmd !== undefined ? data.startYmd : existing?.startYmd ?? null;
  const endSource = data.endYmd !== undefined ? data.endYmd : existing?.endYmd ?? null;
  const startYmd = toYmd(startSource);
  const endYmd = toYmd(endSource);

  if (!worker1) throw new WorkerRelationValidationError('worker1', 'worker_1 is required');
  if (!worker2) throw new WorkerRelationValidationError('worker2', 'worker_2 is required');
  if (!relationType) throw new WorkerRelationValidationError('relationType', 'relation_type is required');
  if (worker1 === worker2) {
    throw new WorkerRelationValidationError('worker2', 'worker_1 and worker_2 must be different workers');
  }

  if (!startYmd) {
    throw new WorkerRelationValidationError('startYmd', 'start_ymd is required');
  }

  const today = toYmd(getTodayDateOnly())!;
  if (startYmd > today) {
    throw new WorkerRelationValidationError('startYmd', 'start_ymd cannot be in the future');
  }
  if (endYmd && endYmd < startYmd) {
    throw new WorkerRelationValidationError('endYmd', 'end_ymd must be on or after start_ymd');
  }

  // FK validity
  const client = getClient();
  const foundWorkers = await client
    .select({ id: workers.id })
    .from(workers)
    .where(inArray(workers.id, [worker1, worker2]));
  const foundIds = new Set(foundWorkers.map((w) => w.id));
  if (!foundIds.has(worker1)) {
    throw new WorkerRelationValidationError('worker1', 'worker_1 does not exist');
  }
  if (!foundIds.has(worker2)) {
    throw new WorkerRelationValidationError('worker2', 'worker_2 does not exist');
  }
  const [foundType] = await client
    .select({ id: optionsWorkerRelationType.id })
    .from(optionsWorkerRelationType)
    .where(eq(optionsWorkerRelationType.id, relationType));
  if (!foundType) {
    throw new WorkerRelationValidationError('relationType', 'relation_type does not exist');
  }

  return { worker1, worker2, relationType, startYmd, endYmd };
}

interface WorkerRelationsBeforeState {
  relation: WorkerRelation | undefined;
}

export const workerRelationsLoggingConfig: StorageLoggingConfig<WorkerRelationsStorage> = {
  module: 'worker-relations',
  methods: {
    create: {
      enabled: true,
      getEntityId: (_args, result) => result?.id || 'new worker relation',
      getHostEntityId: (args, result) => result?.worker1 ?? args[0]?.worker1,
      getDescription: async (_args, result) => {
        return `Created worker relation (${result?.worker1} → ${result?.worker2})`;
      },
      after: async (_args, result) => ({ relation: result }),
    },
    update: {
      enabled: true,
      getEntityId: (args) => args[0],
      getHostEntityId: async (_args, _result, beforeState) =>
        (beforeState as WorkerRelationsBeforeState | undefined)?.relation?.worker1,
      getDescription: async (_args, result, beforeState) => {
        const r = result || (beforeState as WorkerRelationsBeforeState | undefined)?.relation;
        return `Updated worker relation (${r?.worker1} → ${r?.worker2})`;
      },
      before: async (args, storage) => {
        const relation = await storage.get(args[0]);
        return { relation };
      },
      after: async (_args, result) => ({ relation: result }),
    },
    delete: {
      enabled: true,
      getEntityId: (args) => args[0],
      getHostEntityId: async (_args, _result, beforeState) =>
        (beforeState as WorkerRelationsBeforeState | undefined)?.relation?.worker1,
      getDescription: async (_args, _result, beforeState) => {
        const r = (beforeState as WorkerRelationsBeforeState | undefined)?.relation;
        return r ? `Deleted worker relation (${r.worker1} → ${r.worker2})` : 'Deleted worker relation';
      },
      before: async (args, storage) => {
        const relation = await storage.get(args[0]);
        return { relation };
      },
    },
  },
};

export function createWorkerRelationsStorage(): WorkerRelationsStorage {
  return {
    async searchWorkerRelations(params: SearchWorkerRelationsParams): Promise<WorkerRelationWithDetails[]> {
      const client = getClient();
      const role = params.role ?? 'either';

      const conds: SQL[] = [];
      if (params.workerId) {
        if (role === 'worker_1') {
          conds.push(eq(workerRelations.worker1, params.workerId));
        } else if (role === 'worker_2') {
          conds.push(eq(workerRelations.worker2, params.workerId));
        } else {
          const eitherSide = or(
            eq(workerRelations.worker1, params.workerId),
            eq(workerRelations.worker2, params.workerId),
          );
          if (eitherSide) conds.push(eitherSide);
        }
      }
      if (params.relationTypeId) {
        conds.push(eq(workerRelations.relationType, params.relationTypeId));
      }
      if (params.activeAt !== undefined && params.activeAt !== null) {
        const ymd = toYmd(params.activeAt)!;
        // Active = start_ymd is set AND start_ymd <= ymd AND (end_ymd IS NULL OR end_ymd >= ymd)
        conds.push(lte(workerRelations.startYmd, ymd));
        const endOk = or(isNull(workerRelations.endYmd), gte(workerRelations.endYmd, ymd));
        if (endOk) conds.push(endOk);
      }

      const where = conds.length > 0 ? and(...conds) : undefined;

      const baseQuery = client
        .select({
          relation: workerRelations,
          relationTypeName: optionsWorkerRelationType.name,
        })
        .from(workerRelations)
        .leftJoin(optionsWorkerRelationType, eq(workerRelations.relationType, optionsWorkerRelationType.id))
        .$dynamic();

      const filtered = where ? baseQuery.where(where) : baseQuery;
      const ordered = filtered.orderBy(desc(workerRelations.startYmd));
      const limited = params.limit !== undefined ? ordered.limit(params.limit) : ordered;
      const final = params.offset !== undefined ? limited.offset(params.offset) : limited;

      const rows = await final;

      // Resolve "other" worker info in one batch
      const otherIds = new Set<string>();
      for (const r of rows) {
        if (params.workerId && role !== 'either') {
          otherIds.add(role === 'worker_1' ? r.relation.worker2 : r.relation.worker1);
        } else if (params.workerId) {
          otherIds.add(r.relation.worker1 === params.workerId ? r.relation.worker2 : r.relation.worker1);
        } else {
          otherIds.add(r.relation.worker1);
          otherIds.add(r.relation.worker2);
        }
      }

      const otherWorkers: WorkerRelationOtherWorker[] = otherIds.size
        ? await client
            .select({
              id: workers.id,
              siriusId: workers.siriusId,
              displayName: contacts.displayName,
              given: contacts.given,
              family: contacts.family,
            })
            .from(workers)
            .leftJoin(contacts, eq(workers.contactId, contacts.id))
            .where(inArray(workers.id, Array.from(otherIds)))
        : [];
      const byId = new Map<string, WorkerRelationOtherWorker>(otherWorkers.map((w) => [w.id, w]));

      const today = toYmd(getTodayDateOnly())!;
      return rows.map((r) => {
        const rel = r.relation;
        const myRole: 'worker_1' | 'worker_2' = params.workerId
          ? rel.worker1 === params.workerId
            ? 'worker_1'
            : 'worker_2'
          : 'worker_1';
        const otherId = myRole === 'worker_1' ? rel.worker2 : rel.worker1;
        const isActive =
          !!rel.startYmd &&
          rel.startYmd <= today &&
          (!rel.endYmd || rel.endYmd >= today);
        return {
          ...rel,
          role: myRole,
          isActive,
          otherWorker: byId.get(otherId) ?? null,
          relationTypeName: r.relationTypeName ?? null,
        };
      });
    },

    async get(id: string): Promise<WorkerRelation | undefined> {
      const client = getClient();
      const [row] = await client.select().from(workerRelations).where(eq(workerRelations.id, id));
      return row;
    },

    async create(data: InsertWorkerRelation): Promise<WorkerRelation> {
      const validated = await validateRelation(data);
      const client = getClient();
      const [created] = await client
        .insert(workerRelations)
        .values({
          worker1: validated.worker1,
          worker2: validated.worker2,
          relationType: validated.relationType,
          startYmd: validated.startYmd,
          endYmd: validated.endYmd,
          data: data.data ?? null,
        })
        .returning();
      return created;
    },

    async update(id: string, data: Partial<InsertWorkerRelation>): Promise<WorkerRelation | undefined> {
      const client = getClient();
      const [existing] = await client.select().from(workerRelations).where(eq(workerRelations.id, id));
      if (!existing) return undefined;

      // Spec: Edit cannot change worker_1/worker_2
      if (data.worker1 !== undefined && data.worker1 !== existing.worker1) {
        throw new WorkerRelationValidationError('worker1', 'worker_1 cannot be changed on an existing relation');
      }
      if (data.worker2 !== undefined && data.worker2 !== existing.worker2) {
        throw new WorkerRelationValidationError('worker2', 'worker_2 cannot be changed on an existing relation');
      }

      const validated = await validateRelation(data, existing);
      const updateValues: Partial<InsertWorkerRelation> = {
        relationType: validated.relationType,
        startYmd: validated.startYmd,
        endYmd: validated.endYmd,
      };
      if (data.data !== undefined) updateValues.data = data.data;

      const [updated] = await client
        .update(workerRelations)
        .set(updateValues)
        .where(eq(workerRelations.id, id))
        .returning();
      return updated;
    },

    async delete(id: string): Promise<boolean> {
      const client = getClient();
      const [deleted] = await client.delete(workerRelations).where(eq(workerRelations.id, id)).returning();
      return !!deleted;
    },
  };
}
