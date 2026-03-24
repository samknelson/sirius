import { logger } from "../../logger";
import { dispatchEligPluginRegistry } from "../dispatch-elig-plugin-registry";
import { dispatchBanPlugin } from "./ban";
import { dispatchDncPlugin } from "./dnc";
import { dispatchEbaPlugin } from "./eba";
import { dispatchHfePlugin } from "./hfe";
import { dispatchSkillPlugin } from "./skill";
import { dispatchStatusPlugin } from "./status";
import { dispatchWsPlugin } from "./ws";
import { dispatchSingleshiftPlugin } from "./singleshift";
import { dispatchAcceptedPlugin } from "./accepted";
import { dispatchHtaHomeEmployerPlugin } from "./hta-home-employer";

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

export async function initializeDispatchEligSystem(): Promise<void> {
  registerDispatchEligPlugins();

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
