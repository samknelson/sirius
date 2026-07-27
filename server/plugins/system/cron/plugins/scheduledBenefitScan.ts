import { z } from "zod";
import type { JsonSchema, UiSchema } from "@shared/json-schema-form";
import { storage } from "../../../../storage";
import { registerCronPlugin } from "../registry";
import type { CronJobContext, CronJobResult } from "../types";
import {
  computeCoverageMonthPair,
  deriveSweepCronSchedule,
  isValidTimeZone,
  type CoverageMonthRef,
} from "../../../../services/benefit-scan-schedule";
import { getScanPopulationResolver } from "../../../../services/benefit-scan-populations";
import { logger } from "../../../../logger";

/** Trigger source identifying jobs enqueued by this scheduled sweep. */
export const SCHEDULED_SWEEP_TRIGGER_SOURCE = "scheduled_sweep";

const POPULATIONS = ["active_elections", "previous_month_benefit", "all_workers"] as const;

const settingsSchema = z
  .object({
    population: z.enum(POPULATIONS).default("active_elections"),
    frequency: z.enum(["weekly", "monthly"]).default("weekly"),
    dayOfWeek: z.number().int().min(0).max(6).optional(),
    dayOfMonth: z.number().int().min(1).max(28).optional(),
    runTime: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'runTime must be "HH:MM" 24-hour time')
      .default("02:00"),
    timeZone: z.string().default("America/Los_Angeles"),
    switchAnchorDay: z.number().int().min(1).max(28).default(15),
  })
  .superRefine((val, ctx) => {
    if (val.frequency === "weekly" && val.dayOfWeek === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["dayOfWeek"],
        message: "dayOfWeek (0=Sunday … 6=Saturday) is required for a weekly schedule",
      });
    }
    if (val.frequency === "monthly" && val.dayOfMonth === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["dayOfMonth"],
        message: "dayOfMonth (1–28) is required for a monthly schedule",
      });
    }
    if (!isValidTimeZone(val.timeZone)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["timeZone"],
        message: `Invalid IANA time zone "${val.timeZone}"`,
      });
    }
  });

type SweepSettings = z.infer<typeof settingsSchema>;

const DEFAULT_SETTINGS: Record<string, unknown> = {
  population: "active_elections",
  frequency: "weekly",
  dayOfWeek: 1,
  runTime: "02:00",
  timeZone: "America/Los_Angeles",
  switchAnchorDay: 15,
};

const configSchema: JsonSchema = {
  type: "object",
  properties: {
    population: {
      type: "string",
      title: "Population",
      description:
        "Who to enqueue, resolved per coverage month: workers with an active election in the coverage month; workers with a benefit in the month before the coverage month; or all workers.",
      enum: [...POPULATIONS],
      enumNames: [
        "Active elections (in coverage month)",
        "Previous-month benefit (month before coverage month)",
        "All workers",
      ],
      default: "active_elections",
    },
    frequency: {
      type: "string",
      title: "Frequency",
      enum: ["weekly", "monthly"],
      enumNames: ["Weekly", "Monthly"],
      default: "weekly",
    },
    dayOfWeek: {
      type: "integer",
      title: "Day of Week (weekly)",
      description: "Required when frequency is weekly.",
      enum: [0, 1, 2, 3, 4, 5, 6],
      enumNames: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
      default: 1,
    },
    dayOfMonth: {
      type: "integer",
      title: "Day of Month (monthly)",
      description: "Required when frequency is monthly. 1–28 so every month qualifies.",
      minimum: 1,
      maximum: 28,
    },
    runTime: {
      type: "string",
      title: "Run Time",
      description: '24-hour local time, e.g. "02:00".',
      default: "02:00",
    },
    timeZone: {
      type: "string",
      title: "Time Zone",
      description: "IANA time zone the schedule and coverage-month switch are evaluated in.",
      default: "America/Los_Angeles",
    },
    switchAnchorDay: {
      type: "integer",
      title: "Switch Anchor Day",
      description:
        "Runs on a day-of-month AFTER this day scan the run month and the next month; runs on/before it scan the previous month and the run month.",
      minimum: 1,
      maximum: 28,
      default: 15,
    },
  },
  required: ["population", "frequency", "runTime", "timeZone", "switchAnchorDay"],
};

