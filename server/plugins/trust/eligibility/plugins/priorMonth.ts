import { EligibilityPlugin } from "../base";
import {
  EligibilityContext,
  EligibilityResult,
  EligibilityPluginMetadata,
  BaseEligibilityConfig,
} from "../types";
import { registerEligibilityPlugin } from "../registry";
import { storage } from "../../../../storage/database";

type PriorMonthConfig = BaseEligibilityConfig;

class PriorMonthPlugin extends EligibilityPlugin<PriorMonthConfig> {
  readonly metadata: EligibilityPluginMetadata = {
    id: "priorMonth",
    name: "Prior month",
    description:
      "Eligible if the dependent had this same benefit in the immediately preceding month.",
    configSchema: {
      type: "object",
      properties: {},
    },
  };

  async evaluate(
    context: EligibilityContext,
    _config: PriorMonthConfig,
  ): Promise<EligibilityResult> {
    if (!context.benefitId) {
      return {
        eligible: false,
        reason: `Prior month plugin requires benefitId in context`,
      };
    }

    const priorMonth = context.asOfMonth === 1 ? 12 : context.asOfMonth - 1;
    const priorYear = context.asOfMonth === 1 ? context.asOfYear - 1 : context.asOfYear;
    const priorMonthName = new Date(priorYear, priorMonth - 1, 1).toLocaleString(
      "default",
      { month: "long" },
    );
    const subject = context.relationship ? "Dependent" : "Worker";

    const exists = await storage.trust.wmb.workerBenefitExists(
      context.dependentWorker.id,
      context.benefitId,
      priorMonth,
      priorYear,
    );

    if (exists) {
      return {
        eligible: true,
        reason: `${subject} had this benefit in ${priorMonthName} ${priorYear}`,
      };
    }
    return {
      eligible: false,
      reason: `${subject} had no benefit record for ${priorMonthName} ${priorYear}`,
    };
  }
}

const plugin = new PriorMonthPlugin();
registerEligibilityPlugin(plugin);

export { PriorMonthPlugin };
