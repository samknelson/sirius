import { registerComponentEvent } from "../../../server/services/event-bus";
export interface WorkerSkillSavedPayload {
  workerSkillId: string; workerId: string; skillId: string; isDeleted?: boolean;
}
declare module "../../../server/services/event-bus" {
  interface ComponentEventPayloadMap { "worker.skill.saved": WorkerSkillSavedPayload }
}
export const WORKER_SKILL_SAVED = registerComponentEvent("worker.skill.saved");
