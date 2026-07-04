import { registerDenormPlugin } from "../../registry";
import type { DenormPlugin } from "../../types";
import { EventType } from "../../../../../services/event-bus";
import { createWorkerBanStorage } from "../../../../../storage/worker-bans";
import type { WorkerBan } from "@shared/schema";
import {
  type DispatchEligDenormPayload,
  dispatchEligBackfill,
  dispatchEligFindWidows,
  writeDispatchElig,
} from "./_shared";

const BAN_CATEGORY = "ban";

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

/**
 * `dispatch_ban` denorm plugin — maintains the `ban` facts (one per active
 * dispatch ban). Gated by the `dispatch.ban` component via the framework; when
 * the component is disabled the plugin does not run and its rows cascade away.
 */
const dispatchBanDenormPlugin: DenormPlugin<DispatchEligDenormPayload> = {
  metadata: {
    id: "dispatch_ban",
    name: "Worker Ban",
    description: "Excludes workers who have an active dispatch ban",
    requiredComponent: "dispatch.ban",
    singleton: true,
  },
  entityType: "worker",
  eventHandlers: [
    {
      event: EventType.WORKER_BAN_SAVED,
      getEntityId: (payload) => (payload as { workerId: string }).workerId,
    },
  ],

  async compute(workerId: string): Promise<DispatchEligDenormPayload> {
    const banStorage = createWorkerBanStorage();
    const bans = await banStorage.getByWorker(workerId);
    const activeBans = bans.filter((ban) => ban.type === "dispatch" && isBanCurrentlyActive(ban));

    return {
      entries: activeBans.map((ban) => ({
        workerId,
        category: BAN_CATEGORY,
        value: `dispatch:${ban.id}`,
      })),
    };
  },

  backfill: dispatchEligBackfill,
  findWidows: dispatchEligFindWidows,
  write: writeDispatchElig,
};

registerDenormPlugin(dispatchBanDenormPlugin);