const uiSchema: UiSchema = {
  "ui:order": [
    "population",
    "frequency",
    "dayOfWeek",
    "dayOfMonth",
    "runTime",
    "timeZone",
    "switchAnchorDay",
  ],
};

interface CoverageRunSummary {
  month: number;
  year: number;
  populationSize: number;
  enqueued: number;
  skippedAlreadyPending: number;
}

async function sweepCoverageMonth(
  settings: SweepSettings,
  coverage: CoverageMonthRef,
  mode: "live" | "test",
): Promise<CoverageRunSummary> {
  const resolver = getScanPopulationResolver(settings.population);
  if (!resolver) {
    throw new Error(`Unknown scan population type "${settings.population}"`);
  }
  const workerIds = await resolver.resolve(storage, coverage);

  const summary: CoverageRunSummary = {
    month: coverage.month,
    year: coverage.year,
    populationSize: workerIds.length,
    enqueued: 0,
    skippedAlreadyPending: 0,
  };
  if (mode === "test") return summary;

  for (const workerId of workerIds) {
    try {
      // Existing queue semantics: a worker already waiting (or being
      // processed) for this month is not re-enqueued.
      const existing = await storage.wmbScanQueue.getWorkerQueueEntry(
        workerId,
        coverage.month,
        coverage.year,
      );
      if (existing && (existing.status === "pending" || existing.status === "processing")) {
        summary.skippedAlreadyPending++;
        continue;
      }
      await storage.wmbScanQueue.enqueueWorker(
        workerId,
        coverage.month,
        coverage.year,
        SCHEDULED_SWEEP_TRIGGER_SOURCE,
      );
      summary.enqueued++;
    } catch (err) {
      logger.error("Scheduled benefit scan failed to enqueue worker", {
        service: "cron-scheduled-benefit-scan",
        workerId,
        month: coverage.month,
        year: coverage.year,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return summary;
}

registerCronPlugin({
  metadata: {
    id: "scheduled-benefit-scan",
    name: "Scheduled Benefit Scan Sweep",
    description:
      "Recurring sweep that enqueues a configured population of workers into the WMB benefit-scan queue for two coverage months (per the switch-anchor-day rule). Multiple sweeps may be configured, each with its own population and schedule.",
    requiredComponent: "trust.benefits.scan",
    // Non-singleton: admins create as many sweep configs as they need.
    singleton: false,
  },
  // Fallback only — the effective schedule is derived from the friendly
  // fields via deriveSchedule; non-singleton plugins are not boot-seeded.
  defaultSchedule: "0 2 * * 1",
  defaultEnabled: false,

  settingsSchema,
  configSchema,
  uiSchema,

  getDefaultSettings: () => DEFAULT_SETTINGS,

  validateSettings(data) {
    const parsed = settingsSchema.safeParse({ ...DEFAULT_SETTINGS, ...data });
    if (parsed.success) return { valid: true };
    return {
      valid: false,
      errors: parsed.error.issues.map((i) => `${i.path.join(".") || "settings"}: ${i.message}`),
    };
  },

  deriveSchedule(rawSettings) {
    const settings = settingsSchema.parse({ ...DEFAULT_SETTINGS, ...rawSettings });
    return deriveSweepCronSchedule(settings);
  },

  async execute(context: CronJobContext): Promise<CronJobResult> {
    const settings = settingsSchema.parse({ ...DEFAULT_SETTINGS, ...context.settings });

    // Coverage months are computed at execution time in the configured time
    // zone; populations are then resolved per coverage month, never from the
    // run date.
    const pair = computeCoverageMonthPair(new Date(), settings.timeZone, settings.switchAnchorDay);

    const summaries: CoverageRunSummary[] = [];
    for (const coverage of pair) {
      summaries.push(await sweepCoverageMonth(settings, coverage, context.mode));
    }

    const verb = context.mode === "test" ? "Would enqueue" : "Enqueued";
    const detail = summaries
      .map((s) =>
        context.mode === "test"
          ? `${s.month}/${s.year}: population ${s.populationSize}`
          : `${s.month}/${s.year}: ${s.enqueued} enqueued of ${s.populationSize} (${s.skippedAlreadyPending} already pending)`,
      )
      .join("; ");

    return {
      message: `${verb} "${settings.population}" population for coverage months ${detail}`,
      metadata: {
        population: settings.population,
        timeZone: settings.timeZone,
        switchAnchorDay: settings.switchAnchorDay,
        coverageMonths: summaries,
      },
    };
  },
});
