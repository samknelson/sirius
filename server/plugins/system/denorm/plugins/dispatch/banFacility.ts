import { registerDenormPlugin } from "../../registry";
import type { DenormPlugin } from "../../types";
import { EventType } from "../../../../../services/event-bus";
import { createWorkerBanStorage } from "../../../../../storage/worker-bans";
import {
  banIncludesPlugin,
  isBanCurrentlyActive,
} from "../../../../worker-bans/service";
import {
  type DispatchEligDenormPayload,
  dispatchEligBackfill,
  dispatchEligFindWidows,
  writeDispatchElig,
} from "./_shared";

const BAN_FACILITY_CATEGORY = "ban_facility";

/**
 * `dispatch_ban_facility` denorm plugin — maintains the `ban_facility` facts:
 * one per facility the worker is currently banned from (via an active ban
 * whose type includes the `facility` worker-ban plugin). The fact value is the
 * banned facility id, matched by the read-side `dispatch_ban_facility`
 * eligibility plugin against a job's linked facility.
 */
const dispatchBanFacilityDenormPlugin: DenormPlugin<DispatchEligDenormPayload> = {
  metadata: {
    id: "dispatch_ban_facility",
    name: "Facility Ban",
    description: "Excludes workers banned from the job's facility",
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
      // Date rollovers (emitted after commit by worker_ban_active) must drop
      // or restore the per-facility facts just like the global ban facts.
      event: EventType.WORKER_BAN_DENORM_FLIPPED,
      getEntityId: (payload) => (payload as { workerId: string }).workerId,
    },
  ],

  async compute(workerId: string): Promise<DispatchEligDenormPayload> {
    const banStorage = createWorkerBanStorage();
    const bans = await banStorage.getByWorker(workerId);
    const facilityIds = new Set<string>();
    for (const ban of bans) {
      if (!isBanCurrentlyActive(ban)) continue;
      if (!(await banIncludesPlugin(ban, "facility", "dispatch.accept"))) continue;
      // Per-ban argument shape owned by the `facility` worker-ban plugin's
      // argumentSchema (worker_bans.data.facilityId).
      const facilityId = (ban.data as { facilityId?: string } | null)?.facilityId;
      if (facilityId) facilityIds.add(facilityId);
    }
    return {
      entries: [...facilityIds].map((facilityId) => ({
        workerId,
        category: BAN_FACILITY_CATEGORY,
        value: facilityId,
      })),
    };
  },

  backfill: dispatchEligBackfill,
  findWidows: dispatchEligFindWidows,
  write: writeDispatchElig,
};

registerDenormPlugin(dispatchBanFacilityDenormPlugin);
