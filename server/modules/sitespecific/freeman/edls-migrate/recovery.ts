import { eventBus, EventType } from "../../../../services/event-bus";
import { logger } from "../../../../logger";
import { recoverFreemanMigrate } from "./import";

let initialized = false;

/** Called only by the user-API role, after normal application initialization. */
export async function initializeFreemanMigrateRecovery(): Promise<void> {
  if (initialized) return;
  initialized = true;
  const check = async () => {
    try {
      await recoverFreemanMigrate();
    } catch {
      // A temporarily unavailable DB must not block startup. Durable intent
      // remains unchanged, and the next existing tick tries eligibility again.
      logger.warn("Freeman migration recovery check could not complete", { service: "freeman-edls-migrate" });
    }
  };
  eventBus.on({
    name: "freeman-edls-migrate-recovery",
    description: "Resumes an explicitly requested Freeman background import after interruption; respects stops, current authorization, components, maintenance, and the execution lock.",
    event: EventType.CRON_TICK_10M,
    handler: check,
  });
  await check();
}
