import { getClient, runInTransaction } from '../transaction-context';
import {
  trustBenefitEligibilityExemptions,
  workers,
  trustBenefits,
  createTrustBenefitEligibilityExemptionRequestSchema,
  updateTrustBenefitEligibilityExemptionRequestSchema,
  type TrustBenefitEligibilityExemption,
} from '@shared/schema';
import { eq, and, asc, desc, type SQL } from 'drizzle-orm';
import { defineLoggingConfig } from '../middleware/logging';

export interface TrustBenefitEligibilityExemptionSearchParams {
  id?: string;
  subscriberWorkerId?: string;
  benefitId?: string;
  sort?: 'startAsc' | 'startDesc';
  limit?: number;
  offset?: number;
}

export interface TrustBenefitEligibilityExemptionsStorage {
  search(params: TrustBenefitEligibilityExemptionSearchParams): Promise<TrustBenefitEligibilityExemption[]>;
  getById(id: string): Promise<TrustBenefitEligibilityExemption | undefined>;
  listByWorker(workerId: string): Promise<TrustBenefitEligibilityExemption[]>;
  create(workerId: string, input: unknown): Promise<TrustBenefitEligibilityExemption>;
  update(id: string, input: unknown): Promise<TrustBenefitEligibilityExemption | undefined>;
  delete(id: string): Promise<boolean>;
}

export class TrustBenefitEligibilityExemptionValidationError extends Error {
  constructor(public field: string, message: string) {
    super(message);
    this.name = 'TrustBenefitEligibilityExemptionValidationError';
  }
}

interface ExemptionBeforeState {
  exemption: TrustBenefitEligibilityExemption | undefined;
}

async function describeExemption(
  subscriberWorkerId: string | null | undefined,
  startYmd: string | null | undefined,
): Promise<string> {
  const startPart = startYmd ? ` (start ${startYmd})` : '';
  if (!subscriberWorkerId) return `unknown worker${startPart}`;
  const { storage } = await import('../index');
  const name = await storage.workers.getWorkerDisplayName(subscriberWorkerId);
  return `${name}${startPart}`;
}

export const trustBenefitEligibilityExemptionsLoggingConfig =
  defineLoggingConfig<TrustBenefitEligibilityExemptionsStorage>({
    module: 'trust-benefit-eligibility-exemptions',
    state: { key: 'exemption' },
    getter: 'getById',
    hostEntityId: (args, result, before) =>
      (before as ExemptionBeforeState | undefined)?.exemption?.subscriberWorkerId
      ?? result?.subscriberWorkerId
      ?? args[0],
    methods: {
      create: {
        getEntityId: (_args, result) => result?.id || 'new exemption',
        getDescription: async (_args, result) =>
          `Created eligibility exemption for ${await describeExemption(result?.subscriberWorkerId, result?.startYmd)}`,
      },
      update: {
        getDescription: async (_args, result, beforeState) => {
          const r = result || (beforeState as ExemptionBeforeState | undefined)?.exemption;
          return `Updated eligibility exemption for ${await describeExemption(r?.subscriberWorkerId, r?.startYmd)}`;
        },
      },
      delete: {
        getDescription: async (_args, _result, beforeState) => {
          const r = (beforeState as ExemptionBeforeState | undefined)?.exemption;
          if (!r) return 'Deleted eligibility exemption';
          return `Deleted eligibility exemption for ${await describeExemption(r.subscriberWorkerId, r.startYmd)}`;
        },
      },
    },
  });

function stripData(row: TrustBenefitEligibilityExemption): TrustBenefitEligibilityExemption {
  if (row && typeof row === 'object' && 'data' in row) {
    const { data: _omit, ...rest } = row as Record<string, unknown>;
    return rest as TrustBenefitEligibilityExemption;
  }
  return row;
}

async function assertWorkerExists(workerId: string): Promise<void> {
  const client = getClient();
  const [found] = await client.select({ id: workers.id }).from(workers).where(eq(workers.id, workerId));
  if (!found) {
    throw new TrustBenefitEligibilityExemptionValidationError('subscriberWorkerId', 'worker does not exist');
  }
}

async function assertBenefitExists(benefitId: string): Promise<void> {
  const client = getClient();
  const [found] = await client.select({ id: trustBenefits.id }).from(trustBenefits).where(eq(trustBenefits.id, benefitId));
  if (!found) {
    throw new TrustBenefitEligibilityExemptionValidationError('benefitId', 'benefit does not exist');
  }
}

