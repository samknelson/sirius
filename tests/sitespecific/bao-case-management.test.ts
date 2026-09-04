import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { eventBus, EventType } from "../../server/services/event-bus";
import { assignmentForbidden } from "../../server/storage/sitespecific/bao/case-assignment";
import { eq, sql } from "drizzle-orm";
import { db } from "../../server/db";
import { storage } from "../../server/storage";
import { getOptionsStorage, getOptionsType } from "../../server/modules/options-registry";
import { getComponentById } from "@shared/components";
import { notes, rolePermissions, roles, sitespecificBaoCases, userRoles, users } from "@shared/schema";
import { ensureBaoCaseSchema } from "./fixtures/bao-schema";

const run = `bao-case-test-${Date.now()}`;
let available = false;
let workerId = "";
let otherWorkerId = "";
let userId = "";
let secondUserId = "";
let secondRoleId = "";
let noteTypeId = "";
let openStatusId = "";
let closedStatusId = "";
let resolutionId = "";
const caseIds: string[] = [];
const noteIds: string[] = [];

beforeAll(async () => {
  // Component migrations are the supported schema path. Provision the focused
  // BAO case tables rather than silently dropping coverage on a non-BAO DB.
  await ensureBaoCaseSchema();
  available = await storage.baoCases.tableExists();
  if (!available) throw new Error("BAO case migration did not create its tables");
  const workers = await storage.workers.getAllWorkers();
  const assignees = await storage.users.getUsersWithAnyPermission(["staff", "admin"]);
  const noteTypes = await getOptionsStorage().list("note-type");
  const workerType = noteTypes.find((t: any) => t.data?.entityTypes?.includes("worker"));
  if (workers.length < 2 || !assignees[0] || !workerType) {
    throw new Error("BAO case tests require two workers, one staff user, and a worker note type");
  }
  workerId = workers[0].id;
  otherWorkerId = workers[1].id;
  userId = assignees[0].id;
  noteTypeId = workerType.id;
  const options = getOptionsStorage();
  openStatusId = (await options.create("bao-case-status", { name: `${run}-open`, closed: false })).id;
  closedStatusId = (await options.create("bao-case-status", { name: `${run}-closed`, closed: true })).id;
  resolutionId = (await options.create("bao-case-resolution", { name: `${run}-resolved` })).id;
  // A second assignable staff user, created for the assignment-race coverage.
  const secondUser = await storage.users.createUser({
    email: `${run}@example.test`,
    firstName: "Race",
    lastName: "Tester",
  } as any);
  secondUserId = secondUser.id;
  const role = await storage.users.createRole({
    name: `${run}-staff`,
    description: "BAO case test staff role",
  } as any);
  secondRoleId = role.id;
  // Insert the role permission directly: the in-process permission registry
  // is not initialized in this test harness, only the DB rows matter here.
  await db.insert(rolePermissions).values({ roleId: role.id, permissionKey: "staff" });
  await storage.users.assignRoleToUser({ userId: secondUser.id, roleId: role.id } as any);
});

afterAll(async () => {
  if (!available) return;
  for (const id of caseIds) await db.delete(sitespecificBaoCases).where(eq(sitespecificBaoCases.id, id));
  for (const id of noteIds) await db.delete(notes).where(eq(notes.id, id));
  const options = getOptionsStorage();
  await options.delete("bao-case-status", openStatusId).catch(() => {});
  await options.delete("bao-case-status", closedStatusId).catch(() => {});
  await options.delete("bao-case-resolution", resolutionId).catch(() => {});
  if (secondRoleId) {
    await db.delete(userRoles).where(eq(userRoles.roleId, secondRoleId)).catch(() => {});
    await db.delete(rolePermissions).where(eq(rolePermissions.roleId, secondRoleId)).catch(() => {});
    await db.delete(roles).where(eq(roles.id, secondRoleId)).catch(() => {});
  }
  if (secondUserId) await db.delete(users).where(eq(users.id, secondUserId)).catch(() => {});
});

