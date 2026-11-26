import { expect, it, vi } from "vitest";
const f = vi.hoisted(() => ({
  metadata: vi.fn(), skill: vi.fn(), worker: vi.fn(), policy: vi.fn(), component: vi.fn(),
  contexts: { worker_skills: {
    label: "Worker Skills", entityTypes: ["worker_skill"],
    recordGo: { kind: "policy", id: "worker.view", componentId: "worker.skills" },
  } },
}));
vi.mock("../../../server/storage/system/entity-metadata", () => ({
  entityMetadataStorage: { get: f.metadata, getByMetadataId: f.metadata },
}));
vi.mock("../../../server/storage/entity-metadata-record-tables", () => ({
  entityMetadataContexts: f.contexts,
  getMetadataRecordContext: (id: string) => f.contexts[id as keyof typeof f.contexts],
  metadataRecordHref: () => null,
}));
vi.mock("../../../server/storage/database", () => ({ storage: { workerSkills: { get: f.skill } } }));
vi.mock("../../../server/storage", () => ({ storage: { workers: { getWorker: f.worker } } }));
vi.mock("../../../server/modules/components", () => ({ isComponentEnabled: f.component }));
vi.mock("../../../server/services/access-policy-evaluator", () => ({ checkAccess: f.policy }));
import { alterHooks } from "@shared/alter";
import { registerSkillRecordGo } from "../server/record-go";
import { resolveRecordGoIdentifier } from "../../../server/services/record-go";
import { authorizeRecordGoUser, presentAuthorizedRecordGoSource } from "../../../server/services/record-go-access";
import type { User } from "@shared/schema";

registerSkillRecordGo();
alterHooks.close({ isKnown: () => true, isEnabled: f.component });

it("skills enforce component and parent authority using the destination's same snapshot", async () => {
  const id = "eeead217-b5a2-4b38-9c3b-c9d25765fd42";
  const viewer = { id: "effective-viewer" } as User;
  f.metadata.mockResolvedValue({ contextId: "worker_skills", entityId: id, seq: 1234, rev: 2 });
  f.skill.mockResolvedValue({ id, workerId: "parent" });
  f.worker.mockResolvedValue({ id: "parent" });
  f.component.mockResolvedValue(false);
  expect(await presentAuthorizedRecordGoSource(viewer, "worker_skill", id)).toBeNull();
  expect(f.policy).not.toHaveBeenCalled();
  expect(f.skill).not.toHaveBeenCalled();
  f.component.mockResolvedValue(true);
  f.policy.mockResolvedValue({ granted: false });
  expect(await presentAuthorizedRecordGoSource(viewer, "worker_skill", id)).toBeNull();
  expect(f.policy).toHaveBeenCalledWith("worker.view", viewer, "parent");
  f.policy.mockResolvedValue({ granted: true });
  f.skill.mockClear();
  const resolution = await resolveRecordGoIdentifier(id);
  if (resolution.kind !== "resolved") throw new Error("Expected skill destination");
  f.skill.mockResolvedValue({ id, workerId: "different-parent" });
  expect(await authorizeRecordGoUser(viewer, resolution)).toBe(true);
  expect(f.skill).toHaveBeenCalledTimes(1);
  expect(f.policy).toHaveBeenLastCalledWith("worker.view", viewer, "parent");
  expect(resolution.href).toBe(`/workers/parent/skills?record=${id}`);
});
