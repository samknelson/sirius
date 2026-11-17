import { getBootIdentity } from "../../../../services/boot-identity";
import { getLocalProcessReporter } from "../../../../services/process-reporter";
import { createProcessesStorage } from "../../../../storage/system/processes";
import { processReportingStatus } from "@shared/processes";
import { registerSystemStatusPlugin } from "../registry";
import type { StatusMessage } from "../types";

registerSystemStatusPlugin({
  id: "process",
  name: "Responding process",
  description: "Local process observations, not fleet health or service readiness.",
  scanMode: "immediate",
  async scan() {
    const boot = getBootIdentity();
    const local = getLocalProcessReporter();
    const messages: StatusMessage[] = [{
      priority: "info", title: `Process ${boot.bootId}`,
      details: `Name: ${local?.identity.name ?? "(unnamed)"}. Roles: ${local?.identity.roles.join(", ") ?? "unavailable"}. Started: ${boot.startedAt}. Heartbeat freshness is not readiness or fleet health.`,
      link: { href: "/config/processes", label: "View processes" },
    }];
    try {
      const row = await createProcessesStorage().get(boot.bootId);
      messages.push(row ? {
        priority: "info",
        title: row.endedTs ? "End recorded" : processReportingStatus(row.updatedTs),
        details: `Registered startup: ${row.startedTs.toISOString()}. Last heartbeat: ${row.updatedTs.toISOString()}.`,
      } : {
        priority: "notice", title: "Registration absent",
        details: "This process has no registry row. Registration may be pending, failed, or retention-purged; reporting retries automatically.",
      });
    } catch {
      messages.push({ priority: "notice", title: "Registration unavailable", details: "The registry could not be read. This does not establish process or service health." });
    }
    if (local?.writeFailed) messages.push({
      priority: "notice", title: "Last lifecycle write failed",
      details: `Last successful local heartbeat: ${local.lastSuccess?.toISOString() ?? "none"}. Retrying while this process runs.`,
    });
    return messages;
  },
});
