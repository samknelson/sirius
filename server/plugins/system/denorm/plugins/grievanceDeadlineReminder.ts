import type { JsonSchema } from "@shared/json-schema-form";
import { registerDenormPlugin } from "../registry";
import type { DenormPlugin } from "../types";
import {
  eventBus,
  EventType,
  type GrievanceDeadlineReminderPayload,
} from "../../../../services/event-bus";
import { storage } from "../../../../storage";
import { isPluginComponentEnabledSync } from "../../../_core";
import { isCacheInitialized } from "../../../../services/component-cache";
import { logger } from "../../../../logger";

/** Prefix + entity-type for this plugin's synthetic denorm entities. */
const ENTITY_TYPE = "grievance-deadline-reminder";
const PLUGIN_ID = "grievance_deadline_reminder";

/** Default reminder offsets (days BEFORE the step due date) when unconfigured. */
const DEFAULT_OFFSETS = [2, 11, 14];

/**
 * Editable settings schema surfaced to the generic plugin-config admin UI so an
 * admin can change the reminder lead-times without editing raw config `data`.
 * The saved array lands in `data.offsets`, exactly what {@link resolveOffsets}
 * already reads, so edits take effect on the next backfill / enqueue with no
 * code change. An empty list falls back to {@link DEFAULT_OFFSETS}.
 */
const configSchema: JsonSchema = {
  type: "object",
  properties: {
    offsets: {
      type: "array",
      title: "Reminder lead-times (days before due date)",
      description:
        "Send a reminder this many days before a grievance step's due date. Add one entry per reminder. Whole days only. Leave empty to use the defaults (2, 11, 14).",
      default: DEFAULT_OFFSETS,
      items: {
        type: "integer",
        title: "Days before due date",
        minimum: 0,
      },
    },
  },
};

/**
 * How long after `sendOn` a reminder stays deliverable. If the EBS pump has not
 * fired the event by then (e.g. the app was down, or the reminder was scheduled
 * retroactively for a near-past due date), the pump records it `expired`
 * instead of blasting a stale notice.
 */
const DONT_SEND_AFTER_DAYS = 2;

/**
 * Denorm payload for one scheduled grievance deadline reminder. `event` is the
 * exact event-bus payload the EBS pump will emit; `sendOn` / `dontSendAfter`
 * become the `ebs_denorm` scheduling columns. The whole thing is written by
 * `write` via `storage.ebs.replaceForEntity`.
 */
export interface GrievanceDeadlineReminderDenormPayload {
  event: GrievanceDeadlineReminderPayload;
  /** Owning subject (the grievance id) — persisted to `ebs_denorm.subject_id`. */
  subjectId: string;
  sendOn: Date;
  dontSendAfter: Date;
}

/**
 * `grievance-deadline-reminder:<grievanceId>:<stepId>:<offset>:<dueYmd>` — the
 * synthetic denorm entity id. The due date is encoded into the id so that a
 * SHIFTED deadline produces a different entity id: the old reminder widows and
 * a correctly-timed new one is scheduled by backfill.
 */
function makeUniqueId(
  grievanceId: string,
  stepId: string,
  offset: number,
  dueYmd: string,
): string {
  return `${ENTITY_TYPE}:${grievanceId}:${stepId}:${offset}:${dueYmd}`;
}

/** Parse a `grievance-deadline-reminder:<gid>:<stepId>:<offset>:<dueYmd>` id. */
function parseUniqueId(
  entityId: string,
): { grievanceId: string; stepId: string; offset: number; dueYmd: string } | null {
  const parts = entityId.split(":");
  // grievanceId / stepId are UUIDs and dueYmd is YYYY-MM-DD — none contain a
  // colon — so a well-formed id splits into exactly five parts.
  if (parts.length !== 5 || parts[0] !== ENTITY_TYPE) return null;
  const [, grievanceId, stepId, offsetRaw, dueYmd] = parts;
  const offset = Number(offsetRaw);
  if (!grievanceId || !stepId || !dueYmd || !Number.isFinite(offset)) return null;
  return { grievanceId, stepId, offset, dueYmd };
}

