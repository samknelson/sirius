import { registerWorkerBanPlugin } from "../../../../../../server/plugins/worker-bans/registry";
import { registerBannableAction } from "../../../../../../server/plugins/worker-bans/actions";
declare module "../../../../../../server/plugins/worker-bans/actions" {
  interface ComponentBannableActions { "dispatch.eba": true }
}
registerBannableAction({ id: "dispatch.eba", name: "Being listed as Employed but Available" });

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
