import { EligibilityPlugin } from "../base";
import {
  EligibilityContext,
  EligibilityResult,
  EligibilityPluginMetadata,
  baseEligibilityConfigSchema,
} from "../types";
import { registerEligibilityPlugin } from "../registry";
import { z } from "zod";

const alwaysConfigSchema = baseEligibilityConfigSchema.extend({
  mode: z.enum(["allow", "deny"]),
});

type AlwaysConfig = z.infer<typeof alwaysConfigSchema>;

class AlwaysPlugin extends EligibilityPlugin<AlwaysConfig> {
  readonly metadata: EligibilityPluginMetadata = {
    id: "always",
    name: "Always",
    description: "Testing plugin: always returns eligible when mode=allow, always returns ineligible when mode=deny.",
    configSchema: alwaysConfigSchema,
    configFields: [
      {
        name: "mode",
        label: "Mode",
        inputType: "select-options",
        required: true,
        helperText: "Allow: every worker is eligible. Deny: no worker is eligible.",
        options: [
          { value: "allow", label: "Allow (always eligible)" },
          { value: "deny", label: "Deny (never eligible)" },
        ],
      },
    ],
    defaultConfig: {
      appliesTo: ["start", "continue"],
      mode: "deny",
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
