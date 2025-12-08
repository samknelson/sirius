import { EligibilityPlugin } from "../base";
import { 
  EligibilityContext, 
  EligibilityResult, 
  EligibilityPluginMetadata,
  baseEligibilityConfigSchema,
} from "../types";
import { registerEligibilityPlugin } from "../registry";
import { storage } from "../../storage/database";
import { z } from "zod";

const manualConfigSchema = baseEligibilityConfigSchema;

type ManualConfig = z.infer<typeof manualConfigSchema>;

class ManualPlugin extends EligibilityPlugin<ManualConfig> {
  readonly metadata: EligibilityPluginMetadata = {
    id: "manual",
    name: "Manual",
    description: "Returns eligible if the WMB record already exists, ineligible if it doesn't. Use this to mark benefits as manually managed - the scan won't create or delete them.",
    configSchema: manualConfigSchema,
  };

  async evaluate(
    context: EligibilityContext,
    config: ManualConfig
  ): Promise<EligibilityResult> {
    const monthName = new Date(context.asOfYear, context.asOfMonth - 1, 1).toLocaleString('default', { month: 'long' });
    
    if (!context.benefitId) {
      return { 
        eligible: false, 
        reason: `Manual plugin requires benefitId in context` 
      };
    }

    const exists = await storage.workers.workerBenefitExists(
      context.workerId,
      context.benefitId,
      context.asOfMonth,
      context.asOfYear
    );
    
    if (exists) {
      return { 
        eligible: true,
        reason: `Benefit record exists for ${monthName} ${context.asOfYear} (manually managed)`
      };
    }

    return { 
      eligible: false, 
      reason: `No benefit record for ${monthName} ${context.asOfYear} (manually managed - must be created externally)` 
    };
  }
}

const plugin = new ManualPlugin();
registerEligibilityPlugin(plugin);

export { ManualPlugin };
