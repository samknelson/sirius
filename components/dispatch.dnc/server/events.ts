import { registerComponentEvent } from "../../../server/services/event-bus";
export interface DispatchDncSavedPayload { dncId: string; workerId: string; employerId: string; type: string; isDeleted?: boolean }
declare module "../../../server/services/event-bus" {
  interface ComponentEventPayloadMap { "dispatch.dnc.saved": DispatchDncSavedPayload }
}
export const DISPATCH_DNC_SAVED = registerComponentEvent("dispatch.dnc.saved");
