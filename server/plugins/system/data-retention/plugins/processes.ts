import { z } from "zod";
import { storage } from "../../../../storage";
import { registerDataRetentionPlugin } from "../registry";
import type { DataRetentionPlugin } from "../types";

const settingsSchema = z.object({ retentionDays: z.number().int().min(1).max(36500).default(10) });
export const processesRetentionPlugin: DataRetentionPlugin = {
  metadata: {
    id: "delete-old-processes", name: "Process Registry Retention",
    description: "Deletes ended processes by end time and unended processes by last heartbeat; healthy long-lived processes are retained.",
    singleton: true,
  },
  defaultEnabled: true,
  getDefaultSettings: () => ({ retentionDays: 10 }),
  configSchema: {
    type: "object",
    properties: { retentionDays: { type: "integer", title: "Retention period (days)", minimum: 1, maximum: 36500, default: 10 } },
  },
  async cleanup(mode, settings = {}) {
    const parsed = settingsSchema.safeParse(settings);
    if (!parsed.success) throw new Error("Process retention requires whole days between 1 and 36500");
    const cutoff = new Date(Date.now() - parsed.data.retentionDays * 86_400_000);
    const limit = 1000;
    const metadata = { cutoff: cutoff.toISOString(), limit, retentionDays: parsed.data.retentionDays };
    if (mode === "test") {
      const eligibleCount = await storage.processes.countExpired(cutoff);
      return { count: Math.min(limit, eligibleCount), message: `Would delete up to ${Math.min(limit, eligibleCount)} expired processes`, metadata: { ...metadata, eligibleCount } };
    }
    const ids = await storage.processes.getExpiredIds(cutoff, limit);
    let count = 0;
    for (const id of ids) if (await storage.processes.deleteExpired(id, cutoff)) count++;
    return { count, message: `Deleted ${count} expired processes`, metadata };
  },
};
registerDataRetentionPlugin(processesRetentionPlugin);