export function createTrustBenefitEligibilityExemptionsStorage(): TrustBenefitEligibilityExemptionsStorage {
  const storage: TrustBenefitEligibilityExemptionsStorage = {
    async search(params): Promise<TrustBenefitEligibilityExemption[]> {
      const client = getClient();
      const conds: SQL[] = [];
      if (params.id) conds.push(eq(trustBenefitEligibilityExemptions.id, params.id));
      if (params.subscriberWorkerId) {
        conds.push(eq(trustBenefitEligibilityExemptions.subscriberWorkerId, params.subscriberWorkerId));
      }
      if (params.benefitId) {
        conds.push(eq(trustBenefitEligibilityExemptions.benefitId, params.benefitId));
      }
      const where = conds.length > 0 ? and(...conds) : undefined;
      const order = params.sort === 'startAsc'
        ? asc(trustBenefitEligibilityExemptions.startYmd)
        : desc(trustBenefitEligibilityExemptions.startYmd);
      const base = client.select().from(trustBenefitEligibilityExemptions).$dynamic();
      const filtered = where ? base.where(where) : base;
      const ordered = filtered.orderBy(order);
      const limited = params.limit !== undefined ? ordered.limit(params.limit) : ordered;
      const final = params.offset !== undefined ? limited.offset(params.offset) : limited;
      return (await final).map(stripData);
    },

    async getById(id) {
      const rows = await storage.search({ id, limit: 1 });
      return rows[0];
    },

    async listByWorker(workerId) {
      return await storage.search({ subscriberWorkerId: workerId, sort: 'startDesc' });
    },

    async create(workerId, input) {
      const parsed = createTrustBenefitEligibilityExemptionRequestSchema.parse({
        ...(input as Record<string, unknown>),
        subscriberWorkerId: workerId,
      });
      return await runInTransaction(async () => {
        await assertWorkerExists(parsed.subscriberWorkerId);
        await assertBenefitExists(parsed.benefitId);
        const client = getClient();
        const [created] = await client
          .insert(trustBenefitEligibilityExemptions)
          .values({
            subscriberWorkerId: parsed.subscriberWorkerId,
            benefitId: parsed.benefitId,
            eligibilityPlugins: parsed.eligibilityPlugins,
            startYmd: parsed.startYmd,
            endYmd: parsed.endYmd ?? null,
            description: parsed.description ?? null,
          })
          .returning();
        return stripData(created);
      });
    },

    async update(id, input) {
      const parsed = updateTrustBenefitEligibilityExemptionRequestSchema.parse(input);
      return await runInTransaction(async () => {
        const client = getClient();
        const [existing] = await client
          .select()
          .from(trustBenefitEligibilityExemptions)
          .where(eq(trustBenefitEligibilityExemptions.id, id));
        if (!existing) return undefined;

        const startYmd = parsed.startYmd ?? existing.startYmd;
        const endYmd = parsed.endYmd !== undefined ? parsed.endYmd : existing.endYmd;
        if (endYmd && endYmd <= startYmd) {
          throw new TrustBenefitEligibilityExemptionValidationError(
            'endYmd',
            'endYmd must be strictly after startYmd',
          );
        }

        if (parsed.benefitId !== undefined) {
          await assertBenefitExists(parsed.benefitId);
        }

        const updateValues: Record<string, unknown> = {};
        if (parsed.benefitId !== undefined) updateValues.benefitId = parsed.benefitId;
        if (parsed.eligibilityPlugins !== undefined) updateValues.eligibilityPlugins = parsed.eligibilityPlugins;
        if (parsed.startYmd !== undefined) updateValues.startYmd = parsed.startYmd;
        if (parsed.endYmd !== undefined) updateValues.endYmd = parsed.endYmd;
        if (parsed.description !== undefined) updateValues.description = parsed.description;

        if (Object.keys(updateValues).length === 0) return stripData(existing);

        const [updated] = await client
          .update(trustBenefitEligibilityExemptions)
          .set(updateValues)
          .where(eq(trustBenefitEligibilityExemptions.id, id))
          .returning();
        return stripData(updated);
      });
    },

    async delete(id) {
      const client = getClient();
      const [deleted] = await client
        .delete(trustBenefitEligibilityExemptions)
        .where(eq(trustBenefitEligibilityExemptions.id, id))
        .returning();
      return !!deleted;
    },
  };
  return storage;
}
