import { eq } from "drizzle-orm";
import { optionsWorkerBanType, workerBans } from "@shared/schema";
import { db } from "./db";
import { logger } from "../logger";
import { DISPATCH_BAN_TYPE_SIRIUS_ID, LEGACY_DISPATCH_TYPE } from "../plugins/worker-bans/service";

/**
 * Boot-time seeding + legacy migration for worker ban types (idempotent):
 *
 * 1. Ensure a "Dispatch" ban type option row exists (siriusId `DISPATCH`,
 *    applying the unconditional `all-dispatch` plugin). Seeded in code (not a
 *    SQL migration) so it exists on fresh deployments too.
 * 2. Rewrite legacy `worker_bans.type = 'dispatch'` rows to reference that
 *    option row, preserving their behavior under the new framework.
 */
export async function seedWorkerBanTypes(): Promise<void> {
  const [existing] = await db
    .select()
    .from(optionsWorkerBanType)
    .where(eq(optionsWorkerBanType.siriusId, DISPATCH_BAN_TYPE_SIRIUS_ID));

  let dispatchTypeId = existing?.id;
  if (!dispatchTypeId) {
    const [created] = await db
      .insert(optionsWorkerBanType)
      .values({
        name: "Dispatch",
        description: "Bans the worker from accepting any dispatch job.",
        siriusId: DISPATCH_BAN_TYPE_SIRIUS_ID,
        data: { pluginIds: ["all-dispatch"] },
      })
      .onConflictDoNothing({ target: optionsWorkerBanType.siriusId })
      .returning();
    if (created) {
      dispatchTypeId = created.id;
      logger.info("Seeded default Dispatch worker ban type", {
        service: "worker-ban-seed",
        id: created.id,
      });
    } else {
      // Lost a concurrent-boot race; re-read.
      const [row] = await db
        .select()
        .from(optionsWorkerBanType)
        .where(eq(optionsWorkerBanType.siriusId, DISPATCH_BAN_TYPE_SIRIUS_ID));
      dispatchTypeId = row?.id;
    }
  }

  if (!dispatchTypeId) {
    logger.error("Could not resolve Dispatch worker ban type row; legacy bans not migrated", {
      service: "worker-ban-seed",
    });
    return;
  }

  const result = await db
    .update(workerBans)
    .set({ type: dispatchTypeId })
    .where(eq(workerBans.type, LEGACY_DISPATCH_TYPE));
  const migrated = result.rowCount ?? 0;
  if (migrated > 0) {
    logger.info(`Migrated ${migrated} legacy dispatch worker bans to the Dispatch ban type`, {
      service: "worker-ban-seed",
      dispatchTypeId,
    });
  }
}
