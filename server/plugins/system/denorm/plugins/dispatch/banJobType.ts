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

const BAN_JOBTYPE_CATEGORY = "ban_jobtype";

/**
 * `dispatch_ban_jobtype` denorm plugin — maintains the `ban_jobtype` facts:
 * one per job type the worker is currently banned from (via an active ban
 * whose type includes the `dispatch-job-type` worker-ban plugin). The fact
 * value is the banned job-type id, matched by the read-side
 * `dispatch_ban_jobtype` eligibility plugin against the job's jobTypeId.
 */
const dispatchBanJobTypeDenormPlugin: DenormPlugin<DispatchEligDenormPayload> = {
  metadata: {
    id: "dispatch_ban_jobtype",
    name: "Job Type Ban",
    description: "Excludes workers banned from the job's job type",
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
      // or restore the per-job-type facts just like the global ban facts.
      event: EventType.WORKER_BAN_DENORM_FLIPPED,
      getEntityId: (payload) => (payload as { workerId: string }).workerId,
    },
  ],

  async compute(workerId: string): Promise<DispatchEligDenormPayload> {
    const banStorage = createWorkerBanStorage();
    const bans = await banStorage.getByWorker(workerId);
    const jobTypeIds = new Set<string>();
    for (const ban of bans) {
      if (!isBanCurrentlyActive(ban)) continue;
      if (!(await banIncludesPlugin(ban, "dispatch-job-type", "dispatch.accept"))) continue;
      // Per-ban argument shape owned by the `dispatch-job-type` worker-ban
      // plugin's argumentSchema (worker_bans.data.jobTypeId).
      const jobTypeId = (ban.data as { jobTypeId?: string } | null)?.jobTypeId;
      if (jobTypeId) jobTypeIds.add(jobTypeId);
    }
    return {
      entries: [...jobTypeIds].map((jobTypeId) => ({
        workerId,
        category: BAN_JOBTYPE_CATEGORY,
        value: jobTypeId,
      })),
    };
  },

  backfill: dispatchEligBackfill,
  findWidows: dispatchEligFindWidows,
  write: writeDispatchElig,
};

registerDenormPlugin(dispatchBanJobTypeDenormPlugin);
