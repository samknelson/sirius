import { registerSystemStatusPlugin } from "../registry";
import type { StatusMessage } from "../types";
import {
  listFileSystemConfigs,
  getFileSystemProvider,
} from "../../../../services/files/registry";

registerSystemStatusPlugin({
  id: "filesystems",
  name: "Filesystems",
  description:
    "Checks every configured filesystem (from the FILESYSTEMS environment variable) is reachable.",
  async scan(): Promise<StatusMessage[]> {
    const configs = listFileSystemConfigs();
    if (configs.length === 0) {
      return [
        {
          priority: "notice",
          title: "No filesystems configured",
          details:
            "The FILESYSTEMS environment variable defines no filesystems. File features are unavailable.",
        },
      ];
    }
    const messages: StatusMessage[] = [];
    for (const config of configs) {
      try {
        const provider = getFileSystemProvider(config.id);
        // A stat() of a sentinel path is the cheapest end-to-end
        // reachability probe that works across ALL provider kinds — the
        // replit provider does not support list(), but stat() reaches the
        // bucket and returns null for a missing object.
        await provider.stat(".system-status-probe");
        messages.push({
          priority: "info",
          title: `${config.id}: working`,
          details: `Provider '${config.provider}' responded to a stat probe.`,
        });
      } catch (error) {
        messages.push({
          priority: "error",
          title: `${config.id}: failing`,
          details: `Provider '${config.provider}' probe failed — ${
            error instanceof Error ? error.message : String(error)
          }`,
        });
      }
    }
    return messages;
  },
});
