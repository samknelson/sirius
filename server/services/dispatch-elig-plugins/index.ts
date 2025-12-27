import { logger } from "../../logger";
import { eventBus, EventType } from "../event-bus";
import { dispatchEligPluginRegistry } from "../dispatch-elig-plugin-registry";
import { dispatchDncPlugin } from "./dnc";
import { dispatchHfePlugin } from "./hfe";
import { dispatchStatusPlugin } from "./status";
import { isComponentEnabledSync, isCacheInitialized } from "../component-cache";

export function registerDispatchEligPlugins(): void {
  dispatchEligPluginRegistry.register(dispatchDncPlugin);
  dispatchEligPluginRegistry.register(dispatchHfePlugin);
  dispatchEligPluginRegistry.register(dispatchStatusPlugin);
  
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

  eventBus.on(EventType.DISPATCH_HFE_SAVED, async (payload) => {
    if (!isCacheInitialized()) {
      logger.warn("Component cache not initialized, skipping HFE eligibility recompute", {
        service: "dispatch-elig-plugins",
        workerId: payload.workerId,
      });
      return;
    }

    if (!isComponentEnabledSync("dispatch.hfe")) {
      logger.debug("dispatch.hfe component not enabled, skipping recompute", {
        service: "dispatch-elig-plugins",
        workerId: payload.workerId,
      });
      return;
    }

    const plugin = dispatchEligPluginRegistry.getPlugin("dispatch_hfe");
    if (plugin) {
      await plugin.recomputeWorker(payload.workerId);
    }
  });

  eventBus.on(EventType.DISPATCH_STATUS_SAVED, async (payload) => {
    if (!isCacheInitialized()) {
      logger.warn("Component cache not initialized, skipping status eligibility recompute", {
        service: "dispatch-elig-plugins",
        workerId: payload.workerId,
      });
      return;
    }

    if (!isComponentEnabledSync("dispatch")) {
      logger.debug("dispatch component not enabled, skipping recompute", {
        service: "dispatch-elig-plugins",
        workerId: payload.workerId,
      });
      return;
    }

    const plugin = dispatchEligPluginRegistry.getPlugin("dispatch_status");
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
