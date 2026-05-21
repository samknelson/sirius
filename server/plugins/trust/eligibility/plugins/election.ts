import { EligibilityPlugin } from "../base";
import {
  EligibilityContext,
  EligibilityResult,
  EligibilityPluginMetadata,
  BaseEligibilityConfig,
} from "../types";
import { registerEligibilityPlugin } from "../registry";
import { storage } from "../../../../storage/database";

type ElectionConfig = BaseEligibilityConfig;

class ElectionPlugin extends EligibilityPlugin<ElectionConfig> {
  readonly metadata: EligibilityPluginMetadata = {
    id: "election",
    name: "Election",
    description:
      "Eligible when the subscriber's active trust election covers this benefit (and, for dependents, includes the subscriber→dependent relationship).",
    requiresComponent: "trust.elections",
    configSchema: {
      type: "object",
      properties: {},
    },
  };

  async evaluate(
    context: EligibilityContext,
    _config: ElectionConfig,
  ): Promise<EligibilityResult> {
    if (!context.benefitId) {
      return {
        eligible: false,
        reason: "Election plugin requires benefitId in context",
      };
    }

    const subscriberId = context.subscriberWorker.id;
    const asOfDate = new Date(context.asOfYear, context.asOfMonth, 0);
    const yr = asOfDate.getFullYear();
    const mo = String(asOfDate.getMonth() + 1).padStart(2, "0");
    const dy = String(asOfDate.getDate()).padStart(2, "0");
    const asOfYmd = `${yr}-${mo}-${dy}`;
    const monthName = new Date(context.asOfYear, context.asOfMonth - 1, 1).toLocaleString(
      "default",
      { month: "long" },
    );
    const election = await storage.workerTrustElections.getActiveByWorkerAsOf(
      subscriberId,
      asOfYmd,
    );
    if (!election) {
      return {
        eligible: false,
        reason: `Subscriber has no active trust election as of ${monthName} ${context.asOfYear}`,
      };
    }

    const benefitIds = election.benefitIds ?? [];
    if (!benefitIds.includes(context.benefitId)) {
      const benefit = await storage.trustBenefits.getTrustBenefit(context.benefitId);
      const benefitLabel = benefit?.name ?? context.benefitId;
      return {
        eligible: false,
        reason: `Active election does not cover benefit "${benefitLabel}"`,
      };
    }

    const isDependentEval =
      !!context.relationship &&
      context.dependentWorker.id !== subscriberId;

    if (isDependentEval) {
      const dependentId = context.dependentWorker.id;
      const relationshipIds = election.relationshipIds ?? [];
      let covered = false;
      for (const relId of relationshipIds) {
        const rel = await storage.workerRelations.get(relId);
        if (!rel) continue;
        const pair = new Set([rel.worker1, rel.worker2]);
        if (pair.has(subscriberId) && pair.has(dependentId)) {
          covered = true;
          break;
        }
      }
      const contact = context.dependentContact;
      const fullName = contact
        ? [contact.given, contact.family].filter(Boolean).join(" ").trim()
        : "";
      const dependentLabel =
        fullName || contact?.displayName || dependentId;
      if (!covered) {
        return {
          eligible: false,
          reason: `Active election does not cover dependent ${dependentLabel}`,
        };
      }
      return {
        eligible: true,
        reason: `Active election covers benefit and dependent ${dependentLabel}`,
      };
    }

    return {
      eligible: true,
      reason: "Active election covers this benefit for the subscriber",
    };
  }
}

const plugin = new ElectionPlugin();
registerEligibilityPlugin(plugin);

export { ElectionPlugin };
