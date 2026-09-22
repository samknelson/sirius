import { getClient, runInTransaction, onAfterCommit } from '../transaction-context';
import { eventBus, EventType } from '../../services/event-bus';
import {
  trustBenefitEligibilityExemptions,
  workers,
  trustBenefits,
  createTrustBenefitEligibilityExemptionRequestSchema,
  updateTrustBenefitEligibilityExemptionRequestSchema,
  trustBenefitEligibilityExemptionDataFor,
  readTrustBenefitEligibilityExemptionSource,
  type TrustBenefitEligibilityExemption,
  type TrustBenefitEligibilityExemptionSource,
  type TrustBenefitEligibilityExemptionView,
  TRUST_EXEMPTION_SOURCE_S1_APPEAL_ELECTION,
} from '@shared/schema';
import { eq, and, asc, desc, isNull, sql, type SQL } from 'drizzle-orm';
import { defineLoggingConfig } from '../middleware/logging';

export interface TrustBenefitEligibilityExemptionSearchParams {
  id?: string;
  subscriberWorkerId?: string;
  benefitId?: string;
  /** Only rows whose recorded provenance (`data.source`) is this source. */
  source?: TrustBenefitEligibilityExemptionSource;
  sort?: 'startAsc' | 'startDesc';
  limit?: number;
  offset?: number;
}

/** A programmatic, never-ending exemption grant (see `grantOpenEnded`). */
export interface GrantOpenEndedExemptionInput {
  subscriberWorkerId: string;
  benefitId: string;
  /** Checks to waive; duplicates and order are ignored. */
  eligibilityPlugins: string[];
  /** First day the exemption applies (YYYY-MM-DD). */
  startYmd: string;
  description: string | null;
  /** Recorded in the row's `data.source` so provenance can be shown. */
  source: TrustBenefitEligibilityExemptionSource;
}

export interface GrantOpenEndedExemptionResult {
  exemption: TrustBenefitEligibilityExemptionView;
  /**
   * False when an equivalent open-ended exemption (same worker, benefit and
   * check set, starting on or before the requested day) already existed and
   * was reused instead of duplicated.
   */
  created: boolean;
}

export interface S1AppealElectionExemptionInput {
  electionNid: number;
  electionName: string;
  policyNid?: number | null;
  policyName?: string | null;
  subscriberWorkerId: string;
  benefitId: string;
  eligibilityPlugins: string[];
  startYmd: string;
  endYmd: string | null;
  active?: boolean | null;
}

export interface S1AppealElectionExemptionResult {
  exemption: TrustBenefitEligibilityExemptionView;
  created: boolean;
  changed: boolean;
}

/**
 * Every read returns `TrustBenefitEligibilityExemptionView` — the row minus
 * its raw `data` jsonb, plus the validated provenance — see the contract on
 * `trustBenefitEligibilityExemptionSourceSchema`. Nothing here hands the
 * raw jsonb to a caller.
 */
export interface TrustBenefitEligibilityExemptionsStorage {
  search(params: TrustBenefitEligibilityExemptionSearchParams): Promise<TrustBenefitEligibilityExemptionView[]>;
  getById(id: string): Promise<TrustBenefitEligibilityExemptionView | undefined>;
  listByWorker(workerId: string): Promise<TrustBenefitEligibilityExemptionView[]>;
  /** The exemptions a given originating record created, newest start first. */
  listBySource(source: TrustBenefitEligibilityExemptionSource): Promise<TrustBenefitEligibilityExemptionView[]>;
  create(workerId: string, input: unknown): Promise<TrustBenefitEligibilityExemptionView>;
  update(id: string, input: unknown): Promise<TrustBenefitEligibilityExemptionView | undefined>;
  delete(id: string): Promise<boolean>;
  /**
   * Idempotently grant a never-ending exemption on behalf of a process (a
   * trustee-approved appeal, a bulk import). Joins the caller's transaction
   * when one is open, so a caller can make the grant and its own record
   * commit or roll back together. Serialized per worker + benefit with an
   * advisory transaction lock, so two concurrent grants of the same request
   * still yield one row.
   */
  grantOpenEnded(input: GrantOpenEndedExemptionInput): Promise<GrantOpenEndedExemptionResult>;
  /** Reconcile exactly one S1-owned appeal exemption, never adopting manual/BAO rows. */
  upsertForS1AppealElection(input: S1AppealElectionExemptionInput): Promise<S1AppealElectionExemptionResult>;
  listByS1AppealElectionNids(electionNids: number[]): Promise<TrustBenefitEligibilityExemptionView[]>;
  deleteForS1AppealElection(electionNid: number): Promise<boolean>;
}

const YMD_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** The check set an exemption waives, in a canonical order-free form. */
function normalizePluginSet(ids: readonly string[]): string[] {
  return [...new Set(ids.map((id) => id.trim()).filter(Boolean))].sort();
}

function samePluginSet(a: readonly string[], b: readonly string[]): boolean {
  const left = normalizePluginSet(a);
  const right = normalizePluginSet(b);
  return left.length === right.length && left.every((id, i) => id === right[i]);
}

export class TrustBenefitEligibilityExemptionValidationError extends Error {
  constructor(public field: string, message: string) {
    super(message);
    this.name = 'TrustBenefitEligibilityExemptionValidationError';
  }
}

/**
 * Emit `TRUST_EXEMPTION_SAVED` after the current transaction commits so
 * listeners (e.g. the auto-rescan service) never observe an uncommitted
 * change. The affected worker/benefit and date range are carried on the
 * payload because the row is already gone for deletes.
 */
function emitExemptionSaved(
  row: TrustBenefitEligibilityExemption,
  operation: 'created' | 'updated' | 'deleted',
): void {
  onAfterCommit(() => {
    void eventBus.emit(EventType.TRUST_EXEMPTION_SAVED, {
      exemptionId: row.id,
      workerId: row.subscriberWorkerId,
      benefitId: row.benefitId,
      startYmd: row.startYmd,
      endYmd: row.endYmd ?? null,
      operation,
    });
  });
}

interface ExemptionBeforeState {
  exemption: TrustBenefitEligibilityExemptionView | undefined;
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
    table: 'trust_benefit_eligibility_exemptions',
    hostTable: 'workers',
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
      // Non-conventional name: no synthesized hooks, so args[0] (the grant
      // input, not an id) is never handed to the getter. A reused grant is
      // logged too — the audit trail shows the appeal that leaned on an
      // existing exemption.
      grantOpenEnded: {
        getEntityId: (_args, result: GrantOpenEndedExemptionResult | undefined) =>
          result?.exemption?.id || 'new exemption',
        getHostEntityId: (args, result: GrantOpenEndedExemptionResult | undefined) =>
          result?.exemption?.subscriberWorkerId
          ?? (args[0] as GrantOpenEndedExemptionInput | undefined)?.subscriberWorkerId,
        after: async (_args, result: GrantOpenEndedExemptionResult | undefined) =>
          ({ exemption: result?.exemption, created: result?.created }),
        getDescription: async (args, result: GrantOpenEndedExemptionResult | undefined) => {
          const input = args[0] as GrantOpenEndedExemptionInput | undefined;
          const verb = result?.created ? 'Granted' : 'Reused';
          return `${verb} open-ended eligibility exemption (${input?.source?.kind ?? 'unknown source'}) for ${
            await describeExemption(result?.exemption?.subscriberWorkerId ?? input?.subscriberWorkerId, result?.exemption?.startYmd)
          }`;
        },
      },
    },
  });

/**
 * The one projection from a table row to what callers see: the raw `data`
 * jsonb is replaced by the provenance it records. Throws on a malformed
 * `data.source` (a writer bug) rather than reading it as a manual entry.
 */
function toView(row: TrustBenefitEligibilityExemption): TrustBenefitEligibilityExemptionView {
  const { data: _omit, ...rest } = row;
  return { ...rest, source: readTrustBenefitEligibilityExemptionSource(row) };
}

/**
 * Rows whose `data` contains exactly this provenance. Containment (`@>`)
 * matches the stored shape while ignoring any writer-private keys beside it,
 * mirroring what `readTrustBenefitEligibilityExemptionSource` accepts.
 */
function recordsSource(source: TrustBenefitEligibilityExemptionSource): SQL {
  const stored = JSON.stringify(trustBenefitEligibilityExemptionDataFor(source));
  return sql`${trustBenefitEligibilityExemptions.data} @> ${stored}::jsonb`;
}

