import { storage } from "../../storage";
import type { CronJobHandler, CronJobContext, CronJobResult } from "../registry";
import type { RetentionPeriod, ReportData } from "@shared/wizard-types";
import { wizardRegistry } from "../../wizards/registry";

function getRetentionDays(retention: RetentionPeriod): number | null {
  switch (retention) {
    case '1day':
      return 1;
    case '7days':
      return 7;
    case '30days':
      return 30;
    case '1year':
      return 365;
    case 'always':
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

export const deleteExpiredReportsHandler: CronJobHandler = {
  description: 'Deletes wizard report data that has exceeded its retention period',
  
  async execute(context: CronJobContext): Promise<CronJobResult> {
    let totalRunsDeleted = 0;
    const statsByType: Record<string, ReportTypeStats> = {};

    const allWizards = await storage.wizards.listAll();
    const reportWizards = allWizards.filter(wizard => 
      wizardRegistry.isReportWizard(wizard.type)
    );

    for (const wizard of reportWizards) {
      if (!statsByType[wizard.type]) {
        const wizardDef = wizardRegistry.get(wizard.type);
        statsByType[wizard.type] = {
          reportType: wizard.type,
          reportTypeName: wizardDef?.displayName || wizard.type,
          totalReports: 0,
          runsDeleted: 0,
        };
      }
      statsByType[wizard.type].totalReports++;
    }

    for (const wizard of reportWizards) {
      const wizardData = wizard.data as ReportData | null;
      const retention = wizardData?.retention || '30days';
      const retentionDays = getRetentionDays(retention);

      if (retentionDays === null) {
        continue;
      }

      const cutoffDate = getCutoffDate(retentionDays);

      if (context.mode === 'test') {
        const toDeleteCount = await storage.wizards.countExpiredReportData(wizard.id, cutoffDate);
        if (toDeleteCount > 0) {
          totalRunsDeleted += toDeleteCount;
          statsByType[wizard.type].runsDeleted += toDeleteCount;
        }
      } else {
        const deletedCount = await storage.wizards.deleteExpiredReportData(wizard.id, cutoffDate);
        if (deletedCount > 0) {
          totalRunsDeleted += deletedCount;
          statsByType[wizard.type].runsDeleted += deletedCount;
        }
      }
    }

    const reportTypes = Object.values(statsByType);
    const typesWithDeletions = reportTypes.filter(t => t.runsDeleted > 0);

    const verb = context.mode === 'test' ? 'Would delete' : 'Deleted';
    const message = totalRunsDeleted > 0
      ? `${verb} ${totalRunsDeleted} expired report runs across ${typesWithDeletions.length} report types`
      : 'No expired report data to delete';

    return {
      message,
      metadata: { 
        totalRunsDeleted, 
        reportWizardCount: reportWizards.length,
        reportTypes: typesWithDeletions,
      },
    };
  },
};
