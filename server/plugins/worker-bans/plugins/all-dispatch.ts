import { registerWorkerBanPlugin } from "../registry";

/**
 * All Dispatch — bans the worker from accepting any dispatch job.
 * Unconditional: an active ban of a type including this plugin denies
 * dispatch acceptance outright and drives the dispatch-eligibility
 * `ban` denorm facts (legacy "dispatch" ban behavior).
 */
registerWorkerBanPlugin({
  id: "all-dispatch",
  name: "All Dispatch",
  description: "Bans the worker from accepting any dispatch job.",
  requiredComponent: "dispatch",
  actions: ["dispatch.accept"],
});
