import { storage } from "../storage";
import { getTodayYmd, isYmdBefore } from "@shared/utils/date";
import { logger } from "../logger";
import type { PollPhaseResult, PollResult, DispatchJobData } from "@shared/schema";
import { createDispatchEligibleWorkersStorage } from "../storage/dispatch-eligible-workers";

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
  const job = await storage.dispatchJobs.getWithRelations(ctx.jobId);
  if (!job) {
    ctx.phases.push({
      phase: "expire",
      status: "failed",
      message: "Job not found",
    });
    ctx.exitedAtPhase = "expire";
    ctx.shouldExit = true;
    return;
  }

  const jobData = job.data as DispatchJobData | undefined;
  const jobTypeData = job.jobType?.data as import("@shared/schema").JobTypeData | undefined;
  const offerTimeout = jobData?.offerTimeout ?? jobTypeData?.offerTimeout;

  if (offerTimeout == null) {
    ctx.phases.push({
      phase: "expire",
      status: "passed",
      message: "No offer timeout configured, nothing to expire",
    });
    return;
  }

  const allDispatches = await storage.dispatches.getByJob(ctx.jobId);
  const expirable = allDispatches.filter(
    (d) => d.status === "pending" || d.status === "notified"
  );

  if (expirable.length === 0) {
    ctx.phases.push({
      phase: "expire",
      status: "passed",
      message: "No pending or notified dispatches to expire",
    });
    return;
  }

  const now = Date.now();
  const timeoutMs = offerTimeout * 60 * 1000;

  const expired: { id: string; workerName: string; status: string }[] = [];
  const notExpired: { id: string; workerName: string; ageMinutes: number }[] = [];
  const errors: { id: string; workerName: string; error: string }[] = [];

  for (const dispatch of expirable) {
    const createdAt = new Date(dispatch.createdAt).getTime();
    const ageMs = now - createdAt;
    const ageMinutes = Math.round(ageMs / 60000);
    const workerName = getDispatchWorkerName(dispatch);

    if (ageMs >= timeoutMs) {
      if (ctx.mode === "live") {
        const result = await storage.dispatches.setStatus(dispatch.id, "declined");
        if (result.success) {
          expired.push({ id: dispatch.id, workerName, status: dispatch.status });
          logger.info("Poll expired dispatch", {
            service: SERVICE_NAME,
            dispatchId: dispatch.id,
            workerName,
            previousStatus: dispatch.status,
            ageMinutes,
            offerTimeout,
          });
        } else {
          errors.push({ id: dispatch.id, workerName, error: result.error ?? "Unknown error" });
        }
      } else {
        expired.push({ id: dispatch.id, workerName, status: dispatch.status });
      }
    } else {
      notExpired.push({ id: dispatch.id, workerName, ageMinutes });
    }
  }

  const expiredNames = expired.map((e) => e.workerName);
  const actionWord = ctx.mode === "live" ? "Declined" : "Would decline";

  if (expired.length > 0) {
    ctx.phases.push({
      phase: "expire",
      status: "passed",
      message: `${actionWord} ${expired.length} dispatch(es): ${expiredNames.join(", ")}`,
      details: {
        offerTimeout,
        expired,
        notExpired: notExpired.length,
        errors: errors.length > 0 ? errors : undefined,
      },
    });
  } else {
    ctx.phases.push({
      phase: "expire",
      status: "passed",
      message: `No dispatches exceeded the ${offerTimeout}-minute timeout (${notExpired.length} still within window)`,
      details: {
        offerTimeout,
        notExpired,
      },
    });
  }
}

function getDispatchWorkerName(dispatch: { worker?: { contact?: { given: string | null; family: string | null; displayName: string | null } | null } | null }): string {
  const contact = dispatch.worker?.contact;
  if (!contact) return "Unknown Worker";
  if (contact.displayName) return contact.displayName;
  const name = `${contact.given || ""} ${contact.family || ""}`.trim();
  return name || "Unknown Worker";
}

