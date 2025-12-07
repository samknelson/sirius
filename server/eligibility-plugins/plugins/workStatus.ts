import { EligibilityPlugin } from "../base";
import { 
  EligibilityContext, 
  EligibilityResult, 
  EligibilityPluginMetadata,
  baseEligibilityConfigSchema,
} from "../types";
import { registerEligibilityPlugin } from "../registry";
import { z } from "zod";

const workStatusConfigSchema = baseEligibilityConfigSchema.extend({
  allowedStatusIds: z.array(z.string().uuid()).min(1, "At least one allowed status is required"),
});

type WorkStatusConfig = z.infer<typeof workStatusConfigSchema>;

class WorkStatusPlugin extends EligibilityPlugin<WorkStatusConfig> {
  readonly metadata: EligibilityPluginMetadata = {
    id: "work-status",
    name: "Work Status",
    description: "Worker must have one of the specified work statuses to be eligible.",
    configSchema: workStatusConfigSchema,
  };

  async evaluate(
    context: EligibilityContext,
    config: WorkStatusConfig
  ): Promise<EligibilityResult> {
    const worker = await context.getWorker();
    
    if (!worker.denormWsId) {
      return { 
        eligible: false, 
        reason: "Worker has no work status assigned" 
      };
    }

    const isAllowed = config.allowedStatusIds.includes(worker.denormWsId);
    
    if (isAllowed) {
      return { eligible: true };
    }

    return { 
      eligible: false, 
      reason: `Worker's current work status is not in the allowed list` 
    };
  }
}

const plugin = new WorkStatusPlugin();
registerEligibilityPlugin(plugin);

export { WorkStatusPlugin };
