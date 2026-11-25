import { registerComponentEvent } from "../../../server/services/event-bus";
export interface DispatchHfeSavedPayload { hfeId: string; workerId: string; employerId: string; isDeleted?: boolean }
declare module "../../../server/services/event-bus" {
  interface ComponentEventPayloadMap { "dispatch.hfe.saved": DispatchHfeSavedPayload }
}
export const DISPATCH_HFE_SAVED = registerComponentEvent("dispatch.hfe.saved");
