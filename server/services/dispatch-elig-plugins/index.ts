import { logger } from "../../logger";
import { eventBus, EventType } from "../event-bus";
import { dispatchEligPluginRegistry } from "../dispatch-elig-plugin-registry";
import { dispatchDncPlugin } from "./dnc";
import { isComponentEnabledSync, isCacheInitialized } from "../component-cache";

export function registerDispatchEligPlugins(): void {
  dispatchEligPluginRegistry.register(dispatchDncPlugin);
  
  logger.info("Dispatch eligibility plugins registered", {
    service: "dispatch-elig-plugins",
    plugins: dispatchEligPluginRegistry.getAllPluginIds(),
  });
}

export function subscribeDispatchEligEventHandlers(): void {
  eventBus.on(EventType.DISPATCH_DNC_SAVED, async (payload) => {
    if (!isCacheInitialized()) {
      logger.warn("Component cache not initialized, skipping DNC eligibility recompute", {
        service: "dispatch-elig-plugins",
        workerId: payload.workerId,
      });
      return;
    }

    if (!isComponentEnabledSync("dispatch.dnc")) {
      logger.debug("dispatch.dnc component not enabled, skipping recompute", {
        service: "dispatch-elig-plugins",
        workerId: payload.workerId,
      });
      return;
    }

    const plugin = dispatchEligPluginRegistry.getPlugin("dispatch_dnc");
    if (plugin) {
      await plugin.recomputeWorker(payload.workerId);
    }
  });

  logger.info("Dispatch eligibility event handlers subscribed", {
    service: "dispatch-elig-plugins",
  });
}

export function initializeDispatchEligSystem(): void {
  registerDispatchEligPlugins();
  subscribeDispatchEligEventHandlers();
}
