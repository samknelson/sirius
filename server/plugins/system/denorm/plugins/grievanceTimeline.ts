import { registerDenormPlugin } from "../registry";
import type { DenormPlugin } from "../types";
import { EventType } from "../../../../services/event-bus";
import { storage } from "../../../../storage";
import type { GrievanceTimelineStepRow } from "../../../../storage/system/grievance-steps-denorm";
import { dateToYmd, addDaysYmd } from "@shared/utils/date";
import { readTimelineAdjustment } from "@shared/schema";
import { addBusinessDays } from "../../../../services/business-calendar";
import type { BusinessCalendarWithRules } from "../../../../storage/business-calendars";

/** Variable naming the system default business calendar (see business-calendars module). */
const DEFAULT_CALENDAR_VARIABLE = "business-calendar.default";

/**
 * Resolve the default business calendar (with its manual rules) if one is
 * configured and still exists. Returns undefined otherwise.
 */
async function getDefaultCalendar(): Promise<BusinessCalendarWithRules | undefined> {
  const variable = await storage.variables.getByName(DEFAULT_CALENDAR_VARIABLE);
  const calendarId = typeof variable?.value === "string" && variable.value ? variable.value : undefined;
  if (!calendarId) return undefined;
  return storage.businessCalendars.getCalendarWithRules(calendarId);
}

/**
 * Resolve the business calendar to use for a grievance's business-day math.
 *
 * Rule: look at the grievance's associated employers (grievance_employers,
 * usually exactly one). If every associated employer that has a calendar
 * points to the SAME calendar, use it. Otherwise (no employers, no calendar
 * set, calendar deleted, or multiple employers with DIFFERING calendars),
 * fall back to the system default calendar.
 */
async function getCalendarForGrievance(
  grievanceId: string,
): Promise<BusinessCalendarWithRules | undefined> {
  const linkedEmployers = await storage.grievances.listEmployers(grievanceId);
  const calendarIds = new Set<string>();
  for (const link of linkedEmployers) {
    const employer = await storage.employers.getEmployer(link.employerId);
    if (employer?.businessCalendarId) calendarIds.add(employer.businessCalendarId);
  }
  if (calendarIds.size === 1) {
    const calendarId = calendarIds.values().next().value as string;
    const calendar = await storage.businessCalendars.getCalendarWithRules(calendarId);
    if (calendar) return calendar;
  }
  return getDefaultCalendar();
}

/**
 * Denorm payload for a grievance's computed timeline steps: zero or more rows
 * for the `grievance_steps_denorm` table.
 */
export interface GrievanceTimelinePayload {
  rows: GrievanceTimelineStepRow[];
}

/**
 * `grievance_timeline` denorm plugin — sole maintainer of the
 * `grievance_steps_denorm` table. Gated by the `grievance` component.
 *
 * Recomputes on:
 *  - GRIEVANCE_STATUS_HISTORY_SAVED — any status-history create/update/delete;
 *  - GRIEVANCE_TIMELINE_CHANGED — the grievance's timeline template was set,
 *    swapped, or cleared (NOT emitted for unrelated grievance edits).
 *
 * Derivation (from the grievance's timeline template + status history,
 * history sorted ascending by date):
 *  - A template step OCCURRENCE STARTS at the next history entry whose status
 *    is in the step's `fromStatuses`.
 *  - It COMPLETES at the first history entry at/after its start whose status
 *    is in the step's `toStatuses` OR is a closed (resolved) status. A closed
 *    status always ends the occurrence, even when not listed in `toStatuses`.
 *  - After an occurrence completes, scanning resumes AFTER the completing
 *    entry, so a step that is entered, completed, and entered again produces
 *    one row PER occurrence (in chronological order). A start with no later
 *    completion is the final, open occurrence for that step.
 *  - Steps that never started produce NO row.
 *  - `due` = start + `days`, calendar or business per the step's `dayType`.
 *    Business days are computed against the business calendar of the
 *    grievance's associated employer when it has one (all associated
 *    employers must agree on the calendar); otherwise against the system
 *    default business calendar (weekends, holidays, manual closures,
 *    vacations, forced-open days). When neither is configured, business
 *    days degrade to plain calendar days.
 *  - `is_current` = the earliest-started occurrence that has not completed
 *    (ties broken arbitrarily); enforced at most one by a partial unique index.
 */
