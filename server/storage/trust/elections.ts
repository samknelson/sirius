import { getClient, runInTransaction } from '../transaction-context';
import {
  workerTrustElections,
  workers,
  policies,
  createWorkerTrustElectionRequestSchema,
  updateWorkerTrustElectionRequestSchema,
  type WorkerTrustElection,
} from '@shared/schema';
import { eq, and, asc, desc, isNull, lt, ne, type SQL } from 'drizzle-orm';
import { type StorageLoggingConfig } from '../middleware/logging';
import { normalizeToDateOnly, getTodayDateOnly } from '@shared/utils';

export interface WorkerTrustElectionSearchParams {
  id?: string;
  workerId?: string;
  policyId?: string;
  activeOnly?: boolean;
  sort?: 'startAsc' | 'startDesc';
  limit?: number;
  offset?: number;
}

export interface WorkerTrustElectionsStorage {
  search(params: WorkerTrustElectionSearchParams): Promise<WorkerTrustElection[]>;
  getById(id: string): Promise<WorkerTrustElection | undefined>;
  listByWorker(workerId: string): Promise<WorkerTrustElection[]>;
  getActiveByWorker(workerId: string): Promise<WorkerTrustElection | undefined>;
  create(workerId: string, input: unknown): Promise<WorkerTrustElection>;
  update(id: string, input: unknown): Promise<WorkerTrustElection | undefined>;
  delete(id: string): Promise<boolean>;
}

