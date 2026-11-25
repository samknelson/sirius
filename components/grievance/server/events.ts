import { registerComponentEvent } from "../../../server/services/event-bus";

export interface GrievanceSavedPayload {
  grievanceId: string;
}

/**
 * Emitted after any grievance status-history mutation (create/update/delete)
 * commits. Consumed by the `grievance_timeline` denorm plugin to recompute the
 * grievance's timeline steps (which only needs `grievanceId`).
 *
 * Also carries the grievance's derived *current* status before and after the
 * mutation, so a notifier can detect a genuine transition ("grievance attained
 * status X") without re-querying: the current status is the latest-dated
 * status-history entry. Both ids are null when the grievance has no history at
 * that point in time (e.g. `previous*` on the very first entry, `new*` after
 * the last entry is deleted). Status names are resolved for rendering and may be
 * null if the referenced status option is missing.
 *
 * `newStatusHistoryId` identifies the status-history ROW that is current after
 * the mutation. A consumer that has to render the transition loads that exact
 * row rather than re-reading "the grievance's current status", which a later
 * transition could have moved on by then.
 */
export interface GrievanceStatusHistorySavedPayload {
  grievanceId: string;
  previousStatusId: string | null;
  previousStatusName: string | null;
  newStatusId: string | null;
  newStatusName: string | null;
  newStatusHistoryId: string | null;
}

/**
 * Emitted after a grievance save commits ONLY when the grievance's
 * `timeline_template_id` actually changed (set, swapped, or cleared) — so the
 * `grievance_timeline` denorm plugin does not recompute on every unrelated
 * grievance edit.
 */
export interface GrievanceTimelineChangedPayload {
  grievanceId: string;
}

export interface GrievanceAssignmentSavedPayload {
  grievanceId: string;
  userId: string;
  roleId: string;
  operation: "created" | "updated" | "deleted";
}

/**
 * A single grievance deadline reminder that fell due. Emitted by the generic
 * EBS pump cron from an `ebs_denorm` row scheduled by the
 * `grievance_deadline_reminder` denorm plugin; delivered by the
 * `grievance-deadline-notifier` event-notifier plugin. `offset` is the number
 * of days BEFORE `dueDate` this reminder fires; `dueDate` is the step's due
 * date (YYYY-MM-DD). `stepName` is the timeline step's display name (null if it
 * can no longer be resolved).
 */
export interface GrievanceDeadlineReminderPayload {
  grievanceId: string;
  stepId: string;
  stepName: string | null;
  dueDate: string;
  offset: number;
}

export interface GrievanceDeleteAfterPayload {
  grievanceId: string;
}

declare module "../../../server/services/event-bus" {
  interface ComponentEventPayloadMap {
    "grievance.saved": GrievanceSavedPayload;
    "grievance.status-history.saved": GrievanceStatusHistorySavedPayload;
    "grievance.timeline.changed": GrievanceTimelineChangedPayload;
    "grievance.assignment.saved": GrievanceAssignmentSavedPayload;
    "grievance.deadline.reminder": GrievanceDeadlineReminderPayload;
    "grievance.delete.after": GrievanceDeleteAfterPayload;
  }
}

export const GRIEVANCE_SAVED = registerComponentEvent("grievance.saved");
export const GRIEVANCE_STATUS_HISTORY_SAVED = registerComponentEvent("grievance.status-history.saved");
export const GRIEVANCE_TIMELINE_CHANGED = registerComponentEvent("grievance.timeline.changed");
export const GRIEVANCE_ASSIGNMENT_SAVED = registerComponentEvent("grievance.assignment.saved");
export const GRIEVANCE_DEADLINE_REMINDER = registerComponentEvent("grievance.deadline.reminder");
export const GRIEVANCE_DELETE_AFTER = registerComponentEvent("grievance.delete.after");
