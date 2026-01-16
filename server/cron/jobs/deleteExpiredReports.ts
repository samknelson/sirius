import { storage } from "../../storage";
import { logger } from "../../logger";
import type { CronJobHandler, CronJobContext, CronJobSummary } from "../registry";
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
  
  async execute(context: CronJobContext): Promise<CronJobSummary> {
    logger.info('Starting expired report cleanup', {
      service: 'cron-delete-expired-reports',
      jobId: context.jobId,
      mode: context.mode,
    });

    let totalRunsDeleted = 0;
    const statsByType: Record<string, ReportTypeStats> = {};

    try {
      // Get all wizards that are reports
      const allWizards = await storage.wizards.listAll();

      // Filter to only report wizards
      const reportWizards = allWizards.filter(wizard => 
        wizardRegistry.isReportWizard(wizard.type)
      );

      logger.info(`Found ${reportWizards.length} report wizards to check`, {
        service: 'cron-delete-expired-reports',
        jobId: context.jobId,
        mode: context.mode,
      });

      // Initialize stats for each report type
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

      // Process each report wizard
      for (const wizard of reportWizards) {
        try {
          const wizardData = wizard.data as ReportData | null;
          const retention = wizardData?.retention || '30days'; // Default to 30 days
          const retentionDays = getRetentionDays(retention);

        // Skip if retention is 'always'
        if (retentionDays === null) {
          logger.debug(`Skipping wizard ${wizard.id} (${wizard.type}) - retention set to 'always'`, {
            service: 'cron-delete-expired-reports',
          });
          continue;
        }

        const cutoffDate = getCutoffDate(retentionDays);

        // In test mode, count but don't delete
        if (context.mode === 'test') {
          const toDeleteCount = await storage.wizards.countExpiredReportData(wizard.id, cutoffDate);

          if (toDeleteCount > 0) {
            totalRunsDeleted += toDeleteCount;
            statsByType[wizard.type].runsDeleted += toDeleteCount;
            
            logger.info(`[TEST MODE] Would delete ${toDeleteCount} expired records from wizard ${wizard.id}`, {
              service: 'cron-delete-expired-reports',
              wizardId: wizard.id,
              wizardType: wizard.type,
              retention,
              retentionDays,
              cutoffDate: cutoffDate.toISOString(),
            });
          }
        } else {
          // Live mode: actually delete the records
          const deletedCount = await storage.wizards.deleteExpiredReportData(wizard.id, cutoffDate);

          if (deletedCount > 0) {
            totalRunsDeleted += deletedCount;
            statsByType[wizard.type].runsDeleted += deletedCount;
            
            logger.info(`Deleted ${deletedCount} expired records from wizard ${wizard.id}`, {
              service: 'cron-delete-expired-reports',
              wizardId: wizard.id,
              wizardType: wizard.type,
              retention,
              retentionDays,
              cutoffDate: cutoffDate.toISOString(),
            });
          }
        }
        } catch (wizardError) {
          logger.error(`Failed to process wizard ${wizard.id}`, {
            service: 'cron-delete-expired-reports',
            wizardId: wizard.id,
            wizardType: wizard.type,
            error: wizardError instanceof Error ? wizardError.message : String(wizardError),
          });
          // Continue processing other wizards even if one fails
        }
      }

      const reportTypes = Object.values(statsByType);

      logger.info(`Expired report cleanup completed`, {
        service: 'cron-delete-expired-reports',
        jobId: context.jobId,
        mode: context.mode,
        totalRunsDeleted,
        reportTypes,
      });

      return {
        totalRunsDeleted,
        reportTypes,
        mode: context.mode,
      };

    } catch (error) {
      logger.error('Failed to delete expired reports', {
        service: 'cron-delete-expired-reports',
        jobId: context.jobId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  },
};