const grievanceTimelinePlugin: DenormPlugin<GrievanceTimelinePayload> = {
  metadata: {
    id: "grievance_timeline",
    name: "Grievance Timeline",
    description:
      "Keeps each grievance's computed timeline steps (started/due/completed dates and the current step) in sync from its timeline template and status history.",
    requiredComponent: "grievance",
    singleton: true,
  },
  entityType: "grievance",
  reads: [
    "grievances",
    "grievanceTimelineTemplates",
    "grievanceStatusHistory",
    "employers",
    "variables",
    "businessCalendars",
  ],
  writes: [{ storage: "grievanceStepsDenorm", soleWriter: true }],
  eventHandlers: [
    {
      event: EventType.GRIEVANCE_STATUS_HISTORY_SAVED,
      getEntityId: (payload) => (payload as { grievanceId: string }).grievanceId,
    },
    {
      event: EventType.GRIEVANCE_TIMELINE_CHANGED,
      getEntityId: (payload) => (payload as { grievanceId: string }).grievanceId,
    },
  ],

  async compute(grievanceId: string): Promise<GrievanceTimelinePayload> {
    const grievance = await storage.grievances.get(grievanceId);
    if (!grievance || !grievance.timelineTemplateId) return { rows: [] };

    const steps = await storage.grievanceTimelineTemplates.listSteps(
      grievance.timelineTemplateId,
    );
    if (steps.length === 0) return { rows: [] };

    // Status history arrives newest-first; the derivation walks oldest-first.
    const history = [...(await storage.grievanceStatusHistory.list(grievanceId))].sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
    );

    // Business-day math uses the grievance's employer calendar when set,
    // falling back to the system default calendar; when neither exists,
    // business days degrade to plain calendar days.
    const calendar = await getCalendarForGrievance(grievanceId);
    const addBusiness = (ymd: string, days: number): string =>
      calendar ? addBusinessDays(calendar, ymd, days) : addDaysYmd(ymd, days);

    const rows: GrievanceTimelineStepRow[] = [];
    for (const step of steps) {
      const fromSet = new Set(step.fromStatuses);
      const toSet = new Set(step.toStatuses);

      // A step may be entered, completed, and entered again. Walk the history
      // repeatedly, emitting one row per occurrence: find the next start, its
      // completion, then resume scanning AFTER that completion for the next
      // start. A start with no later completion is the final open occurrence.
      let cursor = 0;
      while (cursor < history.length) {
        const startIdx = history.findIndex(
          (h, i) => i >= cursor && fromSet.has(h.statusId),
        );
        if (startIdx === -1) break; // no more starts → done with this step

        const startEntry = history[startIdx];
        const startedYmd = dateToYmd(new Date(startEntry.date));
        const startTime = new Date(startEntry.date).getTime();
        // This occurrence completes at the first entry at/after its start whose
        // status is an explicit `toStatus` OR is a closed (resolved) status.
        // Closed statuses always end the current step, even when not listed in
        // `toStatuses`.
        const completeIdx = history.findIndex(
          (h, i) =>
            i >= startIdx &&
            new Date(h.date).getTime() >= startTime &&
            (toSet.has(h.statusId) || h.statusOpen === false),
        );
        const completeEntry = completeIdx === -1 ? undefined : history[completeIdx];

        const computedDueYmd =
          step.dayType === "business"
            ? addBusiness(startedYmd, step.days)
            : addDaysYmd(startedYmd, step.days);

        // A timeline adjustment on this occurrence's START entry shifts (or
        // replaces) its due date. Relative days follow the step's dayType; an
        // explicit date overrides the computed due date outright. Prior steps
        // this entry COMPLETES are unaffected.
        const adjustment = readTimelineAdjustment(startEntry.data);
        let dueYmd = computedDueYmd;
        if (adjustment) {
          dueYmd =
            adjustment.kind === "explicit"
              ? adjustment.date
              : step.dayType === "business"
                ? addBusiness(computedDueYmd, adjustment.days)
                : addDaysYmd(computedDueYmd, adjustment.days);
        }

        rows.push({
          stepId: step.stepId,
          startedYmd,
          dueYmd,
          completedYmd: completeEntry ? dateToYmd(new Date(completeEntry.date)) : null,
          isCurrent: false,
          sequence: step.sequence,
          startStatusId: startEntry.statusId,
          completeStatusId: completeEntry ? completeEntry.statusId : null,
          ...(adjustment ? { adjustment, originalDueYmd: computedDueYmd } : {}),
        });

        // No completion → this open occurrence is the last one for this step.
        if (completeIdx === -1) break;
        // Resume after the completion so a re-entry starts a fresh occurrence.
        // (When the start entry also closes the step, completeIdx === startIdx;
        // advancing to completeIdx + 1 still makes forward progress.)
        cursor = completeIdx + 1;
      }
    }

    // Current step = earliest-started incomplete occurrence (ties arbitrary).
    // By construction a step has at most one open occurrence (a new occurrence
    // only starts after the previous one completed), so this is also the step's
    // last, still-open occurrence.
    const incomplete = rows
      .filter((r) => r.completedYmd === null && r.startedYmd !== null)
      .sort((a, b) => (a.startedYmd! < b.startedYmd! ? -1 : a.startedYmd! > b.startedYmd! ? 1 : 0));
    if (incomplete.length > 0) incomplete[0].isCurrent = true;

    return { rows };
  },

  async backfill(configId: string, limit: number): Promise<string[]> {
    return storage.grievanceStepsDenorm.findIdsMissingDenorm(configId, limit);
  },

  async findWidows(configId: string, limit: number): Promise<string[]> {
    return storage.grievanceStepsDenorm.findDenormWidowIds(configId, limit);
  },

  async write(
    grievanceId: string,
    payload: GrievanceTimelinePayload,
    denormRowId: string,
  ): Promise<void> {
    await storage.grievanceStepsDenorm.replaceForGrievance(
      grievanceId,
      denormRowId,
      payload.rows,
    );
  },
};

registerDenormPlugin(grievanceTimelinePlugin);
