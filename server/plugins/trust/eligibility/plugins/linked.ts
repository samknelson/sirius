import { EligibilityPlugin } from "../base";
import {
  EligibilityContext,
  EligibilityResult,
  EligibilityPluginMetadata,
  BaseEligibilityConfig,
} from "../types";
import { registerEligibilityPlugin } from "../registry";
import { storage } from "../../../../storage/database";

interface LinkedConfig extends BaseEligibilityConfig {
  benefitIds: string[];
}

class LinkedPlugin extends EligibilityPlugin<LinkedConfig> {
  readonly metadata: EligibilityPluginMetadata = {
    id: "linked",
    name: "Linked benefits",
    description:
      "Eligible if the dependent has any of the selected benefits in the as-of month.",
    configSchema: {
      type: "object",
      required: ["benefitIds"],
      properties: {
        benefitIds: {
          type: "array",
          title: "Linked benefits",
          description:
            "Dependent must have at least one of these benefits in the as-of month.",
          minItems: 1,
          items: {
            type: "string",
          },
          "x-options-resource": "trust-benefit",
        },
      },
    },
  };

  async validateConfig(config: unknown): Promise<{ valid: boolean; errors?: string[] }> {
    const base = await super.validateConfig(config);
    if (!base.valid) return base;
    const c = (config ?? {}) as LinkedConfig;
    if (!Array.isArray(c.benefitIds) || c.benefitIds.length === 0) {
      return { valid: false, errors: ["benefitIds must contain at least one benefit"] };
    }
    for (const id of c.benefitIds) {
      if (typeof id !== "string" || id.length === 0) {
        return { valid: false, errors: ["benefitIds entries must be non-empty strings"] };
      }
      const benefit = await storage.trustBenefits.getTrustBenefit(id);
      if (!benefit) {
        return { valid: false, errors: [`Unknown trust benefit: ${id}`] };
      }
    }
    return { valid: true };
  }

  async evaluate(
    context: EligibilityContext,
    config: LinkedConfig,
  ): Promise<EligibilityResult> {
    const monthName = new Date(context.asOfYear, context.asOfMonth - 1, 1).toLocaleString(
      "default",
      { month: "long" },
    );
    const subject = context.relationship ? "Dependent" : "Worker";

    if (!Array.isArray(config.benefitIds) || config.benefitIds.length === 0) {
      return {
        eligible: false,
        reason: "Linked plugin requires at least one benefit to be configured",
      };
    }

    const checkedNames: string[] = [];
    for (const benefitId of config.benefitIds) {
      const benefit = await storage.trustBenefits.getTrustBenefit(benefitId);
      if (!benefit) {
        checkedNames.push(`(unknown ${benefitId})`);
        continue;
      }
      checkedNames.push(benefit.name);
      const exists = await storage.trust.wmb.workerBenefitExists(
        context.dependentWorker.id,
        benefitId,
        context.asOfMonth,
        context.asOfYear,
      );
      if (exists) {
        return {
          eligible: true,
          reason: `${subject} has linked benefit "${benefit.name}" in ${monthName} ${context.asOfYear}`,
        };
      }
    }

    return {
      eligible: false,
      reason: `${subject} has none of the linked benefits in ${monthName} ${context.asOfYear} (checked: ${checkedNames.join(", ")})`,
    };
  }
}

const plugin = new LinkedPlugin();
registerEligibilityPlugin(plugin);

export { LinkedPlugin };
