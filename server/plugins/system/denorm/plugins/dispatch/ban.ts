import { registerDenormPlugin } from "../../registry";
import type { DenormPlugin } from "../../types";
import { EventType } from "../../../../../services/event-bus";
import { createWorkerBanStorage } from "../../../../../storage/worker-bans";
import {
  banGloballyDenies,
  isBanCurrentlyActive,
} from "../../../../worker-bans/service";
import {
  type DispatchEligDenormPayload,
  dispatchEligBackfill,
  dispatchEligFindWidows,
  writeDispatchElig,
} from "./_shared";

const BAN_CATEGORY = "ban";

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
  reads: ["workers", "workerBans"],
  writes: [{ storage: "workerDispatchEligDenorm", soleWriter: false }],
  eventHandlers: [
    {
      event: EventType.WORKER_BAN_SAVED,
      getEntityId: (payload) => (payload as { workerId: string }).workerId,
    },
    {
      // Date-rollover flips of the cached denorm_active flag (emitted after
      // commit by worker_ban_active) must refresh the worker's ban facts.
      event: EventType.WORKER_BAN_DENORM_FLIPPED,
      getEntityId: (payload) => (payload as { workerId: string }).workerId,
    },
  ],

  async compute(workerId: string): Promise<DispatchEligDenormPayload> {
    const banStorage = createWorkerBanStorage();
    const bans = await banStorage.getByWorker(workerId);
    // Only bans whose type UNCONDITIONALLY denies dispatch acceptance (e.g.
    // the all-dispatch plugin, including migrated legacy "dispatch" bans)
    // become global eligibility facts; conditional bans (facility, job type)
    // become per-target facts via the dispatch_ban_facility /
    // dispatch_ban_jobtype denorm plugins instead.
    const dateActive = bans.filter((ban) => isBanCurrentlyActive(ban));
    const activeBans = [];
    for (const ban of dateActive) {
      if (await banGloballyDenies(ban, "dispatch.accept")) activeBans.push(ban);
    }

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
