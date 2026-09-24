import { logger } from "../../logger";
import { registerPluginKind } from "../_core";
import { workerBanPluginRegistry } from "./registry";

export {
  workerBanPluginRegistry,
  registerWorkerBanPlugin,
  type WorkerBanPlugin,
  type WorkerBanManifestEntry,
  type BanCheckContext,
} from "./registry";
export { BANNABLE_ACTIONS, getBannableActionName, type BannableActionId } from "./actions";
export {
  isBanned,
  banGloballyDenies,
  resolveBanType,
  isBanCurrentlyActive,
  LEGACY_DISPATCH_TYPE,
  DISPATCH_BAN_TYPE_SIRIUS_ID,
} from "./service";
export { seedWorkerBanTypes } from "./seed";

let kindRegistered = false;

/**
 * Initialize the worker-ban plugin framework: registers the `worker-ban`
 * kind (manifest served at /api/plugins/worker-ban/manifest — no config
 * adapter: plugins are singletons configured only through the Worker Ban
 * Types options page) and loads the built-in plugins via side-effect
 * imports below.
 */
export function initializeWorkerBanSystem(): void {
  if (kindRegistered) return;
  registerPluginKind({
    kind: "worker-ban",
    registry: workerBanPluginRegistry,
    label: "Worker Bans",
    description:
      "Ban behaviors that worker ban types can apply (what a ban prohibits and its arguments).",
    // No requiredPolicy: the worker bans page (viewable by users with
    // worker.view on the worker) needs plugin names/schemas to render.
    // Per-plugin component gating still applies via listVisibleTo.
    requiredComponent: "dispatch",
  });
  kindRegistered = true;
  logger.info("Worker-ban plugin system initialized", {
    service: "worker-ban-plugins",
    plugins: workerBanPluginRegistry.listIds(),
  });
}

// Plugin registrations (side-effect imports — each file self-registers).
import "./plugins/all-dispatch";
import "./plugins/facility";
import "./plugins/dispatch-job-type";
import "./plugins/eba";
