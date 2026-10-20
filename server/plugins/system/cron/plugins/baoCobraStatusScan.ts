import { registerCronPlugin } from "../registry";
import { scanCobraCaseStatuses } from "../../../../services/bao-cobra-lifecycle";

registerCronPlugin({
  metadata: {
    id: "bao-cobra-status-scan",
    name: "BAO - COBRA Status Scan",
    description: "Recovers missed COBRA lifecycle events and applies aged payment deadlines and maximum-period closure. Reports evidence and configuration blockers.",
    requiredComponent: "sitespecific.bao",
    singleton: true,
  },
  defaultSchedule: "30 4 * * *",
  defaultEnabled: false,
  async execute(context) {
    const report = await scanCobraCaseStatuses(context.mode);
    const blocked = report.results.filter((r) => r.blockers.length);
    const changed = report.results.filter((r) => Object.keys(r.changes).length);
    if (blocked.length || report.truncated) {
      // A successful no-op must never conceal per-case errors.
      throw new Error(`COBRA scan: ${changed.length} changes, ${blocked.length} blocked cases${report.truncated ? "; scan limit reached" : ""}. ${JSON.stringify(blocked)}`);
    }
    return {
      message: `${context.mode === "test" ? "[TEST] Would reconcile" : "Reconciled"} ${changed.length} changes across ${report.results.length} COBRA cases`,
      metadata: report,
    };
  },
});
