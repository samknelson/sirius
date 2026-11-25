import { registerComponentEvent } from "../../../server/services/event-bus";
import type { DispatchJob } from "@shared/schema";
import type { DispatchJobFore } from "../shared/schema/dispatch/fore-schema";
/** Rows captured in the writing transaction, including the removed membership. */
export interface DispatchForeSavedPayload {
  foreId: string; jobId: string; workerId: string; action: "added" | "removed";
  fore: DispatchJobFore; job: DispatchJob;
}
declare module "../../../server/services/event-bus" {
  interface ComponentEventPayloadMap { "dispatch.fore.saved": DispatchForeSavedPayload }
}
export const DISPATCH_FORE_SAVED = registerComponentEvent("dispatch.fore.saved");
