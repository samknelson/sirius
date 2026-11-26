import { workerSkills } from "../shared/schema/worker/skills/schema";
import type { MetadataRecordContext } from "../../../server/storage/entity-metadata-record-tables";
export const metadataContexts = {
  worker_skills: { table: workerSkills, label: "Worker Skills", hrefTemplate: null,
    component: "worker.skills", entityTypes: ["worker_skill"],
    recordGo: { kind: "policy", id: "worker.view", componentId: "worker.skills" } },
} satisfies Record<string, MetadataRecordContext>;