describe("BAO case registration and component ownership", () => {
  it("registers component-gated status and resolution lists", () => {
    expect(getOptionsType("bao-case-status")?.requiredComponent).toBe("sitespecific.bao");
    expect(getOptionsType("bao-case-resolution")?.requiredComponent).toBe("sitespecific.bao");
  });

  it("declares the assign-to-others permission on the BAO component", () => {
    const permissions = getComponentById("sitespecific.bao")?.permissions ?? [];
    expect(permissions.map((p) => p.key)).toContain("bao.case.assign");
  });

  it("declares all case tables in the component manifest", () => {
    const tables = getComponentById("sitespecific.bao")?.schemaManifest?.tables ?? [];
    expect(tables).toEqual(expect.arrayContaining([
      "options_bao_case_status",
      "options_bao_case_resolution",
      "sitespecific_bao_cases",
      "sitespecific_bao_case_notes",
    ]));
  });
});

describe("BAO case assignment authority rule", () => {
  const actor = "actor-1";
  it("allows omitting an assignee and self-assignment without the permission", () => {
    expect(assignmentForbidden({ requestedAssigneeId: undefined, actorUserId: actor, existingAssigneeId: null, canAssignOthers: false })).toBe(false);
    expect(assignmentForbidden({ requestedAssigneeId: actor, actorUserId: actor, existingAssigneeId: null, canAssignOthers: false })).toBe(false);
    // Taking a case assigned to somebody else is always self-assignment.
    expect(assignmentForbidden({ requestedAssigneeId: actor, actorUserId: actor, existingAssigneeId: "other-1", canAssignOthers: false })).toBe(false);
  });

  it("allows a lifecycle edit that echoes the unchanged assignee", () => {
    expect(assignmentForbidden({ requestedAssigneeId: "other-1", actorUserId: actor, existingAssigneeId: "other-1", canAssignOthers: false })).toBe(false);
  });

  it("forbids assigning to another user without the permission, on create and update", () => {
    expect(assignmentForbidden({ requestedAssigneeId: "other-1", actorUserId: actor, existingAssigneeId: null, canAssignOthers: false })).toBe(true);
    expect(assignmentForbidden({ requestedAssigneeId: "other-2", actorUserId: actor, existingAssigneeId: "other-1", canAssignOthers: false })).toBe(true);
  });

  it("allows any assignee with the permission", () => {
    expect(assignmentForbidden({ requestedAssigneeId: "other-2", actorUserId: actor, existingAssigneeId: "other-1", canAssignOthers: true })).toBe(false);
  });

  it("enforces the rule inside the lifecycle transaction", async () => {
    const created = await storage.baoCases.create({
      entityType: "worker", entityId: workerId, deadlineYmd: "2099-08-01",
      statusId: openStatusId, assigneeUserId: secondUserId, actorUserId: userId,
      initialNote: { typeId: noteTypeId, subject: `${run} in-tx enforcement` },
    });
    caseIds.push(created.id);
    noteIds.push((await storage.baoCases.get(created.id, true))!.notes![0].id);
    // Unprivileged reassignment to another user is rejected by storage itself.
    await expect(storage.baoCases.updateLifecycle(
      created.id,
      { assigneeUserId: userId, deadlineYmd: "2099-08-02" },
      { actorUserId: secondUserId === userId ? "someone-else" : "third-user", canAssignOthers: false },
    )).rejects.toThrow("ASSIGN_OTHERS_FORBIDDEN");
    // Taking the case (assigning to the actor) needs no permission.
    await storage.baoCases.updateLifecycle(
      created.id,
      { assigneeUserId: userId },
      { actorUserId: userId, canAssignOthers: false },
    );
    expect((await storage.baoCases.get(created.id))?.assigneeUserId).toBe(userId);
  });

  it("re-checks authority against the row-locked assignee, so a stale unchanged-assignee echo cannot reassign", async () => {
    // Case assigned to the second user. An unprivileged actor echoes that
    // assignee (allowed: unchanged). Concurrently, a permitted user
    // reassigns the case to the actor while holding the row lock. When the
    // echo's transaction finally locks the row, its requested assignee is no
    // longer the current one — it must now be treated as a reassignment and
    // rejected, not written back.
    const created = await storage.baoCases.create({
      entityType: "worker", entityId: workerId, deadlineYmd: "2099-09-01",
      statusId: openStatusId, assigneeUserId: secondUserId, actorUserId: userId,
      initialNote: { typeId: noteTypeId, subject: `${run} stale echo race` },
    });
    caseIds.push(created.id);
    noteIds.push((await storage.baoCases.get(created.id, true))!.notes![0].id);

    let release!: () => void;
    let locked!: () => void;
    const releaseGate = new Promise<void>((resolve) => { release = resolve; });
    const lockedGate = new Promise<void>((resolve) => { locked = resolve; });
    const reassigner = db.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM sitespecific_bao_cases WHERE id = ${created.id} FOR UPDATE`);
      locked();
      await releaseGate;
      await tx.execute(sql`UPDATE sitespecific_bao_cases SET assignee_user_id = ${userId} WHERE id = ${created.id}`);
    });
    await lockedGate;
    const staleEcho = storage.baoCases.updateLifecycle(
      created.id,
      { assigneeUserId: secondUserId, deadlineYmd: "2099-09-02" },
      { actorUserId: userId, canAssignOthers: false },
    );
    release();
    await reassigner;
    await expect(staleEcho).rejects.toThrow("ASSIGN_OTHERS_FORBIDDEN");
    expect((await storage.baoCases.get(created.id))?.assigneeUserId).toBe(userId);
  });
});

describe("BAO case status events", () => {
  afterEach(() => vi.restoreAllMocks());

  function statusEmits(spy: ReturnType<typeof vi.spyOn>) {
    return spy.mock.calls.filter(([type]: [unknown, ...unknown[]]) => type === EventType.BAO_CASE_STATUS_SAVED);
  }

  it("emits a committed snapshot on creation and on lifecycle updates", async () => {
    const spy = vi.spyOn(eventBus, "emit").mockResolvedValue(undefined as any);
    const created = await storage.baoCases.create({
      entityType: "worker", entityId: workerId, deadlineYmd: "2099-06-01",
      statusId: openStatusId, assigneeUserId: userId, actorUserId: userId,
      initialNote: { typeId: noteTypeId, subject: `${run} status events` },
    });
    caseIds.push(created.id);
    noteIds.push((await storage.baoCases.get(created.id, true))!.notes![0].id);
    let emits = statusEmits(spy);
    expect(emits).toHaveLength(1);
    expect(emits[0][1]).toMatchObject({
      caseId: created.id,
      operation: "created",
      previousStatusId: null,
      statusId: openStatusId,
      statusName: `${run}-open`,
      row: expect.objectContaining({ id: created.id, statusId: openStatusId }),
      // Assignment + actor identity, captured by the committed write: null
      // previous assignee on creation, and the creating actor.
      previousAssigneeUserId: null,
      assigneeUserId: userId,
      actorUserId: userId,
    });
    expect(typeof (emits[0][1] as any).assigneeName).toBe("string");

    spy.mockClear();
    await storage.baoCases.updateLifecycle(created.id, {
      statusId: closedStatusId, resolutionId, resolutionYmd: "2099-06-02",
    });
    emits = statusEmits(spy);
    expect(emits).toHaveLength(1);
    expect(emits[0][1]).toMatchObject({
      operation: "updated",
      previousStatusId: openStatusId,
      statusId: closedStatusId,
      statusName: `${run}-closed`,
    });

    // An unchanged-status edit still emits (the notifier filters it), but
    // must carry previous === current so a listener can tell no transition
    // happened.
    spy.mockClear();
    await storage.baoCases.updateLifecycle(created.id, {
      statusId: openStatusId, deadlineYmd: "2099-06-03",
    });
    await storage.baoCases.updateLifecycle(created.id, { deadlineYmd: "2099-06-04" });
    emits = statusEmits(spy);
    expect(emits).toHaveLength(2);
    expect(emits[1][1]).toMatchObject({
      previousStatusId: openStatusId,
      statusId: openStatusId,
    });
  });

  it("carries previous/current assignee and the acting user on a reassignment", async () => {
    const created = await storage.baoCases.create({
      entityType: "worker", entityId: workerId, deadlineYmd: "2099-08-01",
      statusId: openStatusId, assigneeUserId: userId, actorUserId: userId,
      initialNote: { typeId: noteTypeId, subject: `${run} reassignment event` },
    });
    caseIds.push(created.id);
    noteIds.push((await storage.baoCases.get(created.id, true))!.notes![0].id);
    const spy = vi.spyOn(eventBus, "emit").mockResolvedValue(undefined as any);
    // Assignment-only change: status untouched, assignee moves to secondUser.
    await storage.baoCases.updateLifecycle(
      created.id,
      { assigneeUserId: secondUserId },
      { actorUserId: userId, canAssignOthers: true },
    );
    const emits = statusEmits(spy);
    expect(emits).toHaveLength(1);
    expect(emits[0][1]).toMatchObject({
      operation: "updated",
      previousStatusId: openStatusId,
      statusId: openStatusId,
      previousAssigneeUserId: userId,
      assigneeUserId: secondUserId,
      assigneeName: "Race Tester",
      actorUserId: userId,
    });
  });

  it("does not emit for a rolled-back lifecycle write", async () => {
    const created = await storage.baoCases.create({
      entityType: "worker", entityId: workerId, deadlineYmd: "2099-07-01",
      statusId: openStatusId, assigneeUserId: userId, actorUserId: userId,
      initialNote: { typeId: noteTypeId, subject: `${run} rollback` },
    });
    caseIds.push(created.id);
    noteIds.push((await storage.baoCases.get(created.id, true))!.notes![0].id);
    const spy = vi.spyOn(eventBus, "emit").mockResolvedValue(undefined as any);
    await expect(storage.baoCases.updateLifecycle(created.id, { statusId: closedStatusId }))
      .rejects.toThrow("RESOLUTION_REQUIRED");
    expect(statusEmits(spy)).toHaveLength(0);
  });
});

describe("role-filtered staff recipient candidates", () => {
  it("returns only active staff/admin holders of the given role", async () => {
    const inRole = await storage.users.getUsersWithAnyPermissionInRole(secondRoleId, ["staff", "admin"]);
    expect(inRole.map((u) => u.id)).toEqual([secondUserId]);
    // Every returned candidate is active; users outside the role are excluded
    // even when they are staff (userId is staff but not in the test role).
    expect(inRole.every((u) => u.isActive)).toBe(true);
    expect(inRole.map((u) => u.id)).not.toContain(userId);
  });

  it("returns nobody for a role whose members lack staff/admin permissions", async () => {
    const bareRole = await storage.users.createRole({
      name: `${run}-bare`,
      description: "no permissions",
    } as any);
    try {
      await storage.users.assignRoleToUser({ userId: secondUserId, roleId: bareRole.id } as any);
      // secondUser holds staff through their OTHER role, so they still qualify
      // when filtered by the bare role (permission comes from any role)...
      const viaBare = await storage.users.getUsersWithAnyPermissionInRole(bareRole.id, ["staff", "admin"]);
      expect(viaBare.map((u) => u.id)).toEqual([secondUserId]);
      // ...but with the staff role membership removed, the bare role alone
      // does not make them eligible.
      await storage.users.unassignRoleFromUser(secondUserId, secondRoleId);
      const withoutStaff = await storage.users.getUsersWithAnyPermissionInRole(bareRole.id, ["staff", "admin"]);
      expect(withoutStaff).toEqual([]);
    } finally {
      await storage.users.assignRoleToUser({ userId: secondUserId, roleId: secondRoleId } as any).catch(() => {});
      await db.delete(userRoles).where(eq(userRoles.roleId, bareRole.id)).catch(() => {});
      await db.delete(roles).where(eq(roles.id, bareRole.id)).catch(() => {});
    }
  });

  it("resolves saved selections by id regardless of status or role", async () => {
    const found = await storage.users.getUsersByIds([secondUserId, "missing-user-id"]);
    expect(found.map((u) => u.id)).toEqual([secondUserId]);
    expect(await storage.users.getUsersByIds([])).toEqual([]);
  });
});

describe("BAO transactional case invariants", () => {
  function expectLifecycleInvariant(record: Awaited<ReturnType<typeof storage.baoCases.get>>) {
    expect(record).toBeTruthy();
    if (record!.statusClosed) {
      expect(record!.resolutionId).toBeTruthy();
      expect(record!.resolutionYmd).toBeTruthy();
    } else {
      expect(record!.resolutionId).toBeNull();
      expect(record!.resolutionYmd).toBeNull();
    }
  }

  it("creates with an ordinary initial note and enforces one-case-per-note", async (ctx) => {
    if (!available) throw new Error("BAO case schema unavailable");
    const created = await storage.baoCases.create({
      entityType: "worker",
      entityId: workerId,
      deadlineYmd: "2099-01-01",
      statusId: openStatusId,
      assigneeUserId: userId,
      actorUserId: userId,
      initialNote: { typeId: noteTypeId, subject: `${run} initial` },
    });
    caseIds.push(created.id);
    const detail = await storage.baoCases.get(created.id, true);
    expect(detail?.notes).toHaveLength(1);
    noteIds.push(detail!.notes![0].id);
    await expect(storage.baoCases.create({
      entityType: "worker",
      entityId: workerId,
      deadlineYmd: "2099-01-02",
      statusId: openStatusId,
      assigneeUserId: userId,
      actorUserId: userId,
      noteId: detail!.notes![0].id,
    })).rejects.toMatchObject({ cause: { code: "23505" } });
    expect(await storage.baoCases.getByNoteId(detail!.notes![0].id)).toEqual({
      caseId: created.id,
    });
  });

  it("rejects non-staff assignees and exposes linked notes in case detail", async () => {
    await expect(storage.baoCases.create({
      entityType: "worker", entityId: workerId, deadlineYmd: "2099-01-01",
      statusId: openStatusId, assigneeUserId: "00000000-0000-0000-0000-000000000000",
      actorUserId: userId, initialNote: { typeId: noteTypeId, subject: `${run} invalid assignee` },
    })).rejects.toThrow("INVALID_ASSIGNEE");
  });

  it("refuses cross-entity note conversion and preserves the note", async (ctx) => {
    if (!available) throw new Error("BAO case schema unavailable");
    const note = await storage.notes.create({
      entityType: "worker", entityId: workerId, typeId: noteTypeId,
      subject: `${run} cross entity`, body: null, data: null, userId,
    });
    noteIds.push(note.id);
    await expect(storage.baoCases.create({
      entityType: "worker", entityId: otherWorkerId, noteId: note.id,
      deadlineYmd: "2099-01-01", statusId: openStatusId,
      assigneeUserId: userId, actorUserId: userId,
    })).rejects.toThrow("NOTE_ENTITY_MISMATCH");
    expect(await storage.notes.get(note.id)).toBeTruthy();
  });

  it("requires resolution on close and clears it on reopen", async (ctx) => {
    if (!available) throw new Error("BAO case schema unavailable");
    const created = await storage.baoCases.create({
      entityType: "worker", entityId: workerId,
      deadlineYmd: "2099-01-01", statusId: openStatusId,
      assigneeUserId: userId, actorUserId: userId,
      initialNote: { typeId: noteTypeId, subject: `${run} lifecycle` },
    });
    caseIds.push(created.id);
    const initial = await storage.baoCases.get(created.id, true);
    noteIds.push(initial!.notes![0].id);
    await expect(storage.baoCases.updateLifecycle(created.id, { statusId: closedStatusId }))
      .rejects.toThrow("RESOLUTION_REQUIRED");
    await storage.baoCases.updateLifecycle(created.id, {
      statusId: closedStatusId, resolutionId, resolutionYmd: "2099-01-03",
    });
    await storage.baoCases.updateLifecycle(created.id, { statusId: openStatusId });
    const reopened = await storage.baoCases.get(created.id);
    expect(reopened?.resolutionId).toBeNull();
    expect(reopened?.resolutionYmd).toBeNull();
  });

  it("serializes status reclassification with case writes", async () => {
    const created = await storage.baoCases.create({
      entityType: "worker", entityId: workerId, deadlineYmd: "2099-02-01",
      statusId: openStatusId, assigneeUserId: userId, actorUserId: userId,
      initialNote: { typeId: noteTypeId, subject: `${run} serialized` },
    });
    caseIds.push(created.id);
    const detail = await storage.baoCases.get(created.id, true);
    noteIds.push(detail!.notes![0].id);

    // A close classification is rejected while its case is still unresolved.
    await expect(storage.baoCases.updateStatusClassificationAtomically(
      openStatusId, { closed: true },
    )).rejects.toThrow("STATUS_CLASSIFICATION_CONFLICT");

    // Hold the exclusive status lock as a reclassification does, then start a
    // lifecycle write. It cannot complete until that lock is released.
    let release!: () => void;
    const releaseGate = new Promise<void>((resolve) => { release = resolve; });
    let locked!: () => void;
    const lockedGate = new Promise<void>((resolve) => { locked = resolve; });
    const holder = db.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM options_bao_case_status WHERE id = ${openStatusId} FOR UPDATE`);
      locked();
      await releaseGate;
    });
    await lockedGate;
    let settled = false;
    const writer = storage.baoCases.updateLifecycle(created.id, { deadlineYmd: "2099-02-02" })
      .then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    release();
    await holder;
    await writer;
    expect((await storage.baoCases.get(created.id))?.deadlineYmd).toBe("2099-02-02");
  });

  it("filters and paginates active and historical queues", async () => {
    const active = await storage.baoCases.list({
      entityType: "worker", entityId: workerId, closed: false,
      page: 1, pageSize: 1, sort: "deadline", direction: "asc",
    });
    expect(active.items.every((item) => item.entityId === workerId && !item.statusClosed)).toBe(true);
    expect(active.items.length).toBeLessThanOrEqual(1);
    const historical = await storage.baoCases.list({
      entityType: "worker", entityId: workerId, closed: true,
      page: 1, pageSize: 25, sort: "created", direction: "desc",
    });
    expect(historical.items.every((item) => item.statusClosed)).toBe(true);
  });

  it("serializes concurrent close and deadline-only updates on one case", async () => {
    const created = await storage.baoCases.create({
      entityType: "worker", entityId: workerId, deadlineYmd: "2099-04-01",
      statusId: openStatusId, assigneeUserId: userId, actorUserId: userId,
      initialNote: { typeId: noteTypeId, subject: `${run} close deadline race` },
    });
    caseIds.push(created.id);
    noteIds.push((await storage.baoCases.get(created.id, true))!.notes![0].id);

    let release!: () => void;
    let locked!: () => void;
    const releaseGate = new Promise<void>((resolve) => { release = resolve; });
    const lockedGate = new Promise<void>((resolve) => { locked = resolve; });
    const blocker = db.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM sitespecific_bao_cases WHERE id = ${created.id} FOR UPDATE`);
      locked();
      await releaseGate;
    });
    await lockedGate;
    const close = storage.baoCases.updateLifecycle(created.id, {
      statusId: closedStatusId, resolutionId, resolutionYmd: "2099-04-02",
    });
    const deadline = storage.baoCases.updateLifecycle(created.id, { deadlineYmd: "2099-04-03" });
    release();
    await blocker;
    await Promise.all([close, deadline]);
    expectLifecycleInvariant(await storage.baoCases.get(created.id));
  });

  it("serializes concurrent close and reopen/update on one case", async () => {
    const created = await storage.baoCases.create({
      entityType: "worker", entityId: workerId, deadlineYmd: "2099-05-01",
      statusId: openStatusId, assigneeUserId: userId, actorUserId: userId,
      initialNote: { typeId: noteTypeId, subject: `${run} close reopen race` },
    });
    caseIds.push(created.id);
    noteIds.push((await storage.baoCases.get(created.id, true))!.notes![0].id);
    await storage.baoCases.updateLifecycle(created.id, {
      statusId: closedStatusId, resolutionId, resolutionYmd: "2099-05-02",
    });

    let release!: () => void;
    let locked!: () => void;
    const releaseGate = new Promise<void>((resolve) => { release = resolve; });
    const lockedGate = new Promise<void>((resolve) => { locked = resolve; });
    const blocker = db.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM sitespecific_bao_cases WHERE id = ${created.id} FOR UPDATE`);
      locked();
      await releaseGate;
    });
    await lockedGate;
    const closeUpdate = storage.baoCases.updateLifecycle(created.id, {
      statusId: closedStatusId, resolutionId, resolutionYmd: "2099-05-03",
    });
    const reopen = storage.baoCases.updateLifecycle(created.id, {
      statusId: openStatusId, deadlineYmd: "2099-05-04",
    });
    release();
    await blocker;
    await Promise.all([closeUpdate, reopen]);
    expectLifecycleInvariant(await storage.baoCases.get(created.id));
  });
});