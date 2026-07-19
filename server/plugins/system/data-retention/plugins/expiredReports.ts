import { and, eq, lt } from "drizzle-orm";
import { wizardReportData } from "@shared/schema";
import type { RetentionPeriod, ReportData } from "@shared/wizard-types";
import { storage } from "../../../../storage";
import { wizardPluginRegistry } from "../../../wizards";
import { registerDataRetentionPlugin } from "../registry";

function getRetentionDays(retention: RetentionPeriod): number | null {
  switch (retention) {
    case "1day":
      return 1;
    case "7days":
      return 7;
    case "30days":
      return 30;
    case "1year":
      return 365;
    case "always":
      return null; // Never delete
    default:
      return null;
  }
}

function getCutoffDate(retentionDays: number): Date {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - retentionDays);
  return cutoff;
}

interface ReportTypeStats {
  reportType: string;
  reportTypeName: string;
  totalReports: number;
  runsDeleted: number;
}

/**
 * Deletes wizard report data that has exceeded each wizard's retention
 * setting. Replaces the legacy `delete-expired-reports` cron job. The legacy
 * job used a bulk delete-with-criteria storage method; this plugin reads the
 * expired row ids inline and deletes each row through the per-row storage
 * delete for consistency with the other retention plugins.
 */
registerDataRetentionPlugin({
  metadata: {
    id: "delete-expired-reports",
    name: "Delete Expired Reports",
    description: "Deletes wizard report data that has exceeded its retention period",
    needsReadOnlyDb: true,
    singleton: true,
  },

  async cleanup(mode) {
    let totalRunsDeleted = 0;
    const statsByType: Record<string, ReportTypeStats> = {};

    const allWizards = await storage.wizards.listAll();
    const reportWizards = allWizards.filter(
      (wizard) => wizardPluginRegistry.get(wizard.type)?.isReport ?? false,
    );

    for (const wizard of reportWizards) {
      if (!statsByType[wizard.type]) {
        const wizardDef = wizardPluginRegistry.get(wizard.type);
        statsByType[wizard.type] = {
          reportType: wizard.type,
          reportTypeName: wizardDef?.name || wizard.type,
          totalReports: 0,
          runsDeleted: 0,
        };
      }
      statsByType[wizard.type].totalReports++;
    }

    for (const wizard of reportWizards) {
      const wizardData = wizard.data as ReportData | null;
      const retention = wizardData?.retention || "30days";
      const retentionDays = getRetentionDays(retention);

      if (retentionDays === null) {
        continue;
      }

      const cutoffDate = getCutoffDate(retentionDays);

      const expiredRows = await storage.readOnly.query(async (client) =>
        client
          .select({ id: wizardReportData.id })
          .from(wizardReportData)
          .where(
            and(
              eq(wizardReportData.wizardId, wizard.id),
              lt(wizardReportData.createdAt, cutoffDate),
            ),
          ),
      );

      if (mode === "test") {
        totalRunsDeleted += expiredRows.length;
        statsByType[wizard.type].runsDeleted += expiredRows.length;
        continue;
      }

      for (const row of expiredRows) {
        const deleted = await storage.wizards.deleteReportDataById(row.id);
        if (deleted) {
          totalRunsDeleted++;
          statsByType[wizard.type].runsDeleted++;
        }
      }
    }

    const reportTypes = Object.values(statsByType);
    const typesWithDeletions = reportTypes.filter((t) => t.runsDeleted > 0);

    const verb = mode === "test" ? "Would delete" : "Deleted";
    const message =
      totalRunsDeleted > 0
        ? `${verb} ${totalRunsDeleted} expired report runs across ${typesWithDeletions.length} report types`
        : "No expired report data to delete";

    return {
      count: totalRunsDeleted,
      message,
      metadata: {
        reportWizardCount: reportWizards.length,
        reportTypes: typesWithDeletions,
      },
    };
  },
});
