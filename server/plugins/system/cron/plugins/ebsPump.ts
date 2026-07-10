import { logger } from "../../../../logger";
import { isPluginComponentEnabledSync } from "../../../_core";
import { denormPluginRegistry } from "../../denorm";
import { storage } from "../../../../storage";
import {
  eventBus,
  EventType,
  type EventPayloadMap,
} from "../../../../services/event-bus";
import { registerCronPlugin } from "../registry";
import type { CronJobContext, CronJobResult } from "../types";

/** Max scheduled events drained per run (each half). */
const BATCH_LIMIT = 1000;
/** Days an `ebs_status` record is retained before the purge sweeps it. */
const RETENTION_DAYS = 90;

/**
 * Resolve whether the component that owns a scheduled event's source denorm
 * plugin is currently enabled. A due event whose source component has since been
 * disabled is left untouched (neither fired nor marked terminal) so it resumes
 * cleanly if the component is re-enabled while still inside its window.
 */
function sourceComponentEnabled(pluginId: string): boolean {
  const plugin = denormPluginRegistry.get(pluginId);
  if (!plugin) return false;
  return isPluginComponentEnabledSync(plugin.metadata);
}

/**
 * `ebs_pump` cron — the generic firing engine of the deferred event bus (EBS).
 *
 * Every run it drains three queues off `storage.ebs`:
 *   1. Due events (`send_on <= now <= dont_send_after`, no terminal status):
 *      re-emitted on the real event bus via `emitWithFailures`. A scheduled
 *      event is marked `sent` ONLY when every handler ran cleanly; any handler
 *      failure leaves it unmarked so it retries next run (still inside its
 *      window). Events whose source component has been disabled are skipped.
 *   2. Expired events (`dont_send_after < now`, no terminal status): recorded
 *      `expired` (logged once) rather than delivered, so a long-down window or a
 *      retroactively-scheduled past reminder never blasts a stale notice.
 *   3. Retention purge: `ebs_status` rows older than {@link RETENTION_DAYS} are
 *      deleted (their `ebs_denorm`/`denorm` rows are long gone by then).
 *
 * Core singleton, enabled by default. In `test` mode it only counts what it
 * would do and writes nothing.
 */
registerCronPlugin({
  metadata: {
    id: "ebs_pump",
    name: "Scheduled Event Bus Pump",
    description:
      "Fires deferred (scheduled) event-bus events whose send time has arrived, expires those whose window lapsed, and purges old delivery records.",
    singleton: true,
  },
  defaultSchedule: "0 * * * *", // Hourly, on the hour
  defaultEnabled: true,

  async execute(context: CronJobContext): Promise<CronJobResult> {
    const now = new Date();

    if (context.mode === "test") {
      const due = await storage.ebs.getDue(BATCH_LIMIT, now);
      const expired = await storage.ebs.getExpiredUnfired(BATCH_LIMIT, now);
      return {
        message: `Would fire ${due.length} due event(s), expire ${expired.length}, and purge status records older than ${RETENTION_DAYS} days`,
        metadata: { due: due.length, expired: expired.length },
      };
    }

    let sent = 0;
    let failed = 0;
    let skipped = 0;

    const due = await storage.ebs.getDue(BATCH_LIMIT, now);
    for (const row of due) {
      if (!sourceComponentEnabled(row.pluginId)) {
        skipped++;
        continue;
      }
      // Claim atomically BEFORE emitting: only one pump run (this process or
      // another instance) can win the claim, so the event fires at most once
      // even if two runs overlap. A lost claim means someone else already
      // delivered it — skip silently.
      const claimed = await storage.ebs.claimForDelivery(row.uniqueId);
      if (!claimed) {
        skipped++;
        continue;
      }
      try {
        const failures = await eventBus.emitWithFailures(
          row.eventType as EventType,
          row.payload as EventPayloadMap[EventType],
        );
        sent++;
        if (failures.length > 0) {
          // The claim is already terminal, so we do NOT retry (retrying would
          // re-run the handlers that succeeded). Surface the partial failure
          // for the individual handler(s) to be investigated / self-heal.
          failed++;
          logger.warn(
            `EBS event ${row.uniqueId} emitted with ${failures.length} handler failure(s)`,
            { service: "ebs-pump", uniqueId: row.uniqueId, eventType: row.eventType },
          );
        }
      } catch (error) {
        // Already claimed as sent; log loudly. Not retried by design.
        failed++;
        logger.error(`EBS event ${row.uniqueId} failed to emit after claim`, {
          service: "ebs-pump",
          uniqueId: row.uniqueId,
          eventType: row.eventType,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    let expired = 0;
    const expiredRows = await storage.ebs.getExpiredUnfired(BATCH_LIMIT, now);
    for (const row of expiredRows) {
      logger.warn(`EBS event ${row.uniqueId} expired unfired`, {
        service: "ebs-pump",
        uniqueId: row.uniqueId,
        eventType: row.eventType,
        sendOn: row.sendOn,
        dontSendAfter: row.dontSendAfter,
      });
      try {
        await storage.ebs.markStatus(row.uniqueId, "expired");
        expired++;
      } catch (error) {
        logger.error(`Failed to mark EBS event ${row.uniqueId} expired`, {
          service: "ebs-pump",
          uniqueId: row.uniqueId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const cutoff = new Date(now.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const purged = await storage.ebs.purgeStatusBefore(cutoff);

    return {
      message: `Fired ${sent} event(s) (${failed} failed/retrying, ${skipped} skipped), expired ${expired}, purged ${purged} old status record(s)`,
      metadata: { sent, failed, skipped, expired, purged },
    };
  },
});
