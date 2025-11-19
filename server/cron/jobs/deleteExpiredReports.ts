import { db } from "../../db";
import { wizards, wizardReportData } from "@shared/schema";
import { and, lt, eq } from "drizzle-orm";
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

export const deleteExpiredReportsHandler: CronJobHandler = {
  description: 'Deletes wizard report data that has exceeded its retention period',
  
  async execute(context: CronJobContext): Promise<CronJobSummary> {
    logger.info('Starting expired report cleanup', {
      service: 'cron-delete-expired-reports',
      jobId: context.jobId,
      mode: context.mode,
    });

    let totalRecordsDeleted = 0;
    let wizardsWithExpiredData = 0;
    const reportsByRetention: Record<string, number> = {};

    try {
      // Get all wizards that are reports
      const allWizards = await db
        .select({
          id: wizards.id,
          type: wizards.type,
          data: wizards.data,
        })
        .from(wizards);

      // Filter to only report wizards
      const reportWizards = allWizards.filter(wizard => 
        wizardRegistry.isReportWizard(wizard.type)
      );

      logger.info(`Found ${reportWizards.length} report wizards to check`, {
        service: 'cron-delete-expired-reports',
        jobId: context.jobId,
        mode: context.mode,
      });

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
          const toDelete = await db
            .select()
            .from(wizardReportData)
            .where(
              and(
                eq(wizardReportData.wizardId, wizard.id),
                lt(wizardReportData.createdAt, cutoffDate)
              )
            );

          if (toDelete.length > 0) {
            totalRecordsDeleted += toDelete.length;
            wizardsWithExpiredData++;
            reportsByRetention[retention] = (reportsByRetention[retention] || 0) + toDelete.length;
            
            logger.info(`[TEST MODE] Would delete ${toDelete.length} expired records from wizard ${wizard.id}`, {
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
          const deleted = await db
            .delete(wizardReportData)
            .where(
              and(
                eq(wizardReportData.wizardId, wizard.id),
                lt(wizardReportData.createdAt, cutoffDate)
              )
            )
            .returning();

          if (deleted.length > 0) {
            totalRecordsDeleted += deleted.length;
            wizardsWithExpiredData++;
            reportsByRetention[retention] = (reportsByRetention[retention] || 0) + deleted.length;
            
            logger.info(`Deleted ${deleted.length} expired records from wizard ${wizard.id}`, {
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

      logger.info(`Expired report cleanup completed`, {
        service: 'cron-delete-expired-reports',
        jobId: context.jobId,
        mode: context.mode,
        totalRecordsDeleted,
        wizardsWithExpiredData,
        totalWizardsChecked: reportWizards.length,
        reportsByRetention,
      });

      return {
        totalRecordsDeleted,
        wizardsWithExpiredData,
        totalWizardsChecked: reportWizards.length,
        reportsByRetention,
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
