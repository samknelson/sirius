import { EligibilityPlugin } from "../base";
import {
  EligibilityContext,
  EligibilityResult,
  EligibilityPluginMetadata,
  BaseEligibilityConfig,
} from "../types";
import { registerEligibilityPlugin } from "../registry";

type BaoStartHealthnetConfig = BaseEligibilityConfig;

class BaoStartHealthnetPlugin extends EligibilityPlugin<BaoStartHealthnetConfig> {
  readonly metadata: EligibilityPluginMetadata = {
    id: "sitespecific-bao-start-healthnet",
    name: "BAO - Start Healthnet",
    description:
      "Stub plugin (not yet implemented). Eventually a subscriber will be required to meet one of the following four criteria:\n" +
      "1. Meet the specified geographic requirements (within X miles of one of two sites)\n" +
      "2. Have EVER had HealthNet coverage\n" +
      "3. Have had ANY medical benefit without break for the specified number of months\n" +
      "4. The employer is in an immediate eligibility period",
    requiredComponent: "sitespecific.bao",
    configSchema: {
      type: "object",
      properties: {},
    },
  };

  async evaluate(
    _context: EligibilityContext,
    _config: BaoStartHealthnetConfig
  ): Promise<EligibilityResult> {
    return {
      eligible: false,
      reason: "BAO - Start Healthnet is not yet implemented.",
    };
  }
}

const plugin = new BaoStartHealthnetPlugin();
registerEligibilityPlugin(plugin);

export { BaoStartHealthnetPlugin };
