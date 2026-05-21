import { EligibilityPlugin } from "../base";
import {
  EligibilityContext,
  EligibilityResult,
  EligibilityPluginMetadata,
  BaseEligibilityConfig,
} from "../types";
import { registerEligibilityPlugin } from "../registry";

interface AlwaysConfig extends BaseEligibilityConfig {
  mode: "allow" | "deny";
}

class AlwaysPlugin extends EligibilityPlugin<AlwaysConfig> {
  readonly metadata: EligibilityPluginMetadata = {
    id: "always",
    name: "Always",
    description:
      "Testing plugin: always returns eligible when mode=allow, always returns ineligible when mode=deny.",
    configSchema: {
      type: "object",
      required: ["mode"],
      properties: {
        mode: {
          type: "string",
          title: "Mode",
          description: "Allow: every worker is eligible. Deny: no worker is eligible.",
          enum: ["allow", "deny"],
          enumNames: ["Allow (always eligible)", "Deny (never eligible)"],
          default: "deny",
        },
      },
    },
  };

  async evaluate(
    _context: EligibilityContext,
    config: AlwaysConfig
  ): Promise<EligibilityResult> {
    if (config.mode === "allow") {
      return { eligible: true, reason: "Always eligible (mode=allow)" };
    }
    return { eligible: false, reason: "Always ineligible (mode=deny)" };
  }
}

const plugin = new AlwaysPlugin();
registerEligibilityPlugin(plugin);

export { AlwaysPlugin };
