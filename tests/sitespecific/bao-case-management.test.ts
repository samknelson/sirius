import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db } from "../../server/db";
import { storage } from "../../server/storage";
import { getOptionsStorage, getOptionsType } from "../../server/modules/options-registry";
import { getComponentById } from "@shared/components";
import { notes, sitespecificBaoCases } from "@shared/schema";
import caseManagementMigration from "../../scripts/migrate/components/sitespecific.bao/010_create_case_management";

const run = `bao-case-test-${Date.now()}`;
let available = false;
let workerId = "";
let otherWorkerId = "";
let userId = "";
let noteTypeId = "";
let openStatusId = "";
let closedStatusId = "";
let resolutionId = "";
const caseIds: string[] = [];
const noteIds: string[] = [];

beforeAll(async () => {
  // Component migrations are the supported schema path. Provision the focused
  // BAO case tables rather than silently dropping coverage on a non-BAO DB.
  await caseManagementMigration.up();
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
});

afterAll(async () => {
  if (!available) return;
  for (const id of caseIds) await db.delete(sitespecificBaoCases).where(eq(sitespecificBaoCases.id, id));
  for (const id of noteIds) await db.delete(notes).where(eq(notes.id, id));
  const options = getOptionsStorage();
  await options.delete("bao-case-status", openStatusId).catch(() => {});
  await options.delete("bao-case-status", closedStatusId).catch(() => {});
  await options.delete("bao-case-resolution", resolutionId).catch(() => {});
});

describe("BAO case registration and component ownership", () => {
  it("registers component-gated status and resolution lists", () => {
    expect(getOptionsType("bao-case-status")?.requiredComponent).toBe("sitespecific.bao");
    expect(getOptionsType("bao-case-resolution")?.requiredComponent).toBe("sitespecific.bao");
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