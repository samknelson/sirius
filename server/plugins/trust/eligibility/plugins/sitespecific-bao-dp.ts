import { EligibilityPlugin } from "../base";
import {
  EligibilityContext,
  EligibilityResult,
  EligibilityPluginMetadata,
  BaseEligibilityConfig,
} from "../types";
import { registerEligibilityPlugin } from "../registry";
import { storage } from "../../../../storage/database";
import { computeDpPaymentState } from "../../../../modules/sitespecific/bao/dp-payment-state";
import {
  classifyDpRelationTypeName,
  isDpRelationTypeName,
  priceDpMonth,
  resolveDpTierTransition,
} from "../../../../modules/sitespecific/bao/dp-pricing";
import type { WorkerTrustElection } from "@shared/schema/trust/elections-schema";
import { BAO_DP_TIER_TRANSITION_LABELS } from "@shared/schema/sitespecific/bao/schema";

type BaoDpConfig = BaseEligibilityConfig;

/**
 * "BAO - Domestic Partner Payment" grants a DP dependent's benefit only when
 * the month's DP member charge is fully paid — or the month is a CONFIRMED
 * no-charge month on the DP rate sheet (e.g. the 2026 family → family with
 * DP scenarios), in which case no payment is required.
 *
 * Scope: this plugin ONLY gates evaluations of a domestic-partner DEPENDENT
 * (a dependent evaluation whose worker_relations type is a
 * "domestic partner" type). It passes through — never blocks — for:
 * - the subscriber's own evaluation (nonpayment must never remove the
 *   subscriber's coverage), and
 * - non-DP dependents (spouse, child, etc.) — including the DP's own
 *   children (Step Child relations), even though they only raise the tier
 *   the DP is priced at. NOTE (unconfirmed business rule): whether the DP's
 *   children should ALSO be gated on the DP charge being paid has not been
 *   confirmed; until it is, only the DP is.
 *
 * For a DP dependent, eligible only when ALL of:
 * - the subscriber has an election active in the as-of month that covers
 *   both this benefit and the subscriber→DP relationship, and
 * - EITHER the DP charge for that (election, DP relationship, month) exists
 *   and is fully paid on the subscriber's DP ledger account, OR the month
 *   prices to a confirmed no-charge rate under the SAME shared pricing rule
 *   the charge plugin bills with (modules/sitespecific/bao/dp-pricing.ts).
 *
 * The confirmed no-charge check runs FIRST: such a month needs no charge,
 * no account and no payment. Everything else is strict by design (per the
 * DP business rules):
 * - No DP billing account configured → ineligible (payment state unknown;
 *   a required-but-unverifiable charge never counts as paid).
 * - No charge posted for the month (rate missing, provisional, ambiguous,
 *   or positive-but-unbilled) → ineligible (missing charge ≠ paid; a
 *   placeholder is never "free").
 * - Partially paid → ineligible. No grace period until the business
 *   confirms one.
 *
 * A payment alone never grants coverage: this rule ANDs with every other
 * configured rule (election coverage, subscriber coverage, etc.).
 */
class BaoDpPlugin extends EligibilityPlugin<BaoDpConfig> {
  readonly metadata: EligibilityPluginMetadata = {
    id: "sitespecific-bao-dp",
    name: "BAO - Domestic Partner Payment",
    description:
      "Grants a domestic-partner dependent's benefit only when the month's DP member charge exists and is fully paid on the subscriber's DP ledger account, or the month is a confirmed no-charge month on the DP rate sheet (no payment required). Missing or provisional rates never count as free. Passes through for the subscriber and non-DP dependents — nonpayment never blocks the subscriber's own coverage.",
    requiredComponent: "sitespecific.bao",
    configSchema: {
      type: "object",
      properties: {},
    },
  };

