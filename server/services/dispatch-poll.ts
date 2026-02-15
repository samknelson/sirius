import { storage } from "../storage";
import { getTodayYmd, isYmdBefore } from "@shared/utils/date";
import { logger } from "../logger";
import type { PollPhaseResult, PollResult, DispatchJobData } from "@shared/schema";

const SERVICE_NAME = "dispatch-poll";

interface PollContext {
  jobId: string;
  mode: "test" | "live";
  phases: PollPhaseResult[];
  exitedAtPhase?: string;
  shouldExit: boolean;
}

async function phaseValidate(ctx: PollContext): Promise<void> {
  const job = await storage.dispatchJobs.get(ctx.jobId);
  if (!job) {
    ctx.phases.push({
      phase: "validate",
      status: "failed",
      message: "Job not found",
    });
    ctx.exitedAtPhase = "validate";
    ctx.shouldExit = true;
    return;
  }

  const issues: string[] = [];
  if (job.status !== "open") {
    issues.push(`Job status is "${job.status}", expected "open"`);
  }
  if (!job.running) {
    issues.push("Job is not running");
  }

  if (issues.length > 0) {
    ctx.phases.push({
      phase: "validate",
      status: "failed",
      message: issues.join("; "),
      details: { status: job.status, running: job.running },
    });
    if (ctx.mode === "live") {
      ctx.exitedAtPhase = "validate";
      ctx.shouldExit = true;
    }
    return;
  }

  ctx.phases.push({
    phase: "validate",
    status: "passed",
    message: "Job is open and running",
    details: { status: job.status, running: job.running },
  });
}

async function phaseFinalize(ctx: PollContext): Promise<void> {
  const job = await storage.dispatchJobs.getWithRelations(ctx.jobId);
  if (!job) {
    ctx.phases.push({
      phase: "finalize",
      status: "failed",
      message: "Job not found",
    });
    ctx.exitedAtPhase = "finalize";
    ctx.shouldExit = true;
    return;
  }

  const today = getTodayYmd();
  const reportDatePassed = isYmdBefore(job.startYmd, today);
  const acceptedCount = job.acceptedCount ?? 0;
  const workerCount = job.workerCount ?? 0;
  const isFull = workerCount > 0 && acceptedCount >= workerCount;

  if (reportDatePassed || isFull) {
    const reasons: string[] = [];
    if (reportDatePassed) reasons.push(`Report date ${job.startYmd} has passed (today: ${today})`);
    if (isFull) reasons.push(`Job is full (${acceptedCount}/${workerCount} accepted)`);

    if (ctx.mode === "live") {
      await storage.dispatchJobs.update(ctx.jobId, {
        status: "closed",
        running: false,
      });

      ctx.phases.push({
        phase: "finalize",
        status: "passed",
        message: `Job closed: ${reasons.join("; ")}`,
        details: {
          reportDatePassed,
          isFull,
          acceptedCount,
          workerCount,
          startYmd: job.startYmd,
          today,
          action: "closed",
        },
      });

      logger.info("Poll finalized job", {
        service: SERVICE_NAME,
        jobId: ctx.jobId,
        reasons,
      });
    } else {
      ctx.phases.push({
        phase: "finalize",
        status: "passed",
        message: `Would close job: ${reasons.join("; ")}`,
        details: {
          reportDatePassed,
          isFull,
          acceptedCount,
          workerCount,
          startYmd: job.startYmd,
          today,
          action: "would_close",
        },
      });
    }

    ctx.exitedAtPhase = "finalize";
    ctx.shouldExit = true;
    return;
  }

  ctx.phases.push({
    phase: "finalize",
    status: "passed",
    message: "No finalization needed",
    details: {
      reportDatePassed,
      isFull,
      acceptedCount,
      workerCount,
      startYmd: job.startYmd,
      today,
    },
  });
}

async function phaseExpire(ctx: PollContext): Promise<void> {
  ctx.phases.push({
    phase: "expire",
    status: "stub",
    message: "Expire phase not yet implemented",
  });
}

async function phaseCreate(ctx: PollContext): Promise<void> {
  ctx.phases.push({
    phase: "create",
    status: "stub",
    message: "Create phase not yet implemented",
  });
}

export async function runPoll(jobId: string, mode: "test" | "live"): Promise<PollResult> {
  const ctx: PollContext = {
    jobId,
    mode,
    phases: [],
    shouldExit: false,
  };

  logger.info("Starting poll", { service: SERVICE_NAME, jobId, mode });

  await phaseValidate(ctx);

  if (!ctx.shouldExit) {
    await phaseFinalize(ctx);
  }

  if (!ctx.shouldExit) {
    await phaseExpire(ctx);
  }

  if (!ctx.shouldExit) {
    await phaseCreate(ctx);
  }

  const result = buildResult(ctx);

  if (mode === "live") {
    await storePollResult(jobId, result);
  }

  return result;
}

function buildResult(ctx: PollContext): PollResult {
  return {
    mode: ctx.mode,
    timestamp: new Date().toISOString(),
    phases: ctx.phases,
    exitedAtPhase: ctx.exitedAtPhase,
  };
}

async function storePollResult(jobId: string, result: PollResult): Promise<void> {
  try {
    const job = await storage.dispatchJobs.get(jobId);
    if (!job) return;

    const existingData = (job.data as DispatchJobData) || {};
    const updatedData: DispatchJobData = {
      ...existingData,
      lastPollResult: result,
    };

    await storage.dispatchJobs.update(jobId, { data: updatedData });

    logger.info("Stored poll result", { service: SERVICE_NAME, jobId });
  } catch (error) {
    logger.error("Failed to store poll result", {
      service: SERVICE_NAME,
      jobId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
