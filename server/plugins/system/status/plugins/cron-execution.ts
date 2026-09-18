import { getCronExecutionPolicy } from "../../../../cron/execution-policy";
import { registerSystemStatusPlugin } from "../registry";

registerSystemStatusPlugin({
  id: "cron.execution",
  name: "Cron Execution",
  description:
    "Whether this deployment may schedule or run enabled cron configurations.",
  scanMode: "immediate",
  async scan() {
    const policy = getCronExecutionPolicy();
    return [
      {
        priority: policy.allowed ? ("info" as const) : ("warning" as const),
        title: policy.allowed
          ? "Cron execution is allowed"
          : "Cron execution is suppressed",
        details:
          `${policy.reason} After a raw database refresh, restart the application ` +
          "or explicitly reload scheduling because replacing the database does not emit configuration-change events.",
      },
    ];
  },
});