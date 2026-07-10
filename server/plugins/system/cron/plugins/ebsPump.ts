import { logger } from "../../../../logger";
import { isPluginComponentEnabledSync } from "../../../_core";
import { denormPluginRegistry } from "../../denorm";
import { storage } from "../../../../storage";
import {
  RETENTION_DAYS,
  purgeAfterFor,
  emitDenormEvent,
} from "../../../../services/ebs-emit";
import { registerCronPlugin } from "../registry";
import type { CronJobContext, CronJobResult } from "../types";

/** Max scheduled events drained per run (each half). */
const BATCH_LIMIT = 1000;

/**
 * `ebs_pump` cron — the generic firing engine of the deferred event bus (EBS).
 *
 * Every run it drains three queues off `storage.ebs`:
 *   1. Due events (`send_on <= now <= dont_send_after`, no terminal status):
 *      each is first REVALIDATED against live domain state via the source denorm
 *      plugin's optional `isScheduledEventLive(uniqueId)` — if the subject is no
 *      longer a valid reason to fire (e.g. the absence ended / the worker was
 *      deleted) the event is marked terminal `expired` and NOT delivered. This
 *      is what guarantees a due reminder never fires after its subject changed,
 *      independent of when the hourly widow cleanup runs. A still-valid event is
 *      then claimed atomically BEFORE emit (`claimForDelivery`) so it fires
 *      at-most-once even under overlapping runs / multiple instances, then
 *      re-emitted on the real event bus via `emitWithFailures`. A handler
 *      failure after the claim is logged, NOT retried — re-emitting the whole
 *      event would re-run the handlers that already succeeded. Events whose
 *      source component has been disabled are left unclaimed so they resume if
 *      it is re-enabled inside the window.
 *   2. Expired events (`dont_send_after < now`, no terminal status): recorded
 *      `expired` (logged once) rather than delivered, so a long-down window or a
 *      retroactively-scheduled past reminder never blasts a stale notice.
 *   3. Retention purge: `ebs_status` rows whose `purge_after` cutoff has passed
 *      are deleted. `purge_after` is derived from each event's `dont_send_after`
 *      ({@link RETENTION_DAYS} past window close), so the purge is row-safe — it
 *      can never drop a status while its event is still in the firing window.
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
        message: `Would fire ${due.length} due event(s), expire ${expired.length}, and purge status records past their retention cutoff (${RETENTION_DAYS}d after window close)`,
        metadata: { due: due.length, expired: expired.length },
      };
    }

    let sent = 0;
    let failed = 0;
    let skipped = 0;
    let invalidated = 0;

    const due = await storage.ebs.getDue(BATCH_LIMIT, now);
    for (const row of due) {
      const plugin = denormPluginRegistry.get(row.pluginId);
      if (!plugin || !isPluginComponentEnabledSync(plugin.metadata)) {
        skipped++;
        continue;
      }
      // Revalidate against LIVE domain state before firing. This is the
      // correctness guarantee that a due reminder never fires after its subject
      // changed (absence ended / worker deleted), regardless of whether the
      // hourly widow cleanup has run yet. Mark such events terminal (`expired`)
      // so they are not re-evaluated on the next run.
      if (plugin.isScheduledEventLive) {
        let live: boolean;
        try {
          live = await plugin.isScheduledEventLive(row.uniqueId);
        } catch (error) {
          // A validator failure must NOT deliver a possibly-stale reminder;
          // skip this run and re-evaluate next time.
          skipped++;
          logger.error(`EBS event ${row.uniqueId} validity check failed`, {
            service: "ebs-pump",
            uniqueId: row.uniqueId,
            eventType: row.eventType,
            error: error instanceof Error ? error.message : String(error),
          });
          continue;
        }
        if (!live) {
          try {
            await storage.ebs.markStatus(
              row.uniqueId,
              "expired",
              purgeAfterFor(row.dontSendAfter),
            );
            invalidated++;
          } catch (error) {
            logger.error(`Failed to mark EBS event ${row.uniqueId} expired (stale subject)`, {
              service: "ebs-pump",
              uniqueId: row.uniqueId,
              error: error instanceof Error ? error.message : String(error),
            });
          }
          continue;
        }
      }
      // Claim atomically BEFORE emitting: only one pump run (this process or
      // another instance) can win the claim, so the event fires at most once
      // even if two runs overlap. A lost claim means someone else already
      // delivered it — skip silently.
      const claimed = await storage.ebs.claimForDelivery(
        row.uniqueId,
        purgeAfterFor(row.dontSendAfter),
      );
      if (!claimed) {
        skipped++;
        continue;
      }
      try {
        const failures = await emitDenormEvent(row);
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
        await storage.ebs.markStatus(
          row.uniqueId,
          "expired",
          purgeAfterFor(row.dontSendAfter),
        );
        expired++;
      } catch (error) {
        logger.error(`Failed to mark EBS event ${row.uniqueId} expired`, {
          service: "ebs-pump",
          uniqueId: row.uniqueId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const purged = await storage.ebs.purgeExpired(now);

    return {
      message: `Fired ${sent} event(s) (${failed} with handler failure(s), ${skipped} skipped/already-claimed, ${invalidated} invalidated as stale), expired ${expired}, purged ${purged} old status record(s)`,
      metadata: { sent, failed, skipped, invalidated, expired, purged },
    };
  },
});
