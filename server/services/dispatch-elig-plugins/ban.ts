import { logger } from "../../logger";
import { createWorkerBanStorage } from "../../storage/worker-bans";
import { createWorkerDispatchEligDenormStorage } from "../../storage/worker-dispatch-elig-denorm";
import type { DispatchEligPlugin, EligibilityCondition, EligibilityQueryContext } from "../dispatch-elig-plugin-registry";
import { EventType } from "../event-bus";
import { isComponentEnabledSync, isCacheInitialized } from "../component-cache";
import type { WorkerBan } from "@shared/schema";

const BAN_CATEGORY = "ban";
const COMPONENT_ID = "dispatch.ban";

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function isBanCurrentlyActive(ban: WorkerBan): boolean {
  const today = startOfDay(new Date());
  const startDay = startOfDay(new Date(ban.startDate));
  if (startDay > today) return false;
  if (!ban.endDate) return true;
  const endDay = startOfDay(new Date(ban.endDate));
  return endDay >= today;
}

export const dispatchBanPlugin: DispatchEligPlugin = {
  id: "dispatch_ban",
  name: "Worker Ban",
  description: "Excludes workers who have an active dispatch ban",
  componentId: "dispatch.ban",

  eventHandlers: [
    {
      event: EventType.WORKER_BAN_SAVED,
      getWorkerId: (payload) => payload.workerId,
    },
  ],

  getEligibilityCondition(_context: EligibilityQueryContext, _config: Record<string, unknown>): EligibilityCondition | null {
    return {
      category: BAN_CATEGORY,
      type: "not_exists_category",
      value: "dispatch:*",
    };
  },

  async recomputeWorker(workerId: string): Promise<void> {
    const banStorage = createWorkerBanStorage();
    const eligStorage = createWorkerDispatchEligDenormStorage();

    logger.debug(`Recomputing ban eligibility for worker ${workerId}`, {
      service: "dispatch-elig-ban",
      workerId,
    });

    // Always delete existing entries first
    await eligStorage.deleteByWorkerAndCategory(workerId, BAN_CATEGORY);

    // If component is disabled, just clear entries and don't create new ones
    if (!isCacheInitialized() || !isComponentEnabledSync(COMPONENT_ID)) {
      logger.debug(`dispatch.ban component disabled, cleared entries for worker ${workerId}`, {
        service: "dispatch-elig-ban",
        workerId,
      });
      return;
    }

    const bans = await banStorage.getByWorker(workerId);
    const activeBans = bans.filter(ban => ban.type === "dispatch" && isBanCurrentlyActive(ban));

    if (activeBans.length === 0) {
      logger.debug(`No active dispatch bans for worker ${workerId}`, {
        service: "dispatch-elig-ban",
        workerId,
      });
      return;
    }

    const eligEntries = activeBans.map(ban => ({
      workerId,
      category: BAN_CATEGORY,
      value: `dispatch:${ban.id}`,
    }));

    await eligStorage.createMany(eligEntries);

    logger.debug(`Created ${eligEntries.length} ban eligibility entries for worker ${workerId}`, {
      service: "dispatch-elig-ban",
      workerId,
      activeBanCount: activeBans.length,
      banIds: activeBans.map(b => b.id),
    });
  },
};

/**
 * Backfill eligibility entries for all existing active dispatch bans.
 * This should be called at startup to ensure pre-existing bans are accounted for.
 */
export async function backfillDispatchBanEligibility(): Promise<{ workersProcessed: number; entriesCreated: number }> {
  if (!isCacheInitialized()) {
    logger.warn("Component cache not initialized, skipping ban eligibility backfill", {
      service: "dispatch-elig-ban",
    });
    return { workersProcessed: 0, entriesCreated: 0 };
  }

  if (!isComponentEnabledSync(COMPONENT_ID)) {
    logger.debug("dispatch.ban component not enabled, skipping backfill", {
      service: "dispatch-elig-ban",
    });
    return { workersProcessed: 0, entriesCreated: 0 };
  }

  const banStorage = createWorkerBanStorage();
  const allBans = await banStorage.getAll();
  
  const activeDispatchBans = allBans.filter(
    ban => ban.type === "dispatch" && isBanCurrentlyActive(ban)
  );

  if (activeDispatchBans.length === 0) {
    logger.info("No active dispatch bans found for backfill", {
      service: "dispatch-elig-ban",
    });
    return { workersProcessed: 0, entriesCreated: 0 };
  }

  const uniqueWorkerIds = Array.from(new Set(activeDispatchBans.map(ban => ban.workerId)));

  logger.info(`Backfilling ban eligibility for ${uniqueWorkerIds.length} workers with ${activeDispatchBans.length} active dispatch bans`, {
    service: "dispatch-elig-ban",
    workerCount: uniqueWorkerIds.length,
    banCount: activeDispatchBans.length,
  });

  let entriesCreated = 0;
  for (const workerId of uniqueWorkerIds) {
    await dispatchBanPlugin.recomputeWorker(workerId);
    const workerBans = activeDispatchBans.filter(b => b.workerId === workerId);
    entriesCreated += workerBans.length;
  }

  logger.info(`Completed ban eligibility backfill`, {
    service: "dispatch-elig-ban",
    workersProcessed: uniqueWorkerIds.length,
    entriesCreated,
  });

  return { workersProcessed: uniqueWorkerIds.length, entriesCreated };
}