/** Read the configured offsets off the plugin's own config `data.offsets`. */
async function resolveOffsets(): Promise<number[]> {
  const configs = await storage.pluginConfigs.getByKindAndPlugin("denorm", PLUGIN_ID);
  const data = (configs[0]?.data ?? {}) as Record<string, unknown>;
  const raw = data.offsets;
  if (!Array.isArray(raw)) return DEFAULT_OFFSETS;
  const offsets = raw
    .map((v) => Number(v))
    // Whole days only — a fractional offset would be silently truncated by the
    // day-based date arithmetic, so reject it rather than surprise the admin.
    .filter((n) => Number.isInteger(n) && n >= 0);
  return offsets.length > 0 ? offsets : DEFAULT_OFFSETS;
}

/** Parse a `YYYY-MM-DD` string to LOCAL midnight (avoids UTC off-by-one). */
function ymdToLocalMidnight(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map((s) => Number(s));
  return new Date(y, (m ?? 1) - 1, d ?? 1, 0, 0, 0, 0);
}

/** LOCAL midnight of `date` plus `days` whole days (days may be negative). */
function midnightPlusDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + days);
  return d;
}

/**
 * The scheduling window for one reminder: `sendOn` = due-date midnight MINUS
 * offset days (the reminder fires that many days BEFORE the deadline);
 * `dontSendAfter` = `sendOn` + {@link DONT_SEND_AFTER_DAYS}. Shared by `compute`
 * (to price the row), `backfill` (to skip reminders whose window is already
 * fully past) and `findWidows` (to retire them once it is).
 */
function reminderWindow(
  dueYmd: string,
  offset: number,
): { sendOn: Date; dontSendAfter: Date } {
  const sendOn = midnightPlusDays(ymdToLocalMidnight(dueYmd), -offset);
  const dontSendAfter = midnightPlusDays(sendOn, DONT_SEND_AFTER_DAYS);
  return { sendOn, dontSendAfter };
}

/**
 * Build the reminder entity ids for a set of open steps × configured offsets,
 * skipping any whose window is already fully past (`dontSendAfter < now`) —
 * those can never fire, so scheduling them would just churn against the widow
 * sweep. Shared by `backfill` (all open steps) and the timeline-change event
 * fast path (one grievance's open steps).
 */
function candidatesForSteps(
  steps: Array<{ grievanceId: string; stepId: string; dueYmd: string }>,
  offsets: number[],
  now: Date,
): string[] {
  const candidates: string[] = [];
  for (const step of steps) {
    for (const offset of offsets) {
      if (reminderWindow(step.dueYmd, offset).dontSendAfter < now) continue;
      candidates.push(makeUniqueId(step.grievanceId, step.stepId, offset, step.dueYmd));
    }
  }
  return candidates;
}

/**
 * `grievance_deadline_reminder` denorm plugin — schedules the pre-deadline
 * reminders that the generic EBS pump later fires. Gated by the `grievance`
 * component.
 *
 * Its entity is the individual reminder (one per open timeline step × configured
 * offset), keyed by a synthetic id that ENCODES the step's due date. `backfill`
 * enumerates every open step (from the `grievance_steps_denorm` timeline) ×
 * offset inside a rolling horizon (offsets whose window has fully lapsed are not
 * scheduled); `compute` prices each one into a concrete `ebs_denorm` row (send
 * date = step due-date midnight − offset days); `findWidows` removes entities
 * whose step has completed, whose grievance is deleted, whose deadline has
 * SHIFTED (the encoded due date no longer matches the live one), or whose window
 * has fully passed. Encoding the due date is what makes a moved deadline widow
 * the old reminder and schedule a correctly-timed new one.
 *
 * Correctness of "completing/deleting/rescheduling stops the old reminder" does
 * NOT depend on the hourly cleanup winning a race against the (also hourly) EBS
 * pump: `isScheduledEventLive` is the pump's pre-fire re-check against live
 * timeline state, so a due reminder whose step has closed or whose deadline
 * moved is marked `expired` instead of delivered even if its `ebs_denorm` row
 * has not been swept yet.
 *
 * As a latency optimization the plugin also subscribes to
 * `GRIEVANCE_TIMELINE_CHANGED` (see {@link enqueueForGrievance}) so a timeline
 * edit enqueues the affected grievance's reminders immediately rather than
 * waiting for the next hourly backfill. This is purely additive; removal of
 * stale reminders still flows through `findWidows` + `isScheduledEventLive`.
 */
