import { getClient, onAfterCommit } from '../transaction-context';
import { eventBus, EventType } from '../../services/event-bus';
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
  ne,
  ilike,
  type SQL,
} from 'drizzle-orm';
import { defineLoggingConfig, type StorageLoggingConfig } from '../middleware/logging';
import { toYmd, getTodayYmd } from '@shared/utils/date';

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
  /**
   * Case-insensitive ILIKE pattern matched against the relation TYPE NAME
   * (e.g. '%domestic partner%'). Used by consumers that identify relations
   * semantically (like DP billing) rather than by a hardcoded type id.
   */
  relationTypeNameILike?: string;
  limit?: number;
  offset?: number;
}

/** A relation row enriched with its relation-type name. */
export interface WorkerRelationWithTypeName extends WorkerRelation {
  relationTypeName: string | null;
}

export interface WorkerRelationsStorage {
  searchWorkerRelations(params: SearchWorkerRelationsParams): Promise<WorkerRelationWithDetails[]>;
  /**
   * Find an active worker_relations row linking a specific subscriber
   * (`worker_1`) to a specific dependent (`worker_2`) on the given
   * as-of date. "Active" means `start_ymd <= asOf` AND (`end_ymd IS
   * NULL` OR `end_ymd >= asOf`). Returns the row or null.
   */
  findActiveBetween(
    subscriberWorkerId: string,
    dependentWorkerId: string,
    asOfDate: Date,
  ): Promise<WorkerRelation | null>;
  get(id: string): Promise<WorkerRelation | undefined>;
  /**
   * Fetch relation rows (with their relation-type names) for a set of ids.
   * Missing ids are silently absent from the result.
   */
  listByIdsWithType(ids: string[]): Promise<WorkerRelationWithTypeName[]>;
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

