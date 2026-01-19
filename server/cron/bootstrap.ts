import { storage } from "../storage";
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
  {
    name: 'delete-old-cron-logs',
    description: 'Deletes cron job run logs that are older than 30 days',
    schedule: '0 3 * * *', // Daily at 3 AM
    isEnabled: true,
  },
  {
    name: 'process-wmb-batch',
    description: 'Processes pending WMB scan jobs from the queue in batches',
    schedule: '*/5 * * * *', // Every 5 minutes
    isEnabled: false, // Disabled by default - enable when needed
  },
  {
    name: 'delete-expired-flood-events',
    description: 'Deletes flood control events that have expired',
    schedule: '0 * * * *', // Every hour at minute 0
    isEnabled: true,
  },
  {
    name: 'delete-expired-hfe',
    description: 'Deletes Hold for Employer entries where the hold date has passed',
    schedule: '0 4 * * *', // Daily at 4 AM
    isEnabled: true,
  },
  {
    name: 'sweep-expired-ban-elig',
    description: 'Clears dispatch eligibility entries for expired worker bans',
    schedule: '0 5 * * *', // Daily at 5 AM
    isEnabled: true,
  },
  {
    name: 'worker-ban-active-scan',
    description: 'Scans worker bans and updates their active status based on expiration dates',
    schedule: '0 6 * * *', // Daily at 6 AM
    isEnabled: true,
  },
  {
    name: 'log-cleanup',
    description: 'Purges log entries based on configurable retention policies per module/operation combination',
    schedule: '0 3 * * *', // Daily at 3 AM
    isEnabled: false, // Disabled by default - must configure policies first
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
      const existing = await storage.cronJobs.getByName(defaultJob.name);

      if (existing) {
        logger.debug(`Cron job "${defaultJob.name}" already exists`, {
          service: 'cron-bootstrap',
          jobName: existing.name,
        });
        skipped++;
        continue;
      }

      // Create the job
      const job = await storage.cronJobs.create({
        name: defaultJob.name,
        description: defaultJob.description,
        schedule: defaultJob.schedule,
        isEnabled: defaultJob.isEnabled,
      });

      logger.info(`Created default cron job: ${defaultJob.name}`, {
        service: 'cron-bootstrap',
        jobName: job.name,
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