function recordsS1AppealElectionNid(electionNid: number): SQL {
  return sql`${trustBenefitEligibilityExemptions.data}->'source'->>'kind' = ${TRUST_EXEMPTION_SOURCE_S1_APPEAL_ELECTION}
    AND ${trustBenefitEligibilityExemptions.data}->'source'->>'electionNid' = ${String(electionNid)}`;
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
    async search(params): Promise<TrustBenefitEligibilityExemptionView[]> {
      const client = getClient();
      const conds: SQL[] = [];
      if (params.id) conds.push(eq(trustBenefitEligibilityExemptions.id, params.id));
      if (params.subscriberWorkerId) {
        conds.push(eq(trustBenefitEligibilityExemptions.subscriberWorkerId, params.subscriberWorkerId));
      }
      if (params.benefitId) {
        conds.push(eq(trustBenefitEligibilityExemptions.benefitId, params.benefitId));
      }
      if (params.source) conds.push(recordsSource(params.source));
      const where = conds.length > 0 ? and(...conds) : undefined;
      const order = params.sort === 'startAsc'
        ? asc(trustBenefitEligibilityExemptions.startYmd)
        : desc(trustBenefitEligibilityExemptions.startYmd);
      const base = client.select().from(trustBenefitEligibilityExemptions).$dynamic();
      const filtered = where ? base.where(where) : base;
      const ordered = filtered.orderBy(order);
      const limited = params.limit !== undefined ? ordered.limit(params.limit) : ordered;
      const final = params.offset !== undefined ? limited.offset(params.offset) : limited;
      return (await final).map(toView);
    },

    async getById(id) {
      const rows = await storage.search({ id, limit: 1 });
      return rows[0];
    },

    async listByWorker(workerId) {
      return await storage.search({ subscriberWorkerId: workerId, sort: 'startDesc' });
    },

    async listBySource(source) {
      return await storage.search({ source, sort: 'startDesc' });
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
        emitExemptionSaved(created, 'created');
        return toView(created);
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

        if (Object.keys(updateValues).length === 0) return toView(existing);

        const [updated] = await client
          .update(trustBenefitEligibilityExemptions)
          .set(updateValues)
          .where(eq(trustBenefitEligibilityExemptions.id, id))
          .returning();
        emitExemptionSaved(updated, 'updated');
        // Include the pre-update range too: narrowing an exemption changes
        // eligibility for months that only the OLD range covered.
        if (existing.startYmd !== updated.startYmd || existing.endYmd !== updated.endYmd) {
          emitExemptionSaved(existing, 'updated');
        }
        return toView(updated);
      });
    },

    async delete(id) {
      const client = getClient();
      const [deleted] = await client
        .delete(trustBenefitEligibilityExemptions)
        .where(eq(trustBenefitEligibilityExemptions.id, id))
        .returning();
      if (deleted) emitExemptionSaved(deleted, 'deleted');
      return !!deleted;
    },

    async grantOpenEnded(input) {
      const eligibilityPlugins = normalizePluginSet(input.eligibilityPlugins);
      if (eligibilityPlugins.length === 0) {
        throw new TrustBenefitEligibilityExemptionValidationError(
          'eligibilityPlugins',
          'At least one eligibility check is required',
        );
      }
      if (!YMD_PATTERN.test(input.startYmd)) {
        throw new TrustBenefitEligibilityExemptionValidationError('startYmd', 'startYmd must be YYYY-MM-DD');
      }
      return await runInTransaction(async () => {
        const client = getClient();
        // The reuse check below is check-then-insert: serialize grants for
        // this worker + benefit for the rest of the transaction so two
        // concurrent identical grants cannot both miss and both insert.
        const lockKey = `trust-exemption-grant:${input.subscriberWorkerId}:${input.benefitId}`;
        await client.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);
        await assertWorkerExists(input.subscriberWorkerId);
        await assertBenefitExists(input.benefitId);

        const open = await client
          .select()
          .from(trustBenefitEligibilityExemptions)
          .where(and(
            eq(trustBenefitEligibilityExemptions.subscriberWorkerId, input.subscriberWorkerId),
            eq(trustBenefitEligibilityExemptions.benefitId, input.benefitId),
            isNull(trustBenefitEligibilityExemptions.endYmd),
          ))
          .orderBy(asc(trustBenefitEligibilityExemptions.startYmd));
        // An open-ended exemption waiving exactly these checks from a day no
        // later than the requested one already covers the request forever:
        // granting again would only duplicate it.
        const covering = open.find((row) =>
          samePluginSet(row.eligibilityPlugins, eligibilityPlugins) && row.startYmd <= input.startYmd,
        );
        if (covering) return { exemption: toView(covering), created: false };

        const [created] = await client
          .insert(trustBenefitEligibilityExemptions)
          .values({
            subscriberWorkerId: input.subscriberWorkerId,
            benefitId: input.benefitId,
            eligibilityPlugins,
            startYmd: input.startYmd,
            endYmd: null,
            description: input.description,
            data: trustBenefitEligibilityExemptionDataFor(input.source),
          })
          .returning();
        emitExemptionSaved(created, 'created');
        return { exemption: toView(created), created: true };
      });
    },

    async upsertForS1AppealElection(input) {
      const source = {
        kind: TRUST_EXEMPTION_SOURCE_S1_APPEAL_ELECTION,
        electionNid: String(input.electionNid),
        electionName: input.electionName,
        policyNid: input.policyNid == null ? null : String(input.policyNid),
        policyName: input.policyName ?? null,
        startYmd: input.startYmd,
        endYmd: input.endYmd,
        active: input.active ?? null,
      } as const;
      const plugins = normalizePluginSet(input.eligibilityPlugins);
      if (!YMD_PATTERN.test(input.startYmd)) {
        throw new TrustBenefitEligibilityExemptionValidationError('startYmd', 'startYmd must be YYYY-MM-DD');
      }
      if (input.endYmd && (!YMD_PATTERN.test(input.endYmd) || input.endYmd <= input.startYmd)) {
        throw new TrustBenefitEligibilityExemptionValidationError('endYmd', 'endYmd must be strictly after startYmd');
      }
      if (plugins.length === 0) {
        throw new TrustBenefitEligibilityExemptionValidationError('eligibilityPlugins', 'At least one eligibility check is required');
      }
      return await runInTransaction(async () => {
        const client = getClient();
        await client.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${'trust-s1-appeal:' + input.electionNid}, 0))`);
        await assertWorkerExists(input.subscriberWorkerId);
        await assertBenefitExists(input.benefitId);
        const owned = await client.select().from(trustBenefitEligibilityExemptions)
          .where(recordsS1AppealElectionNid(input.electionNid));
        if (owned.length > 1) {
          throw new TrustBenefitEligibilityExemptionValidationError('electionNid', 'duplicate S1-owned exemptions exist');
        }
        const values = {
          subscriberWorkerId: input.subscriberWorkerId,
          benefitId: input.benefitId,
          eligibilityPlugins: plugins,
          startYmd: input.startYmd,
          endYmd: input.endYmd,
          description: `S1 appeal election ${input.electionNid}: ${input.electionName}`,
          data: trustBenefitEligibilityExemptionDataFor(source),
        };
        if (owned.length === 0) {
          const [created] = await client.insert(trustBenefitEligibilityExemptions).values(values).returning();
          emitExemptionSaved(created, 'created');
          return { exemption: toView(created), created: true, changed: true };
        }
        const existing = owned[0];
        const existingSource = readTrustBenefitEligibilityExemptionSource(existing);
        const changed = existing.subscriberWorkerId !== values.subscriberWorkerId ||
          existing.benefitId !== values.benefitId ||
          !samePluginSet(existing.eligibilityPlugins, plugins) ||
          existing.startYmd !== values.startYmd ||
          (existing.endYmd ?? null) !== values.endYmd ||
          existing.description !== values.description ||
          JSON.stringify(existingSource) !== JSON.stringify(source);
        if (!changed) return { exemption: toView(existing), created: false, changed: false };
        const [updated] = await client.update(trustBenefitEligibilityExemptions).set(values)
          .where(eq(trustBenefitEligibilityExemptions.id, existing.id)).returning();
        emitExemptionSaved(updated, 'updated');
        if (existing.startYmd !== updated.startYmd || existing.endYmd !== updated.endYmd) emitExemptionSaved(existing, 'updated');
        return { exemption: toView(updated), created: false, changed: true };
      });
    },

    async listByS1AppealElectionNids(electionNids) {
      if (electionNids.length === 0) return [];
      const rows = await getClient().select().from(trustBenefitEligibilityExemptions)
        .where(sql`${trustBenefitEligibilityExemptions.data}->'source'->>'kind' = ${TRUST_EXEMPTION_SOURCE_S1_APPEAL_ELECTION}
          AND (${trustBenefitEligibilityExemptions.data}->'source'->>'electionNid') IN (${sql.join(electionNids.map((n) => sql`${String(n)}`), sql`, `)})`);
      return rows.map(toView);
    },

    async deleteForS1AppealElection(electionNid) {
      return await runInTransaction(async () => {
        const client = getClient();
        await client.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${'trust-s1-appeal:' + electionNid}, 0))`);
        const matches = await client.select().from(trustBenefitEligibilityExemptions).where(recordsS1AppealElectionNid(electionNid));
        if (matches.length > 1) {
          throw new TrustBenefitEligibilityExemptionValidationError('electionNid', 'duplicate S1-owned exemptions exist');
        }
        const [deleted] = matches.length === 1
          ? await client.delete(trustBenefitEligibilityExemptions).where(eq(trustBenefitEligibilityExemptions.id, matches[0].id)).returning()
          : [];
        if (deleted) emitExemptionSaved(deleted, 'deleted');
        return !!deleted;
      });
    },
  };
  return storage;
}
