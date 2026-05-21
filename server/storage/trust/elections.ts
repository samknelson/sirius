import { getClient, runInTransaction } from '../transaction-context';
import {
  workerTrustElections,
  workers,
  policies,
  contacts,
  trustBenefits,
  workerRelations,
  optionsWorkerRelationType,
  createWorkerTrustElectionRequestSchema,
  updateWorkerTrustElectionRequestSchema,
  type WorkerTrustElection,
  type WorkerTrustElectionView,
} from '@shared/schema';
import { eq, and, asc, desc, isNull, lt, lte, gte, or, ne, inArray, type SQL } from 'drizzle-orm';
import { defineLoggingConfig, type StorageLoggingConfig } from '../middleware/logging';
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
  getActiveByWorkerAsOf(workerId: string, asOfYmd: string): Promise<WorkerTrustElection | undefined>;
  searchViews(params: WorkerTrustElectionSearchParams): Promise<WorkerTrustElectionView[]>;
  getViewById(id: string): Promise<WorkerTrustElectionView | undefined>;
  getActiveViewByWorker(workerId: string): Promise<WorkerTrustElectionView | undefined>;
  create(workerId: string, input: unknown): Promise<WorkerTrustElection>;
  update(id: string, input: unknown): Promise<WorkerTrustElection | undefined>;
  delete(id: string): Promise<boolean>;
}

async function hydrateElections(rows: WorkerTrustElection[]): Promise<WorkerTrustElectionView[]> {
  if (rows.length === 0) return [];
  const client = getClient();

  const policyIdSet = new Set<string>();
  const benefitIdSet = new Set<string>();
  const relIdSet = new Set<string>();
  for (const row of rows) {
    if (row.policyId) policyIdSet.add(row.policyId);
    for (const id of row.benefitIds ?? []) benefitIdSet.add(id);
    for (const id of row.relationshipIds ?? []) relIdSet.add(id);
  }

  const [policyRows, benefitRows, relRows] = await Promise.all([
    policyIdSet.size
      ? client
          .select({ id: policies.id, name: policies.name })
          .from(policies)
          .where(inArray(policies.id, Array.from(policyIdSet)))
      : Promise.resolve([] as { id: string; name: string | null }[]),
    benefitIdSet.size
      ? client
          .select({ id: trustBenefits.id, name: trustBenefits.name })
          .from(trustBenefits)
          .where(inArray(trustBenefits.id, Array.from(benefitIdSet)))
      : Promise.resolve([] as { id: string; name: string | null }[]),
    relIdSet.size
      ? client
          .select({
            id: workerRelations.id,
            worker1: workerRelations.worker1,
            worker2: workerRelations.worker2,
            relationTypeName: optionsWorkerRelationType.name,
          })
          .from(workerRelations)
          .leftJoin(
            optionsWorkerRelationType,
            eq(workerRelations.relationType, optionsWorkerRelationType.id),
          )
          .where(inArray(workerRelations.id, Array.from(relIdSet)))
      : Promise.resolve(
          [] as { id: string; worker1: string; worker2: string; relationTypeName: string | null }[],
        ),
  ]);

  const otherWorkerIds = new Set<string>();
  for (const r of relRows) {
    otherWorkerIds.add(r.worker1);
    otherWorkerIds.add(r.worker2);
  }

  const workerNameRows = otherWorkerIds.size
    ? await client
        .select({
          id: workers.id,
          displayName: contacts.displayName,
          given: contacts.given,
          family: contacts.family,
        })
        .from(workers)
        .leftJoin(contacts, eq(workers.contactId, contacts.id))
        .where(inArray(workers.id, Array.from(otherWorkerIds)))
    : [];

  const policyMap = new Map(policyRows.map((p) => [p.id, p.name ?? null]));
  const benefitMap = new Map(benefitRows.map((b) => [b.id, b.name ?? b.id]));
  const relMap = new Map(relRows.map((r) => [r.id, r]));
  const workerNameMap = new Map(workerNameRows.map((w) => [w.id, w]));

  return rows.map((election): WorkerTrustElectionView => {
    const benefits = (election.benefitIds ?? []).map((id) => ({
      id,
      name: benefitMap.get(id) ?? 'Unknown benefit',
    }));
    const relationships = (election.relationshipIds ?? []).map((id) => {
      const rel = relMap.get(id);
      if (!rel) return { id, label: 'Unknown relationship' };
      const otherId = rel.worker1 === election.workerId ? rel.worker2 : rel.worker1;
      const w = workerNameMap.get(otherId);
      const name = w
        ? [w.given, w.family].filter(Boolean).join(' ').trim() || w.displayName || 'Unknown worker'
        : 'Unknown worker';
      const type = rel.relationTypeName || 'relation';
      return { id, label: `${name} (${type})` };
    });
    return {
      ...election,
      policyName: policyMap.get(election.policyId) ?? null,
      benefits,
      relationships,
    };
  });
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

async function describeElection(
  workerId: string | null | undefined,
  startYmd: string | null | undefined,
): Promise<string> {
  const startPart = startYmd ? ` (start ${startYmd})` : '';
  if (!workerId) return `unknown worker${startPart}`;
  const { storage } = await import('../index');
  const name = await storage.workers.getWorkerDisplayName(workerId);
  return `${name}${startPart}`;
}

export const workerTrustElectionsLoggingConfig = defineLoggingConfig<WorkerTrustElectionsStorage>({
  module: 'worker-trust-elections',
  state: { key: 'election' },
  getter: 'getById',
  hostEntityId: (args, result, before) =>
    (before as ElectionBeforeState | undefined)?.election?.workerId
    ?? result?.workerId
    ?? args[0],
  methods: {
    create: {
      getEntityId: (_args, result) => result?.id || 'new election',
      getDescription: async (_args, result) =>
        `Created trust election for ${await describeElection(result?.workerId, result?.startYmd)}`,
    },
    update: {
      getDescription: async (_args, result, beforeState) => {
        const r = result || (beforeState as ElectionBeforeState | undefined)?.election;
        return `Updated trust election for ${await describeElection(r?.workerId, r?.startYmd)}`;
      },
    },
    delete: {
      getDescription: async (_args, _result, beforeState) => {
        const r = (beforeState as ElectionBeforeState | undefined)?.election;
        if (!r) return 'Deleted trust election';
        return `Deleted trust election for ${await describeElection(r.workerId, r.startYmd)}`;
      },
    },
  },
});

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

    async getActiveByWorkerAsOf(workerId, asOfYmd) {
      const client = getClient();
      const rows = await client
        .select()
        .from(workerTrustElections)
        .where(
          and(
            eq(workerTrustElections.workerId, workerId),
            lte(workerTrustElections.startYmd, asOfYmd),
            or(
              isNull(workerTrustElections.endYmd),
              gte(workerTrustElections.endYmd, asOfYmd),
            ),
          ),
        )
        .orderBy(desc(workerTrustElections.startYmd))
        .limit(1);
      return rows[0];
    },

    async searchViews(params) {
      const rows = await storage.search(params);
      return await hydrateElections(rows);
    },

    async getViewById(id) {
      const row = await storage.getById(id);
      if (!row) return undefined;
      const [view] = await hydrateElections([row]);
      return view;
    },

    async getActiveViewByWorker(workerId) {
      const row = await storage.getActiveByWorker(workerId);
      if (!row) return undefined;
      const [view] = await hydrateElections([row]);
      return view;
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
