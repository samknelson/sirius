import { getClient, runInTransaction } from '../../../../../storage/transaction-context';

import { trustBenefitEligibilityExemptions, trustBenefitEligibilityExemptionDataFor, readTrustBenefitEligibilityExemptionSource, type TrustBenefitEligibilityExemptionView, TRUST_EXEMPTION_SOURCE_S1_APPEAL_ELECTION } from '@shared/schema';
import { eq, sql, type SQL } from 'drizzle-orm';

import { YMD_PATTERN, normalizePluginSet, samePluginSet, TrustBenefitEligibilityExemptionValidationError, assertWorkerExists, assertBenefitExists, emitExemptionSaved, toView } from '../../../../../storage/trust/eligibility-exemptions';

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

function recordsS1AppealElectionNid(electionNid: number): SQL {
  return sql`${trustBenefitEligibilityExemptions.data}->'source'->>'kind' = ${TRUST_EXEMPTION_SOURCE_S1_APPEAL_ELECTION}
    AND ${trustBenefitEligibilityExemptions.data}->'source'->>'electionNid' = ${String(electionNid)}`;
}
export interface S1TrustBenefitEligibilityExemptionsOperations {

  /** Reconcile exactly one S1-owned appeal exemption, never adopting manual/BAO rows. */
  upsertForS1AppealElection(input: S1AppealElectionExemptionInput): Promise<S1AppealElectionExemptionResult>;

  listByS1AppealElectionNids(electionNids: number[]): Promise<TrustBenefitEligibilityExemptionView[]>;

  deleteForS1AppealElection(electionNid: number): Promise<boolean>;
}

export function createS1TrustBenefitEligibilityExemptionsOperations(): S1TrustBenefitEligibilityExemptionsOperations {
  return {

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
    }
  };
}

export const s1EligibilityExemptions = createS1TrustBenefitEligibilityExemptionsOperations();
