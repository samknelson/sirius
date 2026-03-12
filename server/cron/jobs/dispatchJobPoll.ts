import { CronJobHandler, CronJobContext, CronJobResult } from "../registry";
import { storage } from "../../storage";
import { runPoll } from "../../services/dispatch-poll";
import { logger } from "../../logger";

export const dispatchJobPollHandler: CronJobHandler = {
  description: 'Polls all open, running dispatch jobs to process eligible workers',
  requiresComponent: 'dispatch',

  async execute(context: CronJobContext): Promise<CronJobResult> {
    const filters = { status: 'open' as const, running: true };
    const pageSize = 100;
    let page = 0;
    const jobs: Array<{ id: string; title: string }> = [];

    while (true) {
      const result = await storage.dispatchJobs.getPaginated(page, pageSize, filters);
      jobs.push(...result.data.map(j => ({ id: j.id, title: j.title })));
      if (jobs.length >= result.total) break;
      page++;
    }

    if (jobs.length === 0) {
      return {
        message: 'No open, running dispatch jobs found',
        metadata: { jobCount: 0 },
      };
    }

    const pollResults: Array<{ jobId: string; title: string; message: string; error?: string }> = [];

    for (const job of jobs) {
      try {
        const pollResult = await runPoll(job.id, context.mode === 'test' ? 'test' : 'live');
        pollResults.push({
          jobId: job.id,
          title: job.title,
          message: pollResult.message || 'Poll completed',
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error(`Dispatch job poll failed for job ${job.id}`, {
          service: 'dispatch-job-poll',
          jobId: job.id,
          error: errorMessage,
        });
        pollResults.push({
          jobId: job.id,
          title: job.title,
          message: 'Poll failed',
          error: errorMessage,
        });
      }
    }

    const succeeded = pollResults.filter(r => !r.error).length;
    const failed = pollResults.filter(r => r.error).length;

    return {
      message: `Polled ${jobs.length} job(s): ${succeeded} succeeded, ${failed} failed`,
      metadata: { jobCount: jobs.length, succeeded, failed, results: pollResults },
    };
  },
};
