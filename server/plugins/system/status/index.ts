import { logger } from "../../../logger";
import { registerPluginKind } from "../../_core/kinds";
import { systemStatusPluginRegistry } from "./registry";

export * from "./types";
export { systemStatusPluginRegistry, registerSystemStatusPlugin } from "./registry";
export { collectStatus, rescanPlugin, rescanAll, getPluginDetails } from "./collector";

let kindRegistered = false;
function registerSystemStatusKind(): void {
  if (kindRegistered) return;
  registerPluginKind({
    kind: "system-status",
    registry: systemStatusPluginRegistry,
    label: "System Status",
    description:
      "Health checks that scan one aspect of the system each and report prioritized status messages.",
    // Inspecting system internals (database, filesystems, providers) is
    // admin-only infrastructure, like cron and wizards.
    requiredPolicy: "admin",
    sortEntries: (a, b) => a.id.localeCompare(b.id),
  });
  kindRegistered = true;
}

/**
 * Initialize the system-status plugin system: register the kind. Plugins
 * self-register via the side-effect imports at the bottom of this file.
 * There is no config adapter — status plugins have no persisted
 * configuration and no `plugin_configs` rows; results live in memory only.
 */
export function initializeSystemStatusPluginSystem(): void {
  registerSystemStatusKind();
  logger.info("System status plugins registered", {
    service: "system-status",
    plugins: systemStatusPluginRegistry.listIds(),
  });
}

// Plugin registrations (side-effect imports — each file self-registers).
import "./plugins/uptime";
import "./plugins/user-activity";
import "./plugins/instance";
import "./plugins/container";
import "./plugins/system-mode";
import "./plugins/database-connection";
import "./plugins/database-disk";
import "./plugins/filesystems";
import "./plugins/comm-sms";
import "./plugins/sitespecific-t631-client";
