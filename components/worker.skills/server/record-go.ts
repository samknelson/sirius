import { alterHooks } from "../../../shared/alter";
import { recordGoResolutionHook, type RecordGoResolution } from "../../../server/services/record-go";
import { storage } from "../../../server/storage/database";
export function registerSkillRecordGo() {
  alterHooks.register(recordGoResolutionHook, {
    id: "worker.skills.record-go", component: "worker.skills", priority: 10,
    description: "Resolve a skill's worker and destination in one read", metadata: {},
    async alter(previous, { metadata }): Promise<RecordGoResolution | null> {
      if (metadata.contextId !== "worker_skills") return previous;
      const skill = await storage.workerSkills.get(metadata.entityId);
      if (!skill) return { kind: "not_found", reason: "unknown" };
      return { kind: "resolved", metadata, parent: { workerId: skill.workerId },
        href: `/workers/${encodeURIComponent(skill.workerId)}/skills?record=${encodeURIComponent(skill.id)}` };
    },
  });
}