export class WorkerTrustElectionValidationError extends Error {
  constructor(public field: string, message: string) {
    super(message);
    this.name = 'WorkerTrustElectionValidationError';
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

function ymdMinusOneDay(ymd: string): string {
  const d = new Date(ymd + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - 1);
  const yr = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dy = String(d.getUTCDate()).padStart(2, '0');
  return `${yr}-${mo}-${dy}`;
}

interface ValidationInput {
  workerId?: string | null;
  policyId?: string | null;
  startYmd?: Date | string | null;
  endYmd?: Date | string | null;
}

async function validateElection(
  data: ValidationInput,
  existing?: WorkerTrustElection,
): Promise<{ workerId: string; policyId: string; startYmd: string; endYmd: string | null }> {
  const workerId = data.workerId ?? existing?.workerId ?? undefined;
  const policyId = data.policyId ?? existing?.policyId ?? undefined;
  const startSource = data.startYmd !== undefined ? data.startYmd : existing?.startYmd ?? null;
  const endSource = data.endYmd !== undefined ? data.endYmd : existing?.endYmd ?? null;
  const startYmd = toYmd(startSource);
  const endYmd = toYmd(endSource);

  if (!workerId) throw new WorkerTrustElectionValidationError('workerId', 'workerId is required');
  if (!policyId) throw new WorkerTrustElectionValidationError('policyId', 'policyId is required');
  if (!startYmd) throw new WorkerTrustElectionValidationError('startYmd', 'startYmd is required');

  const today = toYmd(getTodayDateOnly())!;
  if (startYmd > today) {
    throw new WorkerTrustElectionValidationError('startYmd', 'startYmd cannot be in the future');
  }
  if (endYmd && endYmd <= startYmd) {
    throw new WorkerTrustElectionValidationError('endYmd', 'endYmd must be strictly after startYmd');
  }

  const client = getClient();
  const [foundWorker] = await client.select({ id: workers.id }).from(workers).where(eq(workers.id, workerId));
  if (!foundWorker) throw new WorkerTrustElectionValidationError('workerId', 'worker does not exist');
  const [foundPolicy] = await client.select({ id: policies.id }).from(policies).where(eq(policies.id, policyId));
  if (!foundPolicy) throw new WorkerTrustElectionValidationError('policyId', 'policy does not exist');

  return { workerId, policyId, startYmd, endYmd };
}

interface ElectionBeforeState {
  election: WorkerTrustElection | undefined;
}

export const workerTrustElectionsLoggingConfig: StorageLoggingConfig<WorkerTrustElectionsStorage> = {
  module: 'worker-trust-elections',
  methods: {
    create: {
      enabled: true,
      getEntityId: (_args, result) => result?.id || 'new election',
      getHostEntityId: (args, result) => result?.workerId ?? args[0],
      getDescription: async (_args, result) =>
        `Created trust election for worker ${result?.workerId} (start ${result?.startYmd})`,
      after: async (_args, result) => ({ election: result }),
    },
    update: {
      enabled: true,
      getEntityId: (args) => args[0],
      getHostEntityId: async (_args, _result, beforeState) =>
        (beforeState as ElectionBeforeState | undefined)?.election?.workerId,
      getDescription: async (_args, result, beforeState) => {
        const r = result || (beforeState as ElectionBeforeState | undefined)?.election;
        return `Updated trust election ${r?.id} (worker ${r?.workerId})`;
      },
      before: async (args, storage) => ({ election: await storage.getById(args[0]) }),
      after: async (_args, result) => ({ election: result }),
    },
    delete: {
      enabled: true,
      getEntityId: (args) => args[0],
      getHostEntityId: async (_args, _result, beforeState) =>
        (beforeState as ElectionBeforeState | undefined)?.election?.workerId,
      getDescription: async (_args, _result, beforeState) => {
        const r = (beforeState as ElectionBeforeState | undefined)?.election;
        return r ? `Deleted trust election ${r.id} (worker ${r.workerId})` : 'Deleted trust election';
      },
      before: async (args, storage) => ({ election: await storage.getById(args[0]) }),
    },
  },
};

export function createWorkerTrustElectionsStorage(): WorkerTrustElectionsStorage {
  const storage: WorkerTrustElectionsStorage = {
    async search(params): Promise<WorkerTrustElection[]> {
      const client = getClient();
      const conds: SQL[] = [];
      if (params.id) conds.push(eq(workerTrustElections.id, params.id));
      if (params.workerId) conds.push(eq(workerTrustElections.workerId, params.workerId));
      if (params.policyId) conds.push(eq(workerTrustElections.policyId, params.policyId));
      if (params.activeOnly) {
        conds.push(isNull(workerTrustElections.endYmd));
      }
      const where = conds.length > 0 ? and(...conds) : undefined;
      const order = params.sort === 'startAsc'
        ? asc(workerTrustElections.startYmd)
        : desc(workerTrustElections.startYmd);
      const base = client.select().from(workerTrustElections).$dynamic();
      const filtered = where ? base.where(where) : base;
      const ordered = filtered.orderBy(order);
      const limited = params.limit !== undefined ? ordered.limit(params.limit) : ordered;
      const final = params.offset !== undefined ? limited.offset(params.offset) : limited;
      return await final;
    },

    async getById(id) {
      const rows = await storage.search({ id, limit: 1 });
      return rows[0];
    },

    async listByWorker(workerId) {
      return await storage.search({ workerId, sort: 'startDesc' });
    },

    async getActiveByWorker(workerId) {
      const rows = await storage.search({ workerId, activeOnly: true, sort: 'startDesc', limit: 1 });
      return rows[0];
    },

    async create(workerId, input) {
      const parsed = createWorkerTrustElectionRequestSchema.parse(input);
      const validated = await validateElection({ workerId, ...parsed });
      return await runInTransaction(async () => {
        const client = getClient();
        if (!validated.endYmd) {
          await endDatePreviousActive(client, validated.workerId, validated.startYmd, undefined);
        }
        const [created] = await client
          .insert(workerTrustElections)
          .values({
            workerId: validated.workerId,
            policyId: validated.policyId,
            startYmd: validated.startYmd,
            endYmd: validated.endYmd,
            benefitIds: parsed.benefitIds ?? null,
            relationshipIds: parsed.relationshipIds ?? null,
            data: (parsed.data ?? null) as WorkerTrustElection['data'],
          })
          .returning();
        return created;
      });
    },

    async update(id, input) {
      const parsed = updateWorkerTrustElectionRequestSchema.parse(input);
      return await runInTransaction(async () => {
        const client = getClient();
        const [existing] = await client
          .select()
          .from(workerTrustElections)
          .where(eq(workerTrustElections.id, id));
        if (!existing) return undefined;

        const validated = await validateElection(parsed, existing);
        if (!validated.endYmd) {
          await endDatePreviousActive(client, existing.workerId, validated.startYmd, id);
        }

        const updateValues: Record<string, unknown> = {
          policyId: validated.policyId,
          startYmd: validated.startYmd,
          endYmd: validated.endYmd,
        };
        if (parsed.benefitIds !== undefined) updateValues.benefitIds = parsed.benefitIds;
        if (parsed.relationshipIds !== undefined) updateValues.relationshipIds = parsed.relationshipIds;
        if (parsed.data !== undefined) updateValues.data = parsed.data;

        const [updated] = await client
          .update(workerTrustElections)
          .set(updateValues)
          .where(eq(workerTrustElections.id, id))
          .returning();
        return updated;
      });
    },

    async delete(id) {
      const client = getClient();
      const [deleted] = await client
        .delete(workerTrustElections)
        .where(eq(workerTrustElections.id, id))
        .returning();
      return !!deleted;
    },
  };
  return storage;
}

async function endDatePreviousActive(
  client: ReturnType<typeof getClient>,
  workerId: string,
  newStartYmd: string,
  excludeId: string | undefined,
): Promise<void> {
  const conds: SQL[] = [
    eq(workerTrustElections.workerId, workerId),
    isNull(workerTrustElections.endYmd),
  ];
  if (excludeId) conds.push(ne(workerTrustElections.id, excludeId));
  const others = await client
    .select()
    .from(workerTrustElections)
    .where(and(...conds));
  const newEnd = ymdMinusOneDay(newStartYmd);
  for (const prior of others) {
    if (prior.startYmd && prior.startYmd > newEnd) {
      throw new WorkerTrustElectionValidationError(
        'startYmd',
        `Cannot create an active election starting ${newStartYmd}: an existing active election starts on ${prior.startYmd} (after the new end-date of ${newEnd}).`,
      );
    }
    await client
      .update(workerTrustElections)
      .set({ endYmd: newEnd })
      .where(eq(workerTrustElections.id, prior.id));
  }
}
