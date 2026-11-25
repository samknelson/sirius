import { registerComponentEvent } from "../../../server/services/event-bus";
export interface DispatchEbaSavedPayload { workerId: string }
declare module "../../../server/services/event-bus" {
  interface ComponentEventPayloadMap { "dispatch.eba.saved": DispatchEbaSavedPayload }
}
export const DISPATCH_EBA_SAVED = registerComponentEvent("dispatch.eba.saved");
