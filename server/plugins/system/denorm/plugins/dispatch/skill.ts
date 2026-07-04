import { registerDenormPlugin } from "../../registry";
import type { DenormPlugin } from "../../types";
import { EventType } from "../../../../../services/event-bus";
import { createWorkerSkillStorage } from "../../../../../storage/workers/skills";
import {
  type DispatchEligDenormPayload,
  dispatchEligBackfill,
  dispatchEligFindWidows,
  writeDispatchElig,
} from "./_shared";

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
  eventHandlers: [
    {
      event: EventType.WORKER_SKILL_SAVED,
      getEntityId: (payload) => (payload as { workerId: string }).workerId,
    },
  ],

  async compute(workerId: string): Promise<DispatchEligDenormPayload> {
    const skillStorage = createWorkerSkillStorage();
    const workerSkills = await skillStorage.getByWorker(workerId);

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
