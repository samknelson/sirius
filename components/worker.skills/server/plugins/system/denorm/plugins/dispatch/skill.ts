import { registerDenormPlugin } from "../../../../../../../../server/plugins/system/denorm/registry";
import type { DenormPlugin } from "../../../../../../../../server/plugins/system/denorm/types";
import { WORKER_SKILL_SAVED } from "../../../../../events";
import { storage } from "../../../../../../../../server/storage/database";
import {
  type DispatchEligDenormPayload,
  dispatchEligBackfill,
  dispatchEligFindWidows,
  writeDispatchElig,
} from "../../../../../../../../server/plugins/system/denorm/plugins/dispatch/_shared";

const SKILL_CATEGORY = "skill";

/**
 * `dispatch_skill` denorm plugin — maintains the `skill` facts (one per skill a
 * worker holds). Gated by the `worker.skills` component.
 */
const dispatchSkillDenormPlugin: DenormPlugin<DispatchEligDenormPayload> = {
  metadata: {
    id: "dispatch_skill",
    name: "Required Skills",
    description: "Filters workers based on required skills for the job",
    requiredComponent: "worker.skills",
    singleton: true,
  },
  entityType: "worker",
  reads: ["workers", "workerSkills"],
  writes: [{ storage: "workerDispatchEligDenorm", soleWriter: false }],
  eventHandlers: [
    {
      event: WORKER_SKILL_SAVED,
      getEntityId: (payload) => (payload as { workerId: string }).workerId,
    },
  ],

  async compute(workerId: string): Promise<DispatchEligDenormPayload> {
    const workerSkills = await storage.workerSkills.getByWorker(workerId);

    return {
      entries: workerSkills.map((ws) => ({
        workerId: ws.workerId,
        category: SKILL_CATEGORY,
        value: ws.skillId,
      })),
    };
  },

  backfill: dispatchEligBackfill,
  findWidows: dispatchEligFindWidows,
  write: writeDispatchElig,
};

registerDenormPlugin(dispatchSkillDenormPlugin);