const grievanceDeadlineReminderPlugin: DenormPlugin<GrievanceDeadlineReminderDenormPayload> = {
  metadata: {
    id: PLUGIN_ID,
    name: "Grievance Deadline Reminders",
    description:
      "Schedules reminders that fire a configurable number of days before a grievance step's due date (default 2, 11, 14).",
    requiredComponent: "grievance",
    singleton: true,
  },
  entityType: ENTITY_TYPE,
  configSchema,

  async compute(entityId: string): Promise<GrievanceDeadlineReminderDenormPayload> {
    const parsed = parseUniqueId(entityId);
    if (!parsed) {
      throw new Error(`Invalid grievance deadline reminder entity id: ${entityId}`);
    }
    const { grievanceId, stepId, offset, dueYmd } = parsed;

    // A completed/deleted step, or one with no due date, has no live reminder —
    // throw so the row is flagged and the next widow sweep removes it
    // (findWidows is the real cleanup path; this guards the race where a step
    // closes or moves between backfill and recompute).
    const step = await storage.grievanceStepsDenorm.getOpenStep(grievanceId, stepId);
    if (!step) {
      throw new Error(`Grievance step ${stepId} on ${grievanceId} has no open due date`);
    }
    // Deadline shifted since this reminder was enumerated → this entity is
    // stale; the new due date has its own entity id scheduled by backfill.
    if (step.dueYmd !== dueYmd) {
      throw new Error(
        `Grievance step ${stepId} due date moved (${dueYmd} → ${step.dueYmd}); reminder stale`,
      );
    }

    const { sendOn, dontSendAfter } = reminderWindow(dueYmd, offset);

    const event: GrievanceDeadlineReminderPayload = {
      grievanceId,
      stepId,
      stepName: step.stepName,
      dueDate: dueYmd,
      offset,
    };

    return { event, subjectId: grievanceId, sendOn, dontSendAfter };
  },

  async backfill(configId: string, limit: number): Promise<string[]> {
    const offsets = await resolveOffsets();
    const steps = await storage.grievanceStepsDenorm.listOpenStepsWithDueDate();
    const candidates = candidatesForSteps(steps, offsets, new Date());
    if (candidates.length === 0) return [];

    const existing = new Set(
      await storage.denorm.existingEntityIdsForConfig(configId, candidates),
    );
    const missing: string[] = [];
    for (const id of candidates) {
      if (!existing.has(id)) {
        missing.push(id);
        if (missing.length >= limit) break;
      }
    }
    return missing;
  },

  async findWidows(configId: string, limit: number): Promise<string[]> {
    const entityIds = await storage.denorm.listEntityIdsForConfig(configId, limit);
    if (entityIds.length === 0) return [];

    const now = new Date();
    // Live due date of every open step, keyed by `${grievanceId}:${stepId}`, so
    // we can retire reminders whose step closed, whose grievance was deleted, or
    // whose deadline moved.
    const liveByKey = new Map<string, string>();
    for (const step of await storage.grievanceStepsDenorm.listOpenStepsWithDueDate()) {
      liveByKey.set(`${step.grievanceId}:${step.stepId}`, step.dueYmd);
    }

    const widows: string[] = [];
    for (const entityId of entityIds) {
      const parsed = parseUniqueId(entityId);
      // Unparseable id → widow (clean a malformed row rather than stranding it).
      if (!parsed) {
        widows.push(entityId);
        continue;
      }
      const liveDueYmd = liveByKey.get(`${parsed.grievanceId}:${parsed.stepId}`);
      // Step completed / grievance deleted (not in the open set) → widow.
      if (!liveDueYmd) {
        widows.push(entityId);
        continue;
      }
      // Deadline shifted → the encoded due date no longer matches → widow.
      if (liveDueYmd !== parsed.dueYmd) {
        widows.push(entityId);
        continue;
      }
      // Step still open at the same deadline but this reminder's window has
      // fully lapsed → widow (past the rolling horizon; its terminal
      // `ebs_status` row, if any, is decoupled and survives this deletion).
      if (reminderWindow(parsed.dueYmd, parsed.offset).dontSendAfter < now) {
        widows.push(entityId);
      }
    }
    return widows;
  },

  async isScheduledEventLive(uniqueId: string): Promise<boolean> {
    const parsed = parseUniqueId(uniqueId);
    if (!parsed) return false;
    // Step closed / grievance deleted / no due date → the reminder must not
    // fire. This is the live-state re-check the EBS pump runs immediately before
    // delivery, so completing a step or moving its deadline stops the old
    // reminder regardless of whether the hourly widow sweep has removed the
    // `ebs_denorm` row yet.
    const step = await storage.grievanceStepsDenorm.getOpenStep(
      parsed.grievanceId,
      parsed.stepId,
    );
    if (!step) return false;
    // Deadline moved → the old (encoded) reminder is stale and must not fire.
    if (step.dueYmd !== parsed.dueYmd) return false;
    return true;
  },

  async write(
    entityId: string,
    payload: GrievanceDeadlineReminderDenormPayload,
    denormRowId: string,
  ): Promise<void> {
    await storage.ebs.replaceForEntity({
      denormId: denormRowId,
      uniqueId: entityId,
      pluginId: PLUGIN_ID,
      subjectId: payload.subjectId,
      eventType: EventType.GRIEVANCE_DEADLINE_REMINDER,
      payload: payload.event,
      sendOn: payload.sendOn,
      dontSendAfter: payload.dontSendAfter,
    });
  },
};

