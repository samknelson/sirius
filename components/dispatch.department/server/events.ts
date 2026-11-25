import { registerComponentEvent } from "../../../server/services/event-bus";
export interface DispatchDepartmentSavedPayload { entryId: string; workerId: string; departmentId: string; preference: string; isDeleted?: boolean }
declare module "../../../server/services/event-bus" {
  interface ComponentEventPayloadMap { "dispatch.department.saved": DispatchDepartmentSavedPayload }
}
export const DISPATCH_DEPARTMENT_SAVED = registerComponentEvent("dispatch.department.saved");
