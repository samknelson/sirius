import { registerDenormPlugin } from "../../../../../../../../server/plugins/system/denorm/registry";
import type { DenormPlugin } from "../../../../../../../../server/plugins/system/denorm/types";
import { T631_INTERVIEW_SAVED } from "../../../../../events";
import {
  type DispatchEligDenormPayload,
  dispatchEligBackfill,
  dispatchEligFindWidows,
  writeDispatchElig,
} from "../../../../../../../../server/plugins/system/denorm/plugins/dispatch/_shared";

const INTERVIEW_CATEGORY = "t631_interview";

/**
 * `sitespecific_t631_interview` denorm plugin — maintains one `t631_interview`
 * fact per dispatch job the worker has PASSED an interview for (value = jobId).
 * Read side: the t631-interview dispatch-eligibility plugin. Gated by the
 * `sitespecific.t631.interviews` component.
 */
const t631InterviewDenormPlugin: DenormPlugin<DispatchEligDenormPayload> = {
  metadata: {
    id: "sitespecific_t631_interview",
    name: "T631 Interview",
    description: "Tracks which dispatch jobs a worker has passed the interview for",
    requiredComponent: "sitespecific.t631.interviews",
    singleton: true,
  },
  entityType: "worker",
  reads: ["workers", "t631Interviews"],
  writes: [{ storage: "workerDispatchEligDenorm", soleWriter: false }],
  eventHandlers: [
    {
      event: T631_INTERVIEW_SAVED,
      getEntityId: (payload) => (payload as { workerId: string }).workerId,
    },
  ],

  async compute(workerId: string): Promise<DispatchEligDenormPayload> {
    const { storage } = await import("../../../../../../../../server/storage/database");
    const interviews = await storage.t631Interviews.getByWorker(workerId);

    return {
      entries: interviews
        .filter((interview) => interview.status === "passed")
        .map((interview) => ({
          workerId: interview.workerId,
          category: INTERVIEW_CATEGORY,
          value: interview.jobId,
        })),
    };
  },

  backfill: dispatchEligBackfill,
  findWidows: dispatchEligFindWidows,
  write: writeDispatchElig,
};

registerDenormPlugin(t631InterviewDenormPlugin);
