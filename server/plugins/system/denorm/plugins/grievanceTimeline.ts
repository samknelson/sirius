import { registerDenormPlugin } from "../registry";
import type { DenormPlugin } from "../types";
import { EventType } from "../../../../services/event-bus";
import { storage } from "../../../../storage";
import type { GrievanceTimelineStepRow } from "../../../../storage/system/grievance-steps-denorm";
import { dateToYmd, addDaysYmd, addBusinessDaysYmd } from "@shared/utils/date";

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
 *  - A template step STARTS at the first history entry whose status is in the
 *    step's `fromStatuses`.
 *  - It COMPLETES at the first history entry at/after its start whose status
 *    is in the step's `toStatuses`.
 *  - Steps that never started produce NO row.
 *  - `due` = start + `days`, calendar or business per the step's `dayType`
 *    (business days skip weekends; holidays are a future extension).
 *  - `is_current` = the earliest-started step that has not completed (ties
 *    broken arbitrarily); enforced at most one by a partial unique index.
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

    const rows: GrievanceTimelineStepRow[] = [];
    for (const step of steps) {
      const fromSet = new Set(step.fromStatuses);
      const toSet = new Set(step.toStatuses);

      const startEntry = history.find((h) => fromSet.has(h.statusId));
      if (!startEntry) continue; // never started → no row

      const startedYmd = dateToYmd(new Date(startEntry.date));
      const startTime = new Date(startEntry.date).getTime();
      const completeEntry = history.find(
        (h) => new Date(h.date).getTime() >= startTime && toSet.has(h.statusId),
      );

      const dueYmd =
        step.dayType === "business"
          ? addBusinessDaysYmd(startedYmd, step.days)
          : addDaysYmd(startedYmd, step.days);

      rows.push({
        stepId: step.stepId,
        startedYmd,
        dueYmd,
        completedYmd: completeEntry ? dateToYmd(new Date(completeEntry.date)) : null,
        isCurrent: false,
        sequence: step.sequence,
      });
    }

    // Current step = earliest-started incomplete step (ties arbitrary).
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
