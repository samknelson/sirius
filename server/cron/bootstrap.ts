import { db } from "../db";
import { cronJobs } from "@shared/schema";
import { eq } from "drizzle-orm";
import { logger } from "../logger";
import { cronJobRegistry } from "./registry";

interface DefaultCronJob {
  name: string;
  description: string;
  schedule: string;
  isEnabled: boolean;
}

const DEFAULT_CRON_JOBS: DefaultCronJob[] = [
  {
    name: 'delete-expired-reports',
    description: 'Deletes wizard report data that has exceeded its retention period',
    schedule: '0 2 * * *', // Daily at 2 AM
    isEnabled: true,
  },
];

export async function bootstrapCronJobs(): Promise<void> {
  logger.info('Bootstrapping default cron jobs', { service: 'cron-bootstrap' });

  let created = 0;
  let skipped = 0;
  let errors = 0;

  for (const defaultJob of DEFAULT_CRON_JOBS) {
    try {
      // Check if handler is registered
      if (!cronJobRegistry.has(defaultJob.name)) {
        logger.warn(`Skipping job "${defaultJob.name}" - no handler registered`, {
          service: 'cron-bootstrap',
        });
        skipped++;
        continue;
      }

      // Check if job already exists in database
      const existing = await db
        .select()
        .from(cronJobs)
        .where(eq(cronJobs.name, defaultJob.name));

      if (existing.length > 0) {
        logger.debug(`Cron job "${defaultJob.name}" already exists`, {
          service: 'cron-bootstrap',
          jobId: existing[0].id,
        });
        skipped++;
        continue;
      }

      // Create the job
      const [job] = await db
        .insert(cronJobs)
        .values({
          name: defaultJob.name,
          description: defaultJob.description,
          schedule: defaultJob.schedule,
          isEnabled: defaultJob.isEnabled,
        })
        .returning();

      logger.info(`Created default cron job: ${defaultJob.name}`, {
        service: 'cron-bootstrap',
        jobId: job.id,
        schedule: defaultJob.schedule,
        isEnabled: defaultJob.isEnabled,
      });
      created++;

    } catch (error) {
      logger.error(`Failed to bootstrap cron job: ${defaultJob.name}`, {
        service: 'cron-bootstrap',
        error: error instanceof Error ? error.message : String(error),
      });
      errors++;
    }
  }

  logger.info('Cron job bootstrap completed', {
    service: 'cron-bootstrap',
    created,
    skipped,
    errors,
    total: DEFAULT_CRON_JOBS.length,
  });
}
