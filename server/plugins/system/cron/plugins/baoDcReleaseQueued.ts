/**
 * BAO Disability Credit — release queued grant months.
 *
 * A DC approval queues any month whose resulting coverage month (work month
 * + eligibility lag) lies beyond current+1. This cron promotes those months
 * as they enter the window: oldest work month first (earlier queued months
 * take priority over newer grants), re-resolving threshold + shortfall at
 * release time so the grant reflects the latest employer reporting. A month
 * whose employer hours meanwhile reached the threshold is removed instead
 * (restoring annual capacity). Idempotent — a released month is `granted`
 * and never picked up again.
 */
import { z } from "zod";
import type { JsonSchema } from "@shared/json-schema-form";
import { storage } from "../../../../storage";
import { registerCronPlugin } from "../registry";
import type { CronJobContext, CronJobResult } from "../types";
import {
  isCoverageMonthDue,
  releaseDueQueuedMonthsForWorker,
  resolveContinuationRequirement,
} from "../../../../services/sitespecific/bao/dc-grant";
import { logger } from "../../../../logger";

const settingsSchema = z.object({
  maxWorkersPerRun: z.number().int().min(1).max(500).default(50),
});

const configSchema: JsonSchema = {
  type: "object",
  properties: {
    maxWorkersPerRun: {
      type: "integer",
      title: "Max Workers Per Run",
      description: "Upper bound on distinct workers whose queued months are released per run",
      minimum: 1,
      maximum: 500,
      default: 50,
    },
  },
};

type Settings = z.infer<typeof settingsSchema>;
const DEFAULT_SETTINGS: Settings = { maxWorkersPerRun: 50 };

registerCronPlugin({
  metadata: {
    id: "bao-dc-release-queued",
    name: "BAO DC — Release Queued Grant Months",
    description:
      "Grants queued Disability Credit months whose resulting coverage month has entered the current+1 window (oldest first)",
    requiredComponent: "sitespecific.bao",
    singleton: true,
  },
  defaultSchedule: "0 5 * * *", // daily, early morning
  // Enabled out of the box: queued months MUST release as their coverage
  // month enters the window without a separate deployment configuration
  // step — queue-and-release is one workflow.
  defaultEnabled: true,

  settingsSchema,
  configSchema,

  getDefaultSettings: () => DEFAULT_SETTINGS,

  async execute(context: CronJobContext): Promise<CronJobResult> {
    const settings = settingsSchema.parse({ ...DEFAULT_SETTINGS, ...context.settings });

    // Queued months across all workers, oldest work month first — worker
    // order therefore follows the oldest queued month each worker holds.
    const queued = await storage.baoDisabilityCredit.listQueuedMonths();
    const workerOrder: string[] = [];
    for (const m of queued) {
      if (!workerOrder.includes(m.workerId)) workerOrder.push(m.workerId);
    }
    const workers = workerOrder.slice(0, settings.maxWorkersPerRun);

    if (context.mode === "test") {
      let due = 0;
      for (const m of queued) {
        try {
          const req = await resolveContinuationRequirement(m.workerId, m.workMonthYmd);
          if (isCoverageMonthDue(req.coverageMonthYmd)) due += 1;
        } catch {
          // Unresolvable configuration is reported by the real run.
        }
      }
      return {
        message: `Would evaluate ${queued.length} queued DC months across ${workerOrder.length} workers (${due} due for release)`,
        metadata: { queuedMonths: queued.length, workers: workerOrder.length, due },
      };
    }

    let released = 0;
    let removed = 0;
    let failedWorkers = 0;
    for (const workerId of workers) {
      try {
        const outcomes = await storage.baoDisabilityCredit.withWorkerSerialization(
          workerId,
          () => releaseDueQueuedMonthsForWorker(workerId, null),
        );
        released += outcomes.filter((o) => o.action === "granted").length;
        removed += outcomes.filter((o) => o.action === "removed").length;
      } catch (err) {
        failedWorkers += 1;
        logger.error("DC queued-month release failed for worker", {
          service: "cron-bao-dc-release-queued",
          workerId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return {
      message: `Released ${released} queued DC months (${removed} removed as no longer short) across ${workers.length} workers${failedWorkers ? `; ${failedWorkers} workers failed` : ""}`,
      metadata: { released, removed, workers: workers.length, failedWorkers },
    };
  },
});
