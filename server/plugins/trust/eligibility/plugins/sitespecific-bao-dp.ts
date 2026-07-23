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
import type { WorkerTrustElection } from "@shared/schema/trust/elections-schema";

type BaoDpConfig = BaseEligibilityConfig;

function isDpRelationTypeName(name: string | null | undefined): boolean {
  return !!name && name.toLowerCase().includes("domestic partner");
}

/**
 * "BAO - Domestic Partner Payment" grants a DP dependent's benefit only when
 * the month's DP premium charge is fully paid.
 *
 * Scope: this plugin ONLY gates evaluations of a domestic-partner DEPENDENT
 * (a dependent evaluation whose worker_relations type is a
 * "domestic partner" type). It passes through — never blocks — for:
 * - the subscriber's own evaluation (nonpayment must never remove the
 *   subscriber's coverage), and
 * - non-DP dependents (spouse, child, etc.).
 *
 * For a DP dependent, eligible only when ALL of:
 * - the subscriber has an election active in the as-of month that covers
 *   both this benefit and the subscriber→DP relationship, and
 * - the DP charge for that (election, DP relationship, month) exists and is
 *   fully paid on the subscriber's DP ledger account.
 *
 * Strict by design (per the DP business rules):
 * - No DP billing account configured → ineligible (payment state unknown;
 *   a required-but-unverifiable charge never counts as paid).
 * - No charge posted for the month → ineligible (missing charge ≠ paid).
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
      "Grants a domestic-partner dependent's benefit only when the month's DP premium charge exists and is fully paid on the subscriber's DP ledger account. Passes through for the subscriber and non-DP dependents — nonpayment never blocks the subscriber's own coverage.",
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
    if (!isDpRelationTypeName(relWithType?.relationTypeName)) {
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
          m.dpRelationshipId === rel.id &&
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
