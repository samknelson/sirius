import { storage } from "../../../storage/database";
import type { BaoDpTierTransition } from "@shared/schema/sitespecific/bao/schema";
import type { WorkerTrustElection } from "@shared/schema/trust/elections-schema";

/**
 * Shared Domestic Partner pricing rules, used by BOTH the DP charge plugin
 * (what gets billed) and the DP payment eligibility plugin (what must be
 * paid). Keeping them in one place guarantees a month the biller treats as
 * "confirmed no charge" is exactly the month the eligibility gate waives
 * payment for.
 */

/** Whether a relation-type name identifies a domestic-partner relation. */
export function isDpRelationTypeName(name: string | null | undefined): boolean {
  return !!name && name.toLowerCase().includes("domestic partner");
}

/**
 * Coverage-tier transition for one DP on an election, derived from the
 * covered lives EXCLUDING all DP dependents: 1 non-DP life (member only) →
 * single_to_2party (Single → Single +1), 2 → 2party_to_family (Single +1 →
 * Family), 3+ → family_to_family_dp (member already has two or more
 * children — confirmed no charge on the 2026 rate sheet). single_to_family
 * (member with no children adds a DP AND the DP's children) is never
 * auto-selected: no confirmed rule maps an election shape to it.
 *
 * `relationTypeNameOf` resolves a relationship id to its relation-type name;
 * relationships it cannot resolve are not countable.
 */
export function resolveDpTierTransition(
  election: Pick<WorkerTrustElection, "relationshipIds">,
  relationTypeNameOf: (relationshipId: string) => string | null | undefined,
): BaoDpTierTransition {
  let nonDpDependents = 0;
  for (const relId of election.relationshipIds ?? []) {
    const name = relationTypeNameOf(relId);
    if (name === undefined) continue; // missing relation row: not countable
    if (!isDpRelationTypeName(name)) nonDpDependents++;
  }
  const nonDpLives = 1 + nonDpDependents; // member + non-DP dependents
  return nonDpLives <= 1
    ? "single_to_2party"
    : nonDpLives === 2
      ? "2party_to_family"
      : "family_to_family_dp";
}

export type DpMonthPrice =
  | {
      /** A confirmed, positive monthly member charge. */
      kind: "charge";
      amount: string;
      benefitId: string;
      lineRates: Record<string, string>;
    }
  | {
      /**
       * A CONFIRMED zero rate (non-provisional, exactly $0.00): the month is
       * covered at no charge. Nothing is billed and no payment is required.
       */
      kind: "no_charge";
      benefitId: string;
    }
  | {
      /**
       * Fail-closed: no present benefit has an applicable rate row, or the
       * single applicable rate is provisional or negative. Never billed and
       * never treated as free.
       */
      kind: "missing_rate";
      ratedBenefitIds: string[];
    }
  | {
      /** Fail-closed: more than one present benefit has an applicable rate. */
      kind: "ambiguous_rates";
      ratedBenefitIds: string[];
    };

/**
 * Price a coverage month from the DP rate sheet. The rate sheet decides
 * which present benefit is billable: benefits WITHOUT an applicable rate row
 * (ancillary dental/vision/life/prescription/EAP/AD&D) are ignored, and the
 * month prices at the single rated (medical) benefit's effective rate as of
 * the first of the month.
 *
 * A confirmed $0.00 rate is a distinct, positive statement ("no charge") and
 * is only recognised when the row is NOT provisional. A provisional $0.00
 * placeholder is still `missing_rate`.
 */
export async function priceDpMonth(
  presentBenefitIds: string[],
  transition: BaoDpTierTransition,
  ym: string,
): Promise<DpMonthPrice> {
  const asOfYmd = `${ym}-01`;
  const rated: Array<{ benefitId: string; rate: string; provisional: boolean }> =
    [];
  for (const benefitId of presentBenefitIds) {
    const rate = await storage.baoDpRates.getEffectiveRate(
      benefitId,
      transition,
      asOfYmd,
    );
    if (!rate) continue; // no DP rate for this benefit (ancillary) — ignore
    rated.push({
      benefitId,
      rate: rate.rate,
      provisional: !!rate.provisional,
    });
  }
  if (rated.length === 0) {
    return { kind: "missing_rate", ratedBenefitIds: [] };
  }
  if (rated.length > 1) {
    return {
      kind: "ambiguous_rates",
      ratedBenefitIds: rated.map((r) => r.benefitId),
    };
  }
  const [only] = rated;
  const amount = Number(only.rate);
  if (only.provisional || !Number.isFinite(amount) || amount < 0) {
    return { kind: "missing_rate", ratedBenefitIds: [only.benefitId] };
  }
  if (Math.abs(amount) < 0.005) {
    return { kind: "no_charge", benefitId: only.benefitId };
  }
  return {
    kind: "charge",
    amount: amount.toFixed(2),
    benefitId: only.benefitId,
    lineRates: { [only.benefitId]: only.rate },
  };
}