async function phaseCreate(ctx: PollContext): Promise<void> {
  const job = await storage.dispatchJobs.getWithRelations(ctx.jobId);
  if (!job) {
    ctx.phases.push({
      phase: "create",
      status: "failed",
      message: "Job not found",
    });
    ctx.exitedAtPhase = "create";
    ctx.shouldExit = true;
    return;
  }

  const jobData = job.data as DispatchJobData | undefined;
  const jobTypeData = job.jobType?.data as import("@shared/schema").JobTypeData | undefined;
  const offerRatio = jobData?.offerRatio ?? jobTypeData?.offerRatio;

  if (offerRatio == null) {
    ctx.phases.push({
      phase: "create",
      status: "failed",
      message: "Offer ratio is not configured. Set it on the job or its job type before running the poll.",
      details: { jobId: ctx.jobId, jobTypeId: job.jobTypeId },
    });
    if (ctx.mode === "live") {
      ctx.exitedAtPhase = "create";
      ctx.shouldExit = true;
    }
    return;
  }

  const workerCount = job.workerCount ?? 0;
  if (workerCount <= 0) {
    ctx.phases.push({
      phase: "create",
      status: "passed",
      message: "Job has no positions (workerCount is 0), nothing to create",
      details: { workerCount },
    });
    return;
  }

  const allDispatches = await storage.dispatches.getByJob(ctx.jobId);
  const activeCount = allDispatches.filter(
    (d) => d.status === "pending" || d.status === "notified" || d.status === "accepted"
  ).length;

  const openSlots = workerCount - activeCount;
  if (openSlots <= 0) {
    ctx.phases.push({
      phase: "create",
      status: "passed",
      message: `No open slots (${activeCount} active dispatches for ${workerCount} positions)`,
      details: { workerCount, activeCount, openSlots: 0 },
    });
    return;
  }

  const toCreate = Math.floor(openSlots * offerRatio);
  if (toCreate <= 0) {
    ctx.phases.push({
      phase: "create",
      status: "passed",
      message: `Ratio calculation resulted in 0 dispatches (${openSlots} open slots × ${offerRatio} ratio)`,
      details: { workerCount, activeCount, openSlots, offerRatio, toCreate: 0 },
    });
    return;
  }

  const eligibleWorkersStorage = createDispatchEligibleWorkersStorage();
  const eligResult = await eligibleWorkersStorage.getEligibleWorkersForJob(
    ctx.jobId, toCreate, 0, { excludeWithDispatches: true }
  );

  if (eligResult.workers.length === 0) {
    ctx.phases.push({
      phase: "create",
      status: "passed",
      message: `No eligible workers available (needed ${toCreate})`,
      details: { workerCount, activeCount, openSlots, offerRatio, toCreate, eligibleAvailable: 0 },
    });
    return;
  }

  const workersToDispatch = eligResult.workers.slice(0, toCreate);
  const created: { workerId: string; workerName: string; dispatchId: string }[] = [];
  const errors: { workerId: string; workerName: string; error: string }[] = [];

  if (ctx.mode === "live") {
    for (const worker of workersToDispatch) {
      try {
        const dispatch = await storage.dispatches.create({
          jobId: ctx.jobId,
          workerId: worker.id,
          status: "pending",
        });

        created.push({ workerId: worker.id, workerName: worker.displayName, dispatchId: dispatch.id });
        logger.info("Poll created dispatch", {
          service: SERVICE_NAME,
          jobId: ctx.jobId,
          dispatchId: dispatch.id,
          workerId: worker.id,
          workerName: worker.displayName,
        });
      } catch (err) {
        errors.push({
          workerId: worker.id,
          workerName: worker.displayName,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  } else {
    for (const worker of workersToDispatch) {
      created.push({ workerId: worker.id, workerName: worker.displayName, dispatchId: "(test)" });
    }
  }

  const createdNames = created.map((c) => c.workerName);
  const actionWord = ctx.mode === "live" ? "Created" : "Would create";

  const hasErrors = errors.length > 0;
  const phaseStatus = hasErrors ? "failed" : "passed";

  ctx.phases.push({
    phase: "create",
    status: phaseStatus,
    message: created.length > 0
      ? `${actionWord} ${created.length} dispatch(es): ${createdNames.join(", ")}${hasErrors ? ` (${errors.length} error(s))` : ""}`
      : hasErrors ? `Failed to create dispatches (${errors.length} error(s))` : `No dispatches created`,
    details: {
      workerCount,
      activeCount,
      openSlots,
      offerRatio,
      toCreate,
      eligibleAvailable: eligResult.workers.length,
      created,
      errors: errors.length > 0 ? errors : undefined,
    },
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
