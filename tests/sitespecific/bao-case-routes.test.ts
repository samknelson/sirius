import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { registerBaoCaseRoutes } from "../../server/modules/sitespecific/bao/cases";
import { storage } from "../../server/storage";
import { getOptionsStorage } from "../../server/modules/options-registry";
import { updateComponentCache } from "../../server/services/component-cache";
import { ensureBaoCaseSchema, getGeneralCaseTypeId } from "./fixtures/bao-schema";

let base = "";
let closeServer: (() => Promise<void>) | undefined;
let workerId = "";
let otherWorkerId = "";
let staffId = "";
let noteTypeId = "";
let statusId = "";
let closedStatusId = "";
let resolutionId = "";
const run = `bao-route-${Date.now()}`;

async function request(path: string, init: RequestInit & { user?: string; staff?: boolean } = {}) {
  const headers = new Headers(init.headers);
  if (init.user) headers.set("x-user", init.user);
  if (init.staff === false) headers.set("x-staff", "0");
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  return fetch(`${base}${path}`, { ...init, headers });
}

beforeAll(async () => {
  await ensureBaoCaseSchema();
  const workers = await storage.workers.getAllWorkers();
  const staff = (await storage.users.getUsersWithAnyPermission(["staff", "admin"]))[0];
  const type = (await getOptionsStorage().list("note-type")).find((t: any) => t.data?.entityTypes?.includes("worker"));
  if (!workers[0] || !workers[1] || !staff || !type) throw new Error("Route harness prerequisites unavailable");
  workerId = workers[0].id; otherWorkerId = workers[1].id; staffId = staff.id; noteTypeId = type.id;
  const options = getOptionsStorage();
  const caseTypeId = await getGeneralCaseTypeId();
  statusId = (await options.create("bao-case-status", { name: `${run}-open`, closed: false, caseTypeId })).id;
  closedStatusId = (await options.create("bao-case-status", { name: `${run}-closed`, closed: true, caseTypeId })).id;
  resolutionId = (await options.create("bao-case-resolution", { name: `${run}-resolution` })).id;
  const app = express();
  app.use(express.json());
  const requireAuth: any = (req: any, res: any, next: any) => {
    if (!req.header("x-user")) return res.status(401).json({ message: "auth required" });
    req.session = { masqueradeUserId: req.header("x-user") };
    next();
  };
  const requireAccess: any = () => (req: any, res: any, next: any) =>
    req.header("x-staff") === "0" ? res.status(403).json({ message: "staff required" }) : next();
  registerBaoCaseRoutes(app, requireAuth, requireAccess);
  const server = await new Promise<any>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  base = `http://127.0.0.1:${server.address().port}`;
  closeServer = () => new Promise((resolve, reject) => server.close((e: Error) => e ? reject(e) : resolve()));
});

afterAll(async () => {
  await closeServer?.();
  const options = getOptionsStorage();
  await options.delete("bao-case-status", statusId).catch(() => {});
  await options.delete("bao-case-status", closedStatusId).catch(() => {});
  await options.delete("bao-case-resolution", resolutionId).catch(() => {});
});

describe("BAO case route integration", () => {
  it("fails closed when disabled and denies enabled non-staff", async () => {
    await updateComponentCache("sitespecific.bao", false);
    expect((await request("/api/sitespecific/bao/cases", { user: staffId })).status).toBe(403);
    await updateComponentCache("sitespecific.bao", true);
    expect((await request("/api/sitespecific/bao/cases", { user: staffId, staff: false })).status).toBe(403);
  });

  it("uses masqueraded effective user as default assignee and returns queue payloads", async () => {
    const response = await request("/api/sitespecific/bao/cases", {
      method: "POST", user: staffId, body: JSON.stringify({
        entityType: "worker", entityId: workerId, deadlineYmd: "2099-03-01", statusId,
        initialNote: { typeId: noteTypeId, subject: `${run} effective actor` },
      }),
    });
    expect(response.status).toBe(201);
    const created = await response.json();
    expect(created.assigneeUserId).toBe(staffId);
    const queue = await request(`/api/sitespecific/bao/cases?view=active&scope=my&page=1&pageSize=100&sort=deadline&direction=asc&entityType=worker&entityId=${workerId}`, { user: staffId });
    expect(queue.status).toBe(200);
    const payload = await queue.json();
    expect(payload.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: created.id, assigneeUserId: staffId, entityId: workerId }),
    ]));

    const detail = await request(`/api/sitespecific/bao/cases/${created.id}`, { user: staffId });
    expect(detail.status).toBe(200);
    expect((await detail.json()).notes[0].subject).toBe(`${run} effective actor`);
  });

  it("maps cross-entity, duplicate-note, and lifecycle validation errors", async () => {
    const note = await storage.notes.create({ entityType: "worker", entityId: workerId, typeId: noteTypeId, subject: `${run} ordinary`, body: null, data: null, userId: staffId });
    const cross = await request("/api/sitespecific/bao/cases", { method: "POST", user: staffId, body: JSON.stringify({
      entityType: "worker", entityId: otherWorkerId, deadlineYmd: "2099-03-01", statusId, noteId: note.id,
    }) });
    expect(cross.status).toBe(409);

    const first = await request("/api/sitespecific/bao/cases", { method: "POST", user: staffId, body: JSON.stringify({
      entityType: "worker", entityId: workerId, deadlineYmd: "2099-03-02", statusId, noteId: note.id,
    }) });
    expect(first.status).toBe(201);
    const duplicate = await request("/api/sitespecific/bao/cases", { method: "POST", user: staffId, body: JSON.stringify({
      entityType: "worker", entityId: workerId, deadlineYmd: "2099-03-03", statusId, noteId: note.id,
    }) });
    expect(duplicate.status).toBe(409);
    expect((await duplicate.json()).message).toContain("already belongs");

    const created = await first.json();
    const missingResolution = await request(`/api/sitespecific/bao/cases/${created.id}`, {
      method: "PATCH", user: staffId, body: JSON.stringify({ statusId: closedStatusId }),
    });
    expect(missingResolution.status).toBe(409);
    expect((await missingResolution.json()).message).toContain("requires a resolution");

    const invalidOpenResolution = await request(`/api/sitespecific/bao/cases/${created.id}`, {
      method: "PATCH", user: staffId,
      body: JSON.stringify({ resolutionId, resolutionYmd: "2099-03-04" }),
    });
    expect(invalidOpenResolution.status).toBe(409);
    expect((await invalidOpenResolution.json()).message).toContain("open case");
  });
});