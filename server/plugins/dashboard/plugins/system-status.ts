import { registerDashboardPlugin } from "../registry";
import type { DashboardPlugin } from "../types";
import {
  systemStatusPluginRegistry,
  collectStatus,
} from "../../system/status";

/**
 * Dashboard widget summarizing system status: shows each visible status
 * plugin's worst priority and rolls up warnings/errors at the top.
 * Admin-only, mirroring the system-status kind's own gating.
 */
export const systemStatusDashboardPlugin: DashboardPlugin = {
  id: "system-status",
  name: "System Status",
  description: "Roll-up of system health checks with any warnings or errors.",
  requiredPolicy: "admin",

  async content(ctx) {
    const visible = await systemStatusPluginRegistry.listVisibleTo(ctx.req);
    const entries = await collectStatus(visible);
    const problems = entries
      .filter((e) => e.worstPriority === "warning" || e.worstPriority === "error")
      .flatMap((e) =>
        e.result.messages
          .filter((m) => m.priority === "warning" || m.priority === "error")
          .map((m) => ({ pluginId: e.id, pluginName: e.name, ...m })),
      );
    return {
      statuses: entries.map((e) => ({
        id: e.id,
        name: e.name,
        worstPriority: e.worstPriority,
        scannedAt: e.result.scannedAt,
      })),
      warningCount: problems.filter((p) => p.priority === "warning").length,
      errorCount: problems.filter((p) => p.priority === "error").length,
      problems,
    };
  },

  client: {
    component: "system-status:SystemStatus",
    order: 7,
    requiredPermissions: ["admin"],
  },
};

registerDashboardPlugin(systemStatusDashboardPlugin);
