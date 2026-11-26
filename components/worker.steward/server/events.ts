import { registerComponentEvent } from "../../../server/services/event-bus";
export interface StewardAssignmentSavedPayload {
  assignmentId: string; workerId: string; employerId: string; bargainingUnitId: string;
  operation: "created" | "updated" | "deleted";
}
declare module "../../../server/services/event-bus" {
  interface ComponentEventPayloadMap { "steward.assignment.saved": StewardAssignmentSavedPayload }
}
export const STEWARD_ASSIGNMENT_SAVED = registerComponentEvent("steward.assignment.saved");
