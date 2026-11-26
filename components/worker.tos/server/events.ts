import { registerComponentEvent } from "../../../server/services/event-bus";
export interface TosAbsenceReminderPayload {
  tosId: string; workerId: string; contactId: string | null; offset: number; absenceStartDate: string;
}
declare module "../../../server/services/event-bus" {
  interface ComponentEventPayloadMap { "tos.absence.reminder": TosAbsenceReminderPayload }
}
export const TOS_ABSENCE_REMINDER = registerComponentEvent("tos.absence.reminder");
