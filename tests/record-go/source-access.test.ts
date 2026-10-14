import { beforeEach, describe, expect, it, vi } from "vitest";

const f = vi.hoisted(() => ({
  metadata: vi.fn(), metadataId: vi.fn(), sequence: vi.fn(),
  note: vi.fn(), skill: vi.fn(), worker: vi.fn(), permission: vi.fn(),
  policy: vi.fn(), component: vi.fn(), available: vi.fn(),
  notesAccess: vi.fn(), notesExist: vi.fn(),
}));
vi.mock("../../server/storage/system/entity-metadata", () => ({
  entityMetadataStorage: { get: f.metadata, getByMetadataId: f.metadataId, getBySequence: f.sequence },
}));
vi.mock("../../server/storage/entity-metadata-record-tables", () => ({
  getMetadataRecordContext: (id: string) => ({
    entity_notes: { label: "Record Notes", entityTypes: ["entity_note"] },
    worker_skills: { label: "Worker Skills", entityTypes: ["worker_skill"] },
    workers: { label: "Workers", entityTypes: ["worker"] },
    employers: { label: "Employers", entityTypes: ["employer"] },
    grievances: { label: "Grievances", entityTypes: ["grievance"] },
  } as Record<string, unknown>)[id],
  metadataRecordHref: (type: string, id: string) => {
    const prefix = ({ workers: "/workers", employers: "/employers", grievances: "/grievance" } as Record<string, string>)[type];
    return prefix ? `${prefix}/${id}` : null;
  },
}));
vi.mock("../../server/storage", () => ({ storage: {
  entityNotes: { get: f.note }, workerSkills: { get: f.skill },
  workers: { getWorker: f.worker }, users: { userHasPermission: f.permission },
}}));
vi.mock("../../server/modules/components", () => ({ isComponentEnabled: f.component }));
vi.mock("../../server/modules/entity-contexts", () => ({ resolveEntityContextAvailability: f.available }));
vi.mock("../../server/services/entity-notes/registry", () => ({
  getEntityNoteContext: () => ({ checkAccessForUser: f.notesAccess, entityExists: f.notesExist }),
}));
vi.mock("../../server/services/access-policy-evaluator", () => ({
  checkAccess: f.policy, buildContext: vi.fn(),
}));

import { resolveRecordGoIdentifier, resolveRecordGoSource } from "../../server/services/record-go";
import { authorizeRecordGoUser, presentAuthorizedRecordGoSource } from "../../server/services/record-go-access";
import type { User } from "@shared/schema";

const id = "eeead217-b5a2-4b38-9c3b-c9d25765fd42";
const viewer = { id: "effective-viewer" } as User;
const meta = (contextId: string) => ({ contextId, entityId: id, seq: 1234, rev: 2 });

beforeEach(() => {
  vi.resetAllMocks();
  f.metadata.mockResolvedValue(meta("entity_notes"));
  f.metadataId.mockResolvedValue(undefined);
  f.sequence.mockResolvedValue(meta("entity_notes"));
  f.note.mockResolvedValue({ id, contextId: "worker", entityId: "parent", subject: "PRIVATE", body: "PRIVATE" });
  f.skill.mockResolvedValue({ id, workerId: "parent" });
  f.worker.mockResolvedValue({ id: "parent" });
  f.notesExist.mockResolvedValue(true);
  f.notesAccess.mockResolvedValue(true);
  f.permission.mockResolvedValue(true);
  f.policy.mockResolvedValue({ granted: true });
  f.component.mockResolvedValue(true);
  f.available.mockResolvedValue({ available: true });
});

