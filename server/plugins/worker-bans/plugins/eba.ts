import { registerWorkerBanPlugin } from "../registry";

/**
 * EBA — bans the worker from being listed as Employed but Available.
 * Unconditional; owned by the `dispatch.eba` component.
 */
registerWorkerBanPlugin({
  id: "eba",
  name: "Employed but Available",
  description:
    "Bans the worker from being listed as Employed but Available.",
  requiredComponent: "dispatch.eba",
  actions: ["dispatch.eba"],
});
