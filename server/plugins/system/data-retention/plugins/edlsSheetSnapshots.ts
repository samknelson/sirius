import { eq, and, isNull, lt, or } from "drizzle-orm";
import { snapshots, edlsSheets } from "@shared/schema";
import { storage } from "../../../../storage";
import { registerDataRetentionPlugin } from "../registry";

/** Snapshots of sheets whose date is older than this many months are expired. */
const RETENTION_MONTHS = 6;

/**
 * Deletes snapshots of entity type `edls_sheet` whose sheet date
 * (`edls_sheets.ymd`) is more than 6 months old, plus orphaned edls_sheet
 * snapshots whose parent sheet no longer exists (regardless of age).
 *
 * Gated on the `edls` component because the join target `edls_sheets` is a
 * component-owned table that only exists while the component is enabled.
 */
registerDataRetentionPlugin({
  metadata: {
    id: "edls-sheet-snapshots",
    name: "Delete Old EDLS Sheet Snapshots",
    description:
      `Deletes edls_sheet snapshots whose sheet date is more than ${RETENTION_MONTHS} months old, and orphaned edls_sheet snapshots whose sheet no longer exists`,
    requiredComponent: "edls",
    needsReadOnlyDb: true,
    singleton: true,
  },

  async cleanup(mode) {
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - RETENTION_MONTHS);
    const cutoffYmd = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, "0")}-${String(cutoff.getDate()).padStart(2, "0")}`;

    const expired = await storage.readOnly.query(async (client) =>
      client
        .select({ id: snapshots.id, sheetYmd: edlsSheets.ymd })
        .from(snapshots)
        .leftJoin(edlsSheets, eq(edlsSheets.id, snapshots.entityId))
        .where(
          and(
            eq(snapshots.entityType, "edls_sheet"),
            or(
              // Sheet date older than the retention window.
              lt(edlsSheets.ymd, cutoffYmd),
              // Orphan: parent sheet no longer exists (any age).
              isNull(edlsSheets.id),
            ),
          ),
        ),
    );

    const orphanCount = expired.filter((row) => row.sheetYmd === null).length;

    if (mode === "test") {
      return {
        count: expired.length,
        message: `Would delete ${expired.length} edls_sheet snapshots (${orphanCount} orphaned)`,
        metadata: { orphanCount, cutoffYmd },
      };
    }

    let deletedCount = 0;
    for (const row of expired) {
      const deleted = await storage.snapshots.delete(row.id);
      if (deleted) deletedCount++;
    }

    return {
      count: deletedCount,
      message: `Deleted ${deletedCount} edls_sheet snapshots (${orphanCount} orphaned)`,
      metadata: { orphanCount, cutoffYmd },
    };
  },
});