describe("shared Go source authorization", () => {
  it("uses the same child destination for UUID, sequence and source pair; presentation excludes note content", async () => {
    const uuid = await resolveRecordGoIdentifier(id);
    const sequence = await resolveRecordGoIdentifier("1.234::2");
    const source = await resolveRecordGoSource("entity_note", id);
    expect(uuid).toEqual(sequence);
    expect(source).toEqual(uuid);
    const presentation = await presentAuthorizedRecordGoSource(viewer, "entity_note", id);
    expect(presentation).toEqual({
      id, title: "Record Notes", subtitle: "000.1234::0002",
      href: `/workers/parent/notes?record=${id}`,
    });
    expect(JSON.stringify(presentation)).not.toContain("PRIVATE");
    expect(f.notesAccess).toHaveBeenCalledWith("view", "parent", viewer);
  });

  it.each(["worker", "worker_skill", "unknown_kind"])("refuses a source whose declared kind %s mismatches its metadata", async kind => {
    expect(await presentAuthorizedRecordGoSource(viewer, kind, id)).toBeNull();
    expect(f.note).not.toHaveBeenCalled();
  });

  it("an entity-source lookup never resolves another record's metadata-id collision", async () => {
    f.metadataId.mockResolvedValue(meta("workers"));
    expect((await resolveRecordGoSource("entity_note", id)).kind).toBe("resolved");
    expect(f.metadataId).not.toHaveBeenCalled();
  });

  it.each(["unconfigured", "forbidden", "permission-refused", "parent-policy-refused", "missing-parent", "deleted-child", "missing-metadata"])(
    "withholds all presentation for %s", async state => {
      if (state === "unconfigured") f.available.mockResolvedValue({ available: false });
      if (state === "forbidden") f.notesAccess.mockResolvedValue(false);
      if (state === "permission-refused") f.permission.mockResolvedValue(false);
      if (state === "parent-policy-refused") f.policy.mockResolvedValue({ granted: false });
      if (state === "missing-parent") f.notesExist.mockResolvedValue(false);
      if (state === "deleted-child") f.note.mockResolvedValue(undefined);
      if (state === "missing-metadata") f.metadata.mockResolvedValue(undefined);
      expect(await presentAuthorizedRecordGoSource(viewer, "entity_note", id)).toBeNull();
    },
  );

  it("authorizes the exact parent that generated the href, not a second source snapshot", async () => {
    const resolution = await resolveRecordGoIdentifier(id);
    expect(resolution.kind).toBe("resolved");
    f.note.mockResolvedValue({ id, contextId: "worker", entityId: "different-parent" });
    if (resolution.kind !== "resolved") throw new Error("Expected resolution");
    expect(await authorizeRecordGoUser(viewer, resolution)).toBe(true);
    expect(f.note).toHaveBeenCalledTimes(1);
    expect(f.notesAccess).toHaveBeenCalledWith("view", "parent", viewer);
    expect(resolution.href).toContain("/workers/parent/");
  });

  it("skills enforce both their component and the owning worker policy", async () => {
    f.metadata.mockResolvedValue(meta("worker_skills"));
    f.component.mockResolvedValue(false);
    expect(await presentAuthorizedRecordGoSource(viewer, "worker_skill", id)).toBeNull();
    expect(f.policy).not.toHaveBeenCalled();
    expect(f.skill).not.toHaveBeenCalled();
    f.component.mockResolvedValue(true);
    f.policy.mockResolvedValue({ granted: false });
    expect(await presentAuthorizedRecordGoSource(viewer, "worker_skill", id)).toBeNull();
    expect(f.policy).toHaveBeenCalledWith("worker.view", viewer, "parent");
    f.policy.mockResolvedValue({ granted: true });
    expect((await presentAuthorizedRecordGoSource(viewer, "worker_skill", id))?.href)
      .toBe(`/workers/parent/skills?record=${id}`);
  });

  it("keeps existing standalone destinations and blocks unsupported child contexts", async () => {
    f.metadata.mockResolvedValue(meta("workers"));
    expect((await presentAuthorizedRecordGoSource(viewer, "worker", id))?.href).toBe(`/workers/${id}`);
    f.metadata.mockResolvedValue(meta("entity_notes"));
    f.note.mockResolvedValue({ id, contextId: "employer", entityId: "parent" });
    expect(await presentAuthorizedRecordGoSource(viewer, "entity_note", id)).toBeNull();
  });
  it.each([
    ["employer", "employers", "/employers"],
    ["grievance", "grievances", "/grievance"],
  ])("keeps the declared %s source alias on its existing Go destination", async (kind, context, href) => {
    f.metadata.mockResolvedValue(meta(context));
    expect((await presentAuthorizedRecordGoSource(viewer, kind, id))?.href).toBe(`${href}/${id}`);
  });
});