  const today = getTodayYmd();
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

/**
 * Duplicate guard: the same directed pair (worker_1 → worker_2) must not have
 * two relations of the same type with overlapping date windows. Direction
 * matters on purpose — asymmetric types (e.g. parent/child) mean different
 * things each way. Non-overlapping windows (e.g. a past marriage that ended
 * and a new one) remain allowed.
 */
async function assertNoDuplicateRelation(
  validated: { worker1: string; worker2: string; relationType: string; startYmd: string; endYmd: string | null },
  excludeId?: string,
): Promise<void> {
  const client = getClient();
  const conds: SQL[] = [
    eq(workerRelations.worker1, validated.worker1),
    eq(workerRelations.worker2, validated.worker2),
    eq(workerRelations.relationType, validated.relationType),
    // Overlap: the other relation has not ended before ours starts, and
    // (when ours has an end) it starts no later than our end.
    or(
      isNull(workerRelations.endYmd),
      gte(workerRelations.endYmd, validated.startYmd),
    )!,
  ];
  if (validated.endYmd) {
    conds.push(lte(workerRelations.startYmd, validated.endYmd));
  }
  if (excludeId) {
    conds.push(ne(workerRelations.id, excludeId));
  }
  const [dup] = await client
    .select({ id: workerRelations.id })
    .from(workerRelations)
    .where(and(...conds))
    .limit(1);
  if (dup) {
    throw new WorkerRelationValidationError(
      'startYmd',
      'These two workers already have this relationship for an overlapping period',
    );
  }
}

interface WorkerRelationsBeforeState {
  relation: WorkerRelation | undefined;
}

/**
 * Emit `WORKER_RELATION_SAVED` after the current transaction commits so a
 * concurrent read never observes the change before it is durable. On
 * updates that move the date range, the caller emits both the old and the
 * new range (mirroring the trust-election pattern) so listeners can rescan
 * every affected period.
 */
function emitWorkerRelationSaved(
  relation: Pick<WorkerRelation, 'id' | 'worker1' | 'worker2' | 'startYmd' | 'endYmd'>,
  operation: 'created' | 'updated' | 'deleted',
): void {
  onAfterCommit(() => {
    void eventBus.emit(EventType.WORKER_RELATION_SAVED, {
      relationId: relation.id,
      subscriberWorkerId: relation.worker1,
      dependentWorkerId: relation.worker2,
      startYmd: relation.startYmd,
      endYmd: relation.endYmd,
      operation,
    });
  });
}

export const workerRelationsLoggingConfig = defineLoggingConfig<WorkerRelationsStorage>({
  module: 'worker-relations',
  state: { key: 'relation' },
  hostEntityId: (args, result, before) =>
    (before as WorkerRelationsBeforeState | undefined)?.relation?.worker1
    ?? result?.worker1
    ?? args[0]?.worker1,
  methods: {
    create: {
      getEntityId: (_args, result) => result?.id || 'new worker relation',
      getDescription: async (_args, result) => {
        return `Created worker relation (${result?.worker1} → ${result?.worker2})`;
      },
    },
    update: {
      getDescription: async (_args, result, beforeState) => {
        const r = result || (beforeState as WorkerRelationsBeforeState | undefined)?.relation;
        return `Updated worker relation (${r?.worker1} → ${r?.worker2})`;
      },
    },
    delete: {
      getDescription: async (_args, _result, beforeState) => {
        const r = (beforeState as WorkerRelationsBeforeState | undefined)?.relation;
        return r ? `Deleted worker relation (${r.worker1} → ${r.worker2})` : 'Deleted worker relation';
      },
    },
  },
});

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
      if (params.relationTypeNameILike) {
        conds.push(ilike(optionsWorkerRelationType.name, params.relationTypeNameILike));
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

      const today = getTodayYmd();
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

    async findActiveBetween(
      subscriberWorkerId: string,
      dependentWorkerId: string,
      asOfDate: Date,
    ): Promise<WorkerRelation | null> {
      const ymd = toYmd(asOfDate);
      if (!ymd) return null;
      const client = getClient();
      const endOk = or(isNull(workerRelations.endYmd), gte(workerRelations.endYmd, ymd));
      const where = and(
        eq(workerRelations.worker1, subscriberWorkerId),
        eq(workerRelations.worker2, dependentWorkerId),
        lte(workerRelations.startYmd, ymd),
        ...(endOk ? [endOk] : []),
      );
      const [row] = await client
        .select()
        .from(workerRelations)
        .where(where)
        .orderBy(desc(workerRelations.startYmd))
        .limit(1);
      return row ?? null;
    },

    async get(id: string): Promise<WorkerRelation | undefined> {
      const client = getClient();
      const [row] = await client.select().from(workerRelations).where(eq(workerRelations.id, id));
      return row;
    },

    async listByIdsWithType(ids: string[]): Promise<WorkerRelationWithTypeName[]> {
      const unique = Array.from(new Set(ids)).filter(Boolean);
      if (unique.length === 0) return [];
      const client = getClient();
      const rows = await client
        .select({
          relation: workerRelations,
          relationTypeName: optionsWorkerRelationType.name,
        })
        .from(workerRelations)
        .leftJoin(
          optionsWorkerRelationType,
          eq(workerRelations.relationType, optionsWorkerRelationType.id),
        )
        .where(inArray(workerRelations.id, unique));
      return rows.map((r) => ({
        ...r.relation,
        relationTypeName: r.relationTypeName ?? null,
      }));
    },

    async create(data: InsertWorkerRelation): Promise<WorkerRelation> {
      const validated = await validateRelation(data);
      await assertNoDuplicateRelation(validated);
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
      emitWorkerRelationSaved(created, 'created');
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
      await assertNoDuplicateRelation(validated, id);
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
      if (updated) {
        // When the date range moved, also emit the OLD range so listeners
        // can rescan months the relation used to cover but no longer does.
        const rangeChanged =
          existing.startYmd !== updated.startYmd || existing.endYmd !== updated.endYmd;
        if (rangeChanged) emitWorkerRelationSaved(existing, 'updated');
        emitWorkerRelationSaved(updated, 'updated');
      }
      return updated;
    },

    async delete(id: string): Promise<boolean> {
      const client = getClient();
      const [deleted] = await client.delete(workerRelations).where(eq(workerRelations.id, id)).returning();
      if (deleted) emitWorkerRelationSaved(deleted, 'deleted');
      return !!deleted;
    },
  };
}
