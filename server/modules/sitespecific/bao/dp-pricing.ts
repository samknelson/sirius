import { storage } from "../../../storage/database";
import type { BaoDpTierTransition } from "@shared/schema/sitespecific/bao/schema";
import type { WorkerTrustElection } from "@shared/schema/trust/elections-schema";
import { classifyDpRelationTypeName } from "@shared/sitespecific/bao/dp-relation-types";

/**
 * Shared Domestic Partner pricing rules, used by BOTH the DP charge plugin
 * (what gets billed) and the DP payment eligibility plugin (what must be
 * paid). Keeping them in one place guarantees a month the biller treats as
 * "confirmed no charge" is exactly the month the eligibility gate waives
 * payment for.
 */

/**
 * Relation-type identification (who is the DP, who is a DP's child, who is
 * the member's own dependent) is the pure shared core in
 * shared/sitespecific/bao/dp-relation-types.ts — the `worker.dp` access
 * policy reads the same predicates. Re-exported here for the two plugins.
 */
export {
  classifyDpRelationTypeName,
  isDpChildRelationTypeName,
  isDpRelationTypeName,
  type DpRelationKind,
} from "@shared/sitespecific/bao/dp-relation-types";

/**
 * Coverage-tier transition for one DP on an election, per the 2026 DP rate
 * sheet's scenario column. Two things about the election's shape decide it:
 * how many covered lives the member has of their OWN (the member plus their
 * own dependents, i.e. everyone who is neither a DP nor a DP's child), and
 * whether any of the DP's children are covered:
 *
 *   own lives 1 (member with no children)
 *     - adds a DP                        → single_to_2party  (Single → Single +1)
 *     - adds a DP AND the DP's children  → single_to_family  (Single → Family)
 *   own lives 2 (member has one child)
 *     - adds a DP, with or without the DP's children
 *                                        → 2party_to_family  (Single +1 → Family)
 *   own lives 3+ (member has two or more children)
 *     - adds a DP, with or without the DP's children
 *                                        → family_to_family_dp (Family → Family,
 *                                          confirmed no charge)
 *
 * The DP's children are told apart from the member's own children by
 * relation type — see isDpChildRelationTypeName. Every DP on the election is
 * excluded from the count (never a counted life).
 *
 * `relationTypeNameOf` resolves a relationship id to its relation-type name;
 * relationships it cannot resolve (undefined) are not countable, while a
 * relation whose type name is unknown (null) counts as the member's own.
 */
export function resolveDpTierTransition(
  election: Pick<WorkerTrustElection, "relationshipIds">,
  relationTypeNameOf: (relationshipId: string) => string | null | undefined,
): BaoDpTierTransition {
  let ownDependents = 0;
  let dpChildren = 0;
  for (const relId of election.relationshipIds ?? []) {
    const name = relationTypeNameOf(relId);
    if (name === undefined) continue; // missing relation row: not countable
    switch (classifyDpRelationTypeName(name)) {
      case "dp":
        break;
      case "dp_child":
        dpChildren++;
        break;
      case "own":
        ownDependents++;
        break;
    }
  }
  const ownLives = 1 + ownDependents; // member + the member's own dependents
  if (ownLives >= 3) return "family_to_family_dp";
  if (ownLives === 2) return "2party_to_family";
  return dpChildren > 0 ? "single_to_family" : "single_to_2party";
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