registerDenormPlugin(grievanceDeadlineReminderPlugin);

/**
 * Latency optimization: when a grievance's timeline changes (template set,
 * swapped, or cleared — which also recomputes `grievance_steps_denorm`),
 * eagerly enqueue that grievance's currently-missing reminder entities as
 * `stale` so the (separate) recompute job prices them without waiting for the
 * next hourly backfill sweep to discover them. Purely additive: removal of
 * now-stale reminders still flows through `findWidows` + `isScheduledEventLive`.
 * Applies the same gating the backfill sweep uses (component on, config present
 * and enabled) and never throws into the event bus.
 */
async function enqueueForGrievance(grievanceId: string): Promise<void> {
  if (!isCacheInitialized()) return;
  if (!isPluginComponentEnabledSync(grievanceDeadlineReminderPlugin.metadata)) return;
  try {
    const configs = await storage.pluginConfigs.getByKindAndPlugin("denorm", PLUGIN_ID);
    const config = configs[0];
    if (!config || config.enabled === false) return;

    const offsets = await resolveOffsets();
    const steps = await storage.grievanceStepsDenorm.listOpenStepsWithDueDate(grievanceId);
    const candidates = candidatesForSteps(steps, offsets, new Date());
    if (candidates.length === 0) return;

    const existing = new Set(
      await storage.denorm.existingEntityIdsForConfig(config.id, candidates),
    );
    const missing = candidates.filter((id) => !existing.has(id));
    if (missing.length === 0) return;

    await storage.denorm.insertStaleBatch(
      missing.map((entityId) => ({
        entityId,
        entityType: ENTITY_TYPE,
        configId: config.id,
      })),
    );
  } catch (error) {
    logger.error("Failed to eagerly enqueue grievance deadline reminders", {
      service: "grievance-deadline-reminder",
      grievanceId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

eventBus.on({
  name: `denorm:${PLUGIN_ID}:timeline-changed`,
  description:
    "Eagerly enqueue a grievance's deadline reminders when its timeline template changes (latency optimization; correctness is owned by the backfill/widow sweep).",
  event: EventType.GRIEVANCE_TIMELINE_CHANGED,
  handler: async (payload) => {
    const grievanceId = (payload as { grievanceId?: string }).grievanceId;
    if (!grievanceId || typeof grievanceId !== "string") return;
    await enqueueForGrievance(grievanceId);
  },
});
