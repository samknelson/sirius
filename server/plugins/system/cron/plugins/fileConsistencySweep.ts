import { z } from "zod";
import type { JsonSchema } from "@shared/json-schema-form";
import { storage } from "../../../../storage";
import { logger } from "../../../../logger";
import { registerCronPlugin } from "../registry";
import type { CronJobContext, CronJobResult } from "../types";
import { listFileSystemConfigs } from "../../../../services/files";
import { sweepFileSystem, type FileSystemSweepResult } from "../../../../services/files/sweep";

const settingsSchema = z.object({
  /** Days a pending_delete orphan row must age before its object is deleted. */
  graceDays: z.number().int().min(1).max(365).default(7),
  /** Master switch for the deletion phase; off = record orphans only. */
  deleteOrphans: z.boolean().default(false),
});

const DEFAULT_SETTINGS = settingsSchema.parse({});

const configSchema: JsonSchema = {
  type: "object",
  properties: {
    graceDays: {
      type: "integer",
      title: "Orphan grace period (days)",
      description:
        "An orphaned file is only deleted after its pending-delete record has aged at least this many days.",
      minimum: 1,
      maximum: 365,
      default: 7,
    },
    deleteOrphans: {
      type: "boolean",
      title: "Delete confirmed orphans",
      description:
        "When off (default), the sweep only records orphaned files as pending-delete. Turn on to actually delete objects whose pending-delete record has passed the grace period.",
      default: false,
    },
  },
};

registerCronPlugin({
  metadata: {
    id: "file-consistency-sweep",
    name: "File Consistency Sweep",
    description:
      "Reconciles the files table with each configured filesystem: marks rows whose file is gone as missing, records orphaned files for two-phase deletion, and refreshes stale size/mime type. Skips unconfigured or inaccessible filesystems.",
    singleton: true,
  },
  defaultSchedule: "30 4 * * *", // Daily at 4:30 AM
  defaultEnabled: false,

  settingsSchema,
  configSchema,

  getDefaultSettings: () => DEFAULT_SETTINGS,

  async execute(context: CronJobContext): Promise<CronJobResult> {
    const settings = settingsSchema.parse({
      ...DEFAULT_SETTINGS,
      ...context.settings,
    });
    const dryRun = context.mode === "test";

    const configured = listFileSystemConfigs();
    const configuredIds = new Set(configured.map((c) => c.id));

    // Rows whose filesystem is not configured are skipped entirely — a
    // misconfigured filesystem must never cause rows to be marked missing.
    const dbIds = await storage.files.listDistinctFileSystemIds();
    const unconfigured = dbIds.filter((id) => !configuredIds.has(id));

    const results: FileSystemSweepResult[] = [];
    for (const config of configured) {
      const result = await sweepFileSystem(config.id, {
        dryRun,
        deleteOrphans: settings.deleteOrphans,
        graceDays: settings.graceDays,
      });
      results.push(result);
      logger.info(`Sweep finished for filesystem "${config.id}"`, {
        service: "file-consistency-sweep",
        ...result,
      });
    }

    const totals = results.reduce(
      (acc, r) => ({
        markedMissing: acc.markedMissing + r.markedMissing,
        refreshed: acc.refreshed + r.refreshed,
        orphansRecorded: acc.orphansRecorded + r.orphansRecorded,
        orphansDeleted: acc.orphansDeleted + r.orphansDeleted,
        errors: acc.errors + r.errors,
      }),
      { markedMissing: 0, refreshed: 0, orphansRecorded: 0, orphansDeleted: 0, errors: 0 },
    );
    const skippedInaccessible = results.filter((r) => r.skipped).map((r) => r.fileSystemId);
    const prefix = dryRun ? "[TEST] " : "";
    const parts = [
      `${totals.markedMissing} marked missing`,
      `${totals.orphansRecorded} orphans recorded`,
      `${totals.orphansDeleted} orphans deleted`,
      `${totals.refreshed} metadata refreshed`,
      `${totals.errors} errors`,
    ];
    const skippedParts: string[] = [];
    if (unconfigured.length > 0) skippedParts.push(`unconfigured: ${unconfigured.join(", ")}`);
    if (skippedInaccessible.length > 0) skippedParts.push(`inaccessible: ${skippedInaccessible.join(", ")}`);

    return {
      message:
        `${prefix}Swept ${results.length} filesystem(s): ${parts.join(", ")}` +
        (skippedParts.length > 0 ? ` — skipped ${skippedParts.join("; ")}` : ""),
      metadata: {
        ...totals,
        skippedUnconfigured: unconfigured,
        skippedInaccessible,
        perFileSystem: results,
      },
    };
  },
});
