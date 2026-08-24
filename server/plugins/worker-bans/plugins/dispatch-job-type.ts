import { registerWorkerBanPlugin } from "../registry";

/**
 * Dispatch Job Type — bans the worker from accepting dispatches for jobs of
 * a specific job type. The job type is a per-ban argument stored in
 * `worker_bans.data.jobTypeId`.
 */
registerWorkerBanPlugin({
  id: "dispatch-job-type",
  name: "Dispatch Job Type",
  description:
    "Bans the worker from accepting dispatch jobs of a specific job type.",
  requiredComponent: "dispatch",
  actions: ["dispatch.accept"],
  argumentSchema: {
    type: "object",
    properties: {
      jobTypeId: {
        type: "string",
        title: "Job Type",
        "x-options-resource": "dispatch-job-type",
      } as Record<string, unknown>,
    },
    required: ["jobTypeId"],
  },
  matches(ban, _action, context) {
    const banJobType = (ban.data as { jobTypeId?: string } | null)?.jobTypeId;
    if (!banJobType) return false;
    return context.jobTypeId != null && context.jobTypeId === banJobType;
  },
});
