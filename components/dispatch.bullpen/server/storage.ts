import { createDispatchJobEventStorage } from "./storage/dispatch/job-events";
export function createStorage(): { dispatchJobEvents: ReturnType<typeof createDispatchJobEventStorage> } {
  return { dispatchJobEvents: createDispatchJobEventStorage() };
}
