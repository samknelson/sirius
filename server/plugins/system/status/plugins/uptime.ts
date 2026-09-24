import { formatDurationMs } from "@shared/utils";
import { registerSystemStatusPlugin } from "../registry";

/** Boot time captured once at module load (process start, minus uptime). */
const bootedAt = new Date(Date.now() - process.uptime() * 1000);

registerSystemStatusPlugin({
  id: "uptime",
  name: "Uptime",
  description: "When this server process started.",
  // Cheap to compute and its answer changes every minute — recompute on
  // every collect instead of caching a stale "Up 0m".
  scanMode: "immediate",
  async scan() {
    return [
      {
        priority: "info",
        title: `Up ${formatDurationMs(Date.now() - bootedAt.getTime())}`,
        details: `Server process started at ${bootedAt.toISOString()}.`,
      },
    ];
  },
});