  async evaluate(
    context: EligibilityContext,
    _config: BaoDpConfig,
  ): Promise<EligibilityResult> {
    if (!context.benefitId) {
      return {
        eligible: false,
        reason: "DP payment plugin requires benefitId in context",
      };
    }

    // Subscriber (or self) evaluation: this rule never gates the
    // subscriber's own coverage.
    if (
      !context.relationship ||
      context.dependentWorker.id === context.subscriberWorker.id
    ) {
      return {
        eligible: true,
        reason:
          "DP payment gate applies only to domestic-partner dependents; subscriber coverage is not payment-gated",
      };
    }

    const subscriberId = context.subscriberWorker.id;
    const dependentId = context.dependentWorker.id;
    const asOfDate = new Date(context.asOfYear, context.asOfMonth, 0);
    const asOfYm = `${context.asOfYear}-${String(context.asOfMonth).padStart(2, "0")}`;
    const monthLabel = `${new Date(
      context.asOfYear,
      context.asOfMonth - 1,
      1,
    ).toLocaleString("default", { month: "long" })} ${context.asOfYear}`;

    // Resolve the active relation row (the executor has already validated it
    // exists; we need its id and relation-type name).
    const rel = await storage.workerRelations.findActiveBetween(
      subscriberId,
      dependentId,
      asOfDate,
    );
    if (!rel) {
      return {
        eligible: false,
        reason: `No active relationship from subscriber to dependent as of ${monthLabel}`,
      };
    }

    const [relWithType] = await storage.workerRelations.listByIdsWithType([
      rel.id,
    ]);
    const relationKind = classifyDpRelationTypeName(relWithType?.relationTypeName);
    if (relationKind === "own") {
      return {
        eligible: true,
        reason: `DP payment gate applies only to domestic-partner dependents (relationship is ${relWithType?.relationTypeName ?? "unknown"})`,
      };
    }

    const dependentLabel = this.dependentLabel(context, dependentId);

    // Elections active in the as-of month that cover BOTH this benefit and
    // this DP relationship.
    const elections = await storage.workerTrustElections.listByWorker(
      subscriberId,
    );
    const covering = elections.filter(
      (e: WorkerTrustElection) =>
        (e.relationshipIds ?? []).includes(rel.id) &&
        (e.benefitIds ?? []).includes(context.benefitId!) &&
        e.startYmd.slice(0, 7) <= asOfYm &&
        (!e.endYmd || e.endYmd.slice(0, 7) >= asOfYm),
    );
    if (covering.length === 0) {
      return {
        eligible: false,
        reason: `No active election covers this benefit for domestic partner ${dependentLabel} in ${monthLabel}`,
      };
    }

    // A DP Child is gated by the same DP charge as its partner. Elections
    // store subscriber-rooted relation ids, so resolve the DP relation from
    // the election rather than treating the child's relation as the charge
    // target.
    const coveringRelationIds = Array.from(
      new Set(covering.flatMap((e) => e.relationshipIds ?? [])),
    );
    const coveringRelations = await storage.workerRelations.listByIdsWithType(
      coveringRelationIds,
    );
    const dpRelationIdByElection = new Map<string, string>();
    for (const election of covering) {
      const dpRelation = coveringRelations.find(
        (candidate) =>
          (election.relationshipIds ?? []).includes(candidate.id) &&
          isDpRelationTypeName(candidate.relationTypeName),
      );
      if (dpRelation) dpRelationIdByElection.set(election.id, dpRelation.id);
    }

    // A CONFIRMED no-charge month (rate sheet says $0.00, not provisional,
    // under the same shared pricing rule the biller uses) is covered without
    // any payment — decided BEFORE the billing-account/charge checks, since
    // no charge should exist for it and a missing account must not deny it.
    // Anything else (missing, provisional, ambiguous, or a positive rate)
    // falls through to the strict payment gate.
    const noCharge = await this.findConfirmedNoChargeElection(
      subscriberId,
      covering,
      asOfYm,
    );
    if (noCharge) {
      return {
        eligible: true,
        reason: `DP coverage for ${monthLabel} is a confirmed no-charge month (${noCharge.transitionLabel}) for domestic partner ${dependentLabel} — no payment is required`,
      };
    }

    const paymentState = await computeDpPaymentState(subscriberId);
    if (!paymentState) {
      return {
        eligible: false,
        reason:
          "No DP billing account is configured, so the required DP charge cannot be verified as paid",
      };
    }

    // Pass when ANY covering election's (DP, month) charge is fully paid.
    let sawCharge = false;
    let unpaidDetail: string | null = null;
    for (const election of covering) {
      const row = paymentState.months.find(
        (m) =>
          m.electionId === election.id &&
          m.dpRelationshipId ===
            (relationKind === "dp_child"
              ? dpRelationIdByElection.get(election.id)
              : rel.id) &&
          m.month === asOfYm,
      );
      if (!row) continue;
      sawCharge = true;
      if (row.status === "paid") {
        return {
          eligible: true,
          reason: `DP charge for ${monthLabel} is fully paid ($${row.paidAmount} of $${row.netCharge}) for domestic partner ${dependentLabel}`,
        };
      }
      unpaidDetail = `$${row.paidAmount} paid of $${row.netCharge} charged`;
    }

    if (!sawCharge) {
      // No charge posted and not a confirmed no-charge month: a missing
      // required charge never counts as paid (a placeholder is never free).
      return {
        eligible: false,
        reason: `No DP charge has been posted for ${monthLabel} for domestic partner ${dependentLabel} — a missing required charge does not count as paid`,
      };
    }
    return {
      eligible: false,
      reason: `DP charge for ${monthLabel} is not fully paid (${unpaidDetail}) for domestic partner ${dependentLabel}`,
    };
  }

