import { logger } from "../../../logger";
import { registerPluginKind } from "../../_core";
import { dispatchEligPluginRegistry } from "./registry";
import { dispatchBanPlugin } from "./plugins/ban";
import { dispatchDncPlugin } from "./plugins/dnc";
import { dispatchEbaPlugin } from "./plugins/eba";
import { dispatchHfePlugin } from "./plugins/hfe";
import { dispatchSkillPlugin } from "./plugins/skill";
import { dispatchStatusPlugin } from "./plugins/status";
import { dispatchWsPlugin } from "./plugins/ws";
import { dispatchSingleshiftPlugin } from "./plugins/singleshift";
import { dispatchAcceptedPlugin } from "./plugins/accepted";
import { dispatchHtaHomeEmployerPlugin } from "./plugins/hta-home-employer";

export function registerDispatchEligPlugins(): void {
  dispatchEligPluginRegistry.register(dispatchBanPlugin);
  dispatchEligPluginRegistry.register(dispatchDncPlugin);
  dispatchEligPluginRegistry.register(dispatchEbaPlugin);
  dispatchEligPluginRegistry.register(dispatchHfePlugin);
  dispatchEligPluginRegistry.register(dispatchSkillPlugin);
  dispatchEligPluginRegistry.register(dispatchStatusPlugin);
  dispatchEligPluginRegistry.register(dispatchWsPlugin);
  dispatchEligPluginRegistry.register(dispatchSingleshiftPlugin);
  dispatchEligPluginRegistry.register(dispatchAcceptedPlugin);
  dispatchEligPluginRegistry.register(dispatchHtaHomeEmployerPlugin);
  logger.info("Dispatch eligibility plugins registered", {
    service: "dispatch-elig-plugins",
    plugins: dispatchEligPluginRegistry.getAllPluginIds(),
  });
}

let kindRegistered = false;
function registerDispatchEligKind(): void {
  if (kindRegistered) return;
  registerPluginKind({
    kind: "dispatch-eligibility",
    registry: dispatchEligPluginRegistry,
    // Mirror legacy auth on /api/dispatch-eligibility-plugins:
    // requireComponent("dispatch") + requireAccess("admin").
    requiredComponent: "dispatch",
    requiredPolicy: "admin",
    sortEntries: (a, b) => a.id.localeCompare(b.id),
    // Backs POST /api/plugins/dispatch-eligibility/:id/validate-config.
    // Validates the supplied config against the plugin's JSON Schema.
    validateConfig: async (plugin, config) => {
      if (!plugin.configSchema) return { valid: true };
      const { validateAgainstSchema } = await import("../../../lib/json-schema-validator");
      const result = validateAgainstSchema(plugin.configSchema, config);
      if (result.valid) return { valid: true };
      return { valid: false, errors: result.errors ?? ["Invalid configuration"] };
    },
  });
  kindRegistered = true;
}

export async function initializeDispatchEligSystem(): Promise<void> {
  registerDispatchEligPlugins();
  registerDispatchEligKind();

  const plugins = dispatchEligPluginRegistry.getAllPlugins()
    .filter(p => p.backfill)
    .sort((a, b) => (a.backfillOrder ?? 0) - (b.backfillOrder ?? 0));

  for (const plugin of plugins) {
    try {
      const result = await plugin.backfill!();
      if (result.workersProcessed > 0) {
        logger.info(`${plugin.name} eligibility backfill completed during startup`, {
          service: "dispatch-elig-plugins",
          pluginId: plugin.id,
          workersProcessed: result.workersProcessed,
          entriesCreated: result.entriesCreated,
        });
      }
    } catch (error) {
      logger.error(`Failed to backfill ${plugin.name} eligibility during startup`, {
        service: "dispatch-elig-plugins",
        pluginId: plugin.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
