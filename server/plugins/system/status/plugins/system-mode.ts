import { registerSystemStatusPlugin } from "../registry";
import { getSystemMode } from "../../../../services/system-mode";

registerSystemStatusPlugin({
  id: "system.mode",
  name: "System Mode",
  description: "The current system mode (dev, test, or live).",
  // Thin wrapper over the existing system-mode lookup — cheap and always
  // informational, so recompute on every collect.
  scanMode: "immediate",
  async scan() {
    const mode = await getSystemMode();
    return [
      {
        priority: "info" as const,
        title: `System mode: ${mode}`,
      },
    ];
  },
});