  /**
   * The first covering election whose month prices to a confirmed no-charge
   * rate under the shared DP pricing rule (tier from the member's own
   * covered lives and whether the DP's children are covered, single rated
   * benefit, non-provisional $0.00). Null when no covering election does —
   * including when the rate is missing, provisional, ambiguous, or positive.
   */
  private async findConfirmedNoChargeElection(
    subscriberId: string,
    covering: WorkerTrustElection[],
    asOfYm: string,
  ): Promise<{ election: WorkerTrustElection; transitionLabel: string } | null> {
    // Price from the election benefits the SUBSCRIBER actually has recorded
    // for the month (trust WMB presence) — exactly the set the charge plugin
    // prices from — so the gate can never waive a month billing would have
    // skipped as missing-rate.
    const presenceRows = await storage.trust.wmb.getWorkerBenefitPresence(subscriberId);
    const present = new Set<string>();
    for (const row of presenceRows) {
      const ym = `${row.year}-${String(row.month).padStart(2, "0")}`;
      if (ym === asOfYm) present.add(row.benefitId);
    }

    const relIds = new Set<string>();
    for (const e of covering) for (const id of e.relationshipIds ?? []) relIds.add(id);
    const rels = relIds.size
      ? await storage.workerRelations.listByIdsWithType(Array.from(relIds))
      : [];
    const typeNameById = new Map(rels.map((r) => [r.id, r.relationTypeName ?? null]));

    for (const election of covering) {
      const transition = resolveDpTierTransition(election, (id) =>
        typeNameById.has(id) ? typeNameById.get(id) : undefined,
      );
      const presentBenefitIds = (election.benefitIds ?? []).filter((b) =>
        present.has(b),
      );
      if (presentBenefitIds.length === 0) continue;
      const price = await priceDpMonth(presentBenefitIds, transition, asOfYm);
      if (price.kind === "no_charge") {
        return {
          election,
          transitionLabel: BAO_DP_TIER_TRANSITION_LABELS[transition],
        };
      }
    }
    return null;
  }

  private dependentLabel(
    context: EligibilityContext,
    dependentId: string,
  ): string {
    const contact = context.dependentContact;
    const fullName = contact
      ? [contact.given, contact.family].filter(Boolean).join(" ").trim()
      : "";
    return fullName || contact?.displayName || dependentId;
  }
}

const plugin = new BaoDpPlugin();
registerEligibilityPlugin(plugin);

export { BaoDpPlugin };
