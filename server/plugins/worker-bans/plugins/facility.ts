import { registerWorkerBanPlugin } from "../registry";

/**
 * Facility — bans the worker from accepting dispatches to a specific
 * facility. The facility is a per-ban argument stored in
 * `worker_bans.data.facilityId`; the ban only matches when the enforcement
 * context carries a matching facility.
 */
registerWorkerBanPlugin({
  id: "facility",
  name: "Facility",
  description:
    "Bans the worker from accepting dispatch jobs at a specific facility.",
  requiredComponent: "dispatch",
  actions: ["dispatch.accept"],
  argumentSchema: {
    type: "object",
    properties: {
      facilityId: {
        type: "string",
        title: "Facility",
        "x-options-resource": "facility",
      } as Record<string, unknown>,
    },
    required: ["facilityId"],
  },
  matches(ban, _action, context) {
    const banFacility = (ban.data as { facilityId?: string } | null)?.facilityId;
    if (!banFacility) return false;
    return context.facilityId != null && context.facilityId === banFacility;
  },
});
