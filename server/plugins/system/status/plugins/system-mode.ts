import { registerSystemStatusPlugin } from "../registry";
import { getSystemMode } from "../../../../services/system-mode";

registerSystemStatusPlugin({
  id: "system.mode",
  name: "System Mode",
  description: "The current system mode (dev, test, live, or maintenance).",
  // Thin wrapper over the existing system-mode lookup — cheap and always
  // informational, so recompute on every collect.
  scanMode: "immediate",
  async scan() {
    const mode = await getSystemMode();
    return [
      {
        // Maintenance mode locks all database writes — surface it loudly.
        priority: mode === "maintenance" ? ("warning" as const) : ("info" as const),
        title: `System mode: ${mode}`,
      },
    ];
  },
});
