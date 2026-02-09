import { logger } from "../../logger";
import { dispatchEligPluginRegistry } from "../dispatch-elig-plugin-registry";
import { dispatchBanPlugin, backfillDispatchBanEligibility } from "./ban";
import { dispatchDncPlugin } from "./dnc";
import { dispatchEbaPlugin, backfillDispatchEbaEligibility } from "./eba";
import { dispatchHfePlugin } from "./hfe";
import { dispatchSkillPlugin, backfillDispatchSkillEligibility } from "./skill";
import { dispatchStatusPlugin } from "./status";
import { dispatchWsPlugin, backfillDispatchWsEligibility } from "./ws";

/**
 * Registers all dispatch eligibility plugins.
 * Each plugin declares its own event handlers, which are automatically
 * subscribed by the registry during registration.
 */
export function registerDispatchEligPlugins(): void {
  dispatchEligPluginRegistry.register(dispatchBanPlugin);
  dispatchEligPluginRegistry.register(dispatchDncPlugin);
  dispatchEligPluginRegistry.register(dispatchEbaPlugin);
  dispatchEligPluginRegistry.register(dispatchHfePlugin);
  dispatchEligPluginRegistry.register(dispatchSkillPlugin);
  dispatchEligPluginRegistry.register(dispatchStatusPlugin);
  dispatchEligPluginRegistry.register(dispatchWsPlugin);
  
  logger.info("Dispatch eligibility plugins registered", {
    service: "dispatch-elig-plugins",
    plugins: dispatchEligPluginRegistry.getAllPluginIds(),
  });
}

/**
 * Initializes the dispatch eligibility system.
 * Plugins register themselves and their event handlers automatically.
 * Also backfills eligibility data for existing records.
 */
export async function initializeDispatchEligSystem(): Promise<void> {
  registerDispatchEligPlugins();
  
  // Backfill eligibility data for existing active dispatch bans
  // This ensures pre-existing bans are accounted for in eligibility checks
  try {
    const result = await backfillDispatchBanEligibility();
    if (result.workersProcessed > 0) {
      logger.info("Ban eligibility backfill completed during startup", {
        service: "dispatch-elig-plugins",
        workersProcessed: result.workersProcessed,
        entriesCreated: result.entriesCreated,
      });
    }
  } catch (error) {
    logger.error("Failed to backfill ban eligibility during startup", {
      service: "dispatch-elig-plugins",
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // Backfill eligibility data for existing worker skills
  // This ensures pre-existing skills are accounted for in eligibility checks
  try {
    const result = await backfillDispatchSkillEligibility();
    if (result.workersProcessed > 0) {
      logger.info("Skill eligibility backfill completed during startup", {
        service: "dispatch-elig-plugins",
        workersProcessed: result.workersProcessed,
        entriesCreated: result.entriesCreated,
      });
    }
  } catch (error) {
    logger.error("Failed to backfill skill eligibility during startup", {
      service: "dispatch-elig-plugins",
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // Backfill eligibility data for existing worker work statuses
  // This ensures pre-existing work statuses are accounted for in eligibility checks
  try {
    const result = await backfillDispatchWsEligibility();
    if (result.workersProcessed > 0) {
      logger.info("Work status eligibility backfill completed during startup", {
        service: "dispatch-elig-plugins",
        workersProcessed: result.workersProcessed,
        entriesCreated: result.entriesCreated,
      });
    }
  } catch (error) {
    logger.error("Failed to backfill work status eligibility during startup", {
      service: "dispatch-elig-plugins",
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // Backfill eligibility data for existing EBA (Employed but Available) entries
  try {
    const result = await backfillDispatchEbaEligibility();
    if (result.workersProcessed > 0) {
      logger.info("EBA eligibility backfill completed during startup", {
        service: "dispatch-elig-plugins",
        workersProcessed: result.workersProcessed,
        entriesCreated: result.entriesCreated,
      });
    }
  } catch (error) {
    logger.error("Failed to backfill EBA eligibility during startup", {
      service: "dispatch-elig-plugins",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
