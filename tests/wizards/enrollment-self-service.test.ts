import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express, { type RequestHandler } from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

const state = vi.hoisted(() => ({
  rows: new Map<string, any>(), files: new Map<string, any>(),
  component: true, cobra: false, medical: false, active: false, window: true,
  deadline: "2099-12-31", elected: false, caseClosed: false, related: true, matched: true,
}));
vi.mock("../../server/services/access-policy-evaluator", async original => {
  const allowed = (user: any, policy: string, entityId?: string) => {
    if (!user) return false;
    if (policy === "authenticated") return true;
    if (policy === "admin") return user.role === "admin";
    if (policy === "staff") return user.role === "staff" || user.role === "admin";
    const own = user.role === "staff" || user.role === "admin" ||
      (user.role === "worker" && entityId === "own-worker");
    if (policy === "worker.cobra") return own && state.cobra && !state.caseClosed;
    if (policy === "worker.mine" || policy === "worker.view") return own;
    return false;
  };
  return {
    ...await original<any>(),
    checkAccessInline: async (req: any, policy: string, entityId?: string) =>
      ({ granted: allowed(req.user?.dbUser, policy, entityId) }),
    checkAccess: async (policy: string, user: any, entityId?: string) =>
      ({ granted: allowed(user, policy, entityId) }),
    buildContext: async (req: any) => ({ user: req.user?.dbUser }),
  };
});
vi.mock("../../server/modules/components", () => ({
  isComponentEnabled: async () => state.component,
  requireComponent: () => ((_req: any, res: any, next: any) =>
    state.component ? next() : res.sendStatus(403)),
}));
vi.mock("../../server/services/component-cache", async original => ({
  ...await original<any>(), isComponentEnabledSync: () => state.component,
}));
vi.mock("../../server/plugins/wizards", async () =>
  await import("../../server/plugins/wizards/registry"));
vi.mock("../../server/storage/transaction-context", async original => ({
  ...await original<any>(), runInTransaction: async (callback: any) => callback(),
}));
vi.mock("../../server/plugins/wizards/attachments", () => ({
  createWizardAttachment: async (input: any) => {
    const file = { id: `file-${state.files.size}`, fileName: input.fileName, wizardId: input.wizardId };
    state.files.set(file.id, file);
    return file;
  },
  listWizardAttachments: async (wizardId: string) =>
    [...state.files.values()].filter(file => file.wizardId === wizardId),
  deleteWizardWithAttachments: async () => ({ deleted: true }),
}));
vi.mock("../../server/storage/unified-options", () => ({
  createUnifiedOptionsStorage: () => ({
    get: async (type: string, id: string) => type === "worker-relation-type"
      ? { id, name: "Spouse" } : { id, name: "New", closed: state.caseClosed },
    list: async () => [{ id: "pending", name: "Pending First Payment", closed: false }],
  }),
}));
vi.mock("../../server/plugins/trust/eligibility/executor", () => ({
  evaluateBenefitEligibility: async () => ({ eligible: true, results: [] }),
  pluginConfigToEligibilityRule: vi.fn(),
}));

import { storage } from "../../server/storage";
import { checkAccessInline } from "../../server/services/access-policy-evaluator";
import { registerWizardRoutes } from "../../server/modules/wizards";
import { registerWizardDispatcherRoutes } from "../../server/plugins/wizards/dispatcher";
import { registerWorkerTrustElectionsRoutes } from "../../server/modules/trust/elections";
import { benefitElectionEnrollmentPlugin } from "../../server/plugins/wizards/plugins/benefit-election-enrollment";
import { openEnrollmentEnrollmentPlugin } from "../../server/plugins/wizards/plugins/open-enrollment-enrollment";
import { lifeEventEnrollmentPlugin } from "../../server/plugins/wizards/plugins/life-event-enrollment";
import { baoCobraEnrollmentPlugin } from "../../server/plugins/wizards/plugins/bao-cobra-enrollment";
import { computeDefaultEffectiveDate } from "../../server/plugins/wizards/enrollment/foundation";
import workerMine from "../../shared/access-policies/worker/mine";
import { findSystemHelpsForPath } from "../../server/help/system";

const plugins = [benefitElectionEnrollmentPlugin, openEnrollmentEnrollmentPlugin,
  lifeEventEnrollmentPlugin, baoCobraEnrollmentPlugin];
let server: Server;
let origin: string;
const caseRow = () => ({
  id: "case", coveredPersonWorkerId: "own-worker", subscriberWorkerId: "own-worker",
  statusId: "new", electionMadeYmd: state.elected ? "2026-01-01" : null,
  lastDayToElectYmd: state.deadline, cobraEffectiveYmd: "2026-01-01",
  source: "manual", medicalBenefitLostId: "medical", dentalBenefitLostId: null,
});
const activeView = () => ({
  id: "current-election", workerId: "own-worker", employerId: "employer",
  employerName: "Fictional employer", policyId: "policy", policyName: "Policy",
  benefitIds: ["medical"], benefits: [{ id: "medical", name: "Medical" }],
  relationshipIds: [], relationships: [],
});
async function request(path: string, method = "GET", body?: any, actor = "worker") {
  return fetch(`${origin}${path}`, {
    method, headers: { "Content-Type": "application/json", ...(actor ? { "x-fixture-actor": actor } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
async function create(type: string, overrides: any = {}, actor = "worker") {
  return request("/api/wizards", "POST", {
    type, entityId: "own-worker", data: { launchArguments: { workerId: "own-worker" } }, ...overrides,
  }, actor);
}
async function step(id: string, name: string, input: any, actor = "worker") {
  return request(`/api/wizards/${id}/dispatch/${name}/submit`, "POST", { input }, actor);
}
async function upload(id: string, stepId: string, actor = "worker") {
  const data = new FormData();
  data.append("file", new Blob(["fictional evidence"], { type: "application/pdf" }), "evidence.pdf");
  return fetch(`${origin}/api/wizards/${id}/dispatch/${stepId}/upload`, {
    method: "POST", headers: { "x-fixture-actor": actor }, body: data,
  });
}

beforeAll(async () => {
  vi.spyOn(storage.wizards, "getById").mockImplementation(async id => structuredClone(state.rows.get(id)));
  vi.spyOn(storage.wizards, "create").mockImplementation(async input => {
    const row = { id: `wizard-${state.rows.size}`, ...structuredClone(input) };
    state.rows.set(row.id, row);
    return row as any;
  });
  vi.spyOn(storage.wizards, "update").mockImplementation(async (id, input) => {
    const row = { ...state.rows.get(id), ...structuredClone(input) };
    state.rows.set(id, row);
    return row;
  });
  vi.spyOn(storage.wizards, "list").mockImplementation(async filters => [...state.rows.values()]
    .filter(row => (!filters?.type || row.type === filters.type) && (!filters?.entityId || row.entityId === filters.entityId)));
  vi.spyOn(storage.workers, "getWorker").mockImplementation(async id => ({ id }) as any);
  vi.spyOn(storage.workers, "getWorkerDisplayName").mockResolvedValue("Fictional Worker");
  vi.spyOn(storage.workerHours, "getCurrentEmployment").mockResolvedValue([{ employerId: "employer", home: true }] as any);
  vi.spyOn(storage.employers, "getEmployer").mockResolvedValue({ id: "employer", name: "Employer", denormPolicyId: "policy" } as any);
  vi.spyOn(storage.employerPolicyHistory, "getEmployerPolicyHistory").mockResolvedValue([]);
  vi.spyOn(storage.policies, "getPolicyById").mockResolvedValue({ id: "policy", name: "Policy", data: { benefitIds: ["medical"] } } as any);
  vi.spyOn(storage.policies, "getPolicyBySiriusId").mockResolvedValue({ id: "cobra-policy" } as any);
  vi.spyOn(storage.employers, "getBySiriusId").mockResolvedValue({ id: "cobra-employer" } as any);
  vi.spyOn(storage.workerTrustElections, "hasActiveMedicalOrDentalElection").mockImplementation(async () => state.medical);
  vi.spyOn(storage.workerTrustElections, "getActiveByWorker").mockImplementation(async workerId => state.active ? { ...activeView(), workerId } as any : undefined);
  vi.spyOn(storage.workerTrustElections, "getActiveViewByWorker").mockImplementation(async workerId => state.active ? { ...activeView(), workerId } as any : undefined);
  vi.spyOn(storage.workerTrustElections, "getViewById").mockImplementation(async () => activeView() as any);
  vi.spyOn(storage.workerTrustElections, "searchViews").mockResolvedValue([]);
  vi.spyOn(storage.workerTrustElections, "checkDualCoverage").mockResolvedValue([]);
  vi.spyOn(storage.workerTrustElections, "create").mockResolvedValue({ id: "posted-election" } as any);
  vi.spyOn(storage.pluginConfigs, "search").mockResolvedValue([]);
  vi.spyOn(storage.trustBenefits, "getAllTrustBenefits").mockResolvedValue([{ id: "medical", name: "Medical" }] as any);
  vi.spyOn(storage.trustBenefits, "getTrustBenefit").mockResolvedValue({ id: "medical", name: "Medical" } as any);
  vi.spyOn(storage.baoCobraCases, "hasActiveCaseForCoveredPerson").mockImplementation(async () => state.cobra);
  vi.spyOn(storage.baoCobraCases, "listActiveUnelectedCasesForCoveredPerson").mockImplementation(async () =>
    state.cobra && !state.elected && !state.caseClosed ? [caseRow()] as any : []);
  vi.spyOn(storage.baoCobraCases, "getRaw").mockImplementation(async () => caseRow() as any);
  vi.spyOn(storage.baoCobraCases, "getForUpdate").mockImplementation(async () => caseRow() as any);
  vi.spyOn(storage.baoCobraCases, "updateEnforcingInvariants").mockResolvedValue(caseRow() as any);
  vi.spyOn(storage.baoCobraRates, "tableExists").mockResolvedValue(true);
  vi.spyOn(storage.baoCobraRates, "getEffectiveRate").mockResolvedValue({ rate: "100.00" } as any);
  vi.spyOn(storage.workerRelations, "searchWorkerRelations").mockImplementation(async params =>
    state.related ? [{ id: "established-relation", worker1: params.workerId, worker2: "dependent",
      relationType: "spouse" }] as any : []);
  vi.spyOn(storage.workerRelations, "create").mockResolvedValue({ id: "dependent-relation" } as any);
  vi.spyOn(storage.workers, "getWorkerBySSN").mockImplementation(async () =>
    state.matched ? { id: "dependent", contactId: "contact" } as any : undefined);
  vi.spyOn(storage.workers, "createWorker").mockResolvedValue({ id: "dependent-new" } as any);
  vi.spyOn(storage.workers, "updateWorkerSSN").mockResolvedValue(undefined as any);
  vi.spyOn(storage.workers, "updateWorkerContactBirthDate").mockResolvedValue(undefined as any);
  vi.spyOn(storage.workers, "updateWorkerContactGender").mockResolvedValue(undefined as any);
  vi.spyOn(storage.contacts, "getContact").mockResolvedValue({ birthDate: "1990-01-01", displayName: "Private Name" } as any);
  vi.spyOn(storage.openEnrollmentWindows, "getActiveWindow").mockImplementation(async () => state.window
    ? { id: "window", planYear: 2027, startYmd: "2026-01-01", endYmd: "2099-12-31" } as any : undefined);
  const app = express();
  app.use(express.json());
  const requireAuth: RequestHandler = (req, res, next) => {
    const role = req.header("x-fixture-actor");
    if (!role) return void res.sendStatus(401);
    req.user = { claims: { sub: role }, dbUser: { id: role, role } } as any;
    next();
  };
  const requireAccess = (policy: string, entity?: (req: any) => string | Promise<string | undefined> | undefined): RequestHandler =>
    async (req, res, next) => {
      if ((await checkAccessInline(req, policy, await entity?.(req))).granted) next();
      else res.sendStatus(403);
    };
  registerWizardRoutes(app, requireAuth, key => requireAccess(key));
  registerWizardDispatcherRoutes(app, requireAuth);
  registerWorkerTrustElectionsRoutes(app, requireAuth, requireAccess);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
beforeEach(() => {
  state.rows.clear(); state.files.clear(); vi.clearAllMocks();
  Object.assign(state, { component: true, cobra: false, medical: false, active: false,
    window: true, deadline: "2099-12-31", elected: false, caseClosed: false, related: true, matched: true });
});
afterAll(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
  vi.restoreAllMocks();
});

describe("worker-only enrollment authorization through real HTTP routes", () => {
  it.each(plugins)("scopes create, read, dispatch, files, and schema for $id", async plugin => {
    state.cobra = plugin.id === "bao_cobra_enrollment";
    state.active = plugin.id === "life_event_enrollment";
    const response = await create(plugin.id, { status: "posted", currentStep: "review",
      data: { launchArguments: { workerId: "own-worker" }, signature: { type: "typed", value: "forged" },
        electionId: "forged", progress: { review: { status: "completed" } } } });
    expect(response.status).toBe(201);
    const row = await response.json();
    expect(row.entityId).toBe("own-worker");
    expect(row.status).toBe("draft");
    expect(row.currentStep).toBe(plugin.steps[0].id);
    expect(row.data.signature).toBeUndefined();
    expect(row.data.electionId).toBeUndefined();
    expect((await request(`/api/wizards/${row.id}`)).status).toBe(200);
    expect((await request(`/api/wizard-types/${plugin.id}/launch-schema?entityId=own-worker`)).status).toBe(200);
    expect((await request(`/api/wizard-types/${plugin.id}/launch-schema?entityId=other-worker`)).status).toBe(403);
    expect((await request(`/api/wizards?type=${plugin.id}&entityId=own-worker`)).status).toBe(200);
    for (const actor of ["unlinked", "other-worker"]) {
      expect((await request(`/api/wizards/${row.id}`, "GET", undefined, actor)).status).toBe(403);
      expect((await step(row.id, "signature", { signature: { type: "typed", value: "No" } }, actor)).status).toBe(403);
      expect((await upload(row.id, "signature", actor)).status).toBe(403);
      expect((await request(`/api/wizards/${row.id}/files`, "GET", undefined, actor)).status).toBe(403);
    }
    state.rows.set(row.id, { ...row, entityId: "other-worker" });
    expect((await request(`/api/wizards/${row.id}`)).status).toBe(403);
    expect((await step(row.id, "signature", {})).status).toBe(403);
    expect(state.files.size).toBe(0);
  });

  it.each(plugins)("rejects conflicting identity, missing scope and unlinked launches for $id", async plugin => {
    state.cobra = plugin.id === "bao_cobra_enrollment";
    state.active = plugin.id === "life_event_enrollment";
    for (const overrides of [
      { entityId: "other-worker" },
      { data: { launchArguments: { workerId: "other-worker" } } },
      { data: { workerId: "other-worker", launchArguments: { workerId: "own-worker" } } },
      { entityId: null },
    ]) {
      expect((await create(plugin.id, overrides)).status).toBeGreaterThanOrEqual(400);
    }
    expect((await create(plugin.id, {}, "unlinked")).status).toBe(403);
    expect(storage.wizards.create).not.toHaveBeenCalled();
  });

  it.each(plugins)("refuses scope/type/state PATCH and retains legacy staff access for $id", async plugin => {
    state.cobra = plugin.id === "bao_cobra_enrollment";
    state.active = plugin.id === "life_event_enrollment";
    const row = await (await create(plugin.id)).json();
    for (const changes of [{ entityId: "other-worker" }, { type: "worker_ratings_import" },
      { data: { workerId: "other-worker" } }, { status: "posted" }, { currentStep: "review" },
      { data: { signature: { type: "typed", value: "forged" }, benefitIds: ["forged"] } }]) {
      expect((await request(`/api/wizards/${row.id}`, "PATCH", changes)).status).toBe(400);
    }
    state.rows.set(row.id, { ...row, entityId: null });
    expect((await request(`/api/wizards/${row.id}`)).status).toBe(403);
    expect((await request(`/api/wizards/${row.id}`, "GET", undefined, "staff")).status).toBe(200);
    expect((await step(row.id, "signature", { signature: { type: "typed", value: "Staff" } }, "staff")).status).toBe(200);
  });

  it("retains staff launch compatibility and denies direct manual create to workers", async () => {
    expect((await create(plugins[0].id, { entityId: null }, "staff")).status).toBe(201);
    expect((await request("/api/workers/own-worker/trust-elections", "POST", {
      employerId: "employer", startYmd: "2026-01-01", benefitIds: ["medical"],
    })).status).toBe(403);
    expect(storage.workerTrustElections.create).not.toHaveBeenCalled();
    expect((await request("/api/workers/own-worker/trust-elections")).status).toBe(200);
    expect((await request("/api/workers/other-worker/trust-elections")).status).toBe(403);
  });

  it.each(plugins.slice(0, 3))("lets unlinked staff complete $id on behalf of another worker", async plugin => {
    state.active = plugin.id === "life_event_enrollment";
    state.related = false; // Staff may establish the relationship on behalf of the worker.
    const response = await create(plugin.id, {
      entityId: "other-worker", data: { launchArguments: { workerId: "other-worker" } },
    }, "staff");
    expect(response.status).toBe(201);
    const row = await response.json();
    expect(row.entityId).toBe("other-worker");
    expect(row.data.workerId).toBe("other-worker");
    expect((await request(`/api/wizards/${row.id}`, "GET", undefined, "staff")).status).toBe(200);
    expect((await request(`/api/wizards/${row.id}`)).status).toBe(403);
    const submit = (name: string, input: any) => step(row.id, name, input, "staff");
    if (plugin.id === "life_event_enrollment") {
      expect((await submit("event_type", { eventType: "marriage" })).status).toBe(200);
      const uploaded = await upload(row.id, "dependents", "staff");
      expect(uploaded.status).toBe(200);
      const evidence = (await uploaded.json()).data.pendingDocument.fileId;
      expect((await submit("dependents", { action: "add", ssn: "123-45-6789", birthDate: "1990-01-01",
        relationTypeId: "spouse", documentFileId: evidence })).status).toBe(200);
    } else {
      expect((await submit("employer_policy", { employerId: "employer" })).status).toBe(200);
      expect((await submit("benefits", { benefitIds: ["medical"] })).status).toBe(200);
    }
    expect((await submit("effective_date", {
      startYmd: plugin.id === "open_enrollment_enrollment" ? "2027-01-01" : computeDefaultEffectiveDate(),
    })).status).toBe(200);
    expect((await submit("signature", { signature: { type: "typed", value: "Fictional Worker" } })).status).toBe(200);
    const posted = await submit("review", { action: "post" });
    expect(posted.status, await posted.clone().text()).toBe(200);
    expect(storage.workerTrustElections.create).toHaveBeenCalledWith("other-worker", expect.anything());
  });

  it.each(plugins.slice(0, 3))("refuses to disclose, link or modify an unrelated matched person through $id", async plugin => {
    state.active = plugin.id === "life_event_enrollment";
    state.related = false;
    const row = await (await create(plugin.id)).json();
    if (state.active) expect((await step(row.id, "event_type", { eventType: "marriage" })).status).toBe(200);
    const lookup = await step(row.id, "dependents", { action: "lookup", ssn: "123-45-6789", birthDate: "1990-01-01" });
    expect(lookup.status).toBe(200);
    const lookupData = (await lookup.json()).data.dependentLookup;
    expect(lookupData).toMatchObject({ status: "requires_staff" });
    expect(lookupData).not.toHaveProperty("workerId");
    expect(lookupData).not.toHaveProperty("name");
    expect(lookupData).not.toHaveProperty("genderCalc");
    const evidence = await upload(row.id, "dependents");
    const documentFileId = (await evidence.json()).data.pendingDocument.fileId;
    // Direct POST bypasses the disabled client, with an owned document and a
    // valid relationship option: neither establishes authority over the match.
    const added = await step(row.id, "dependents", { action: "add", ssn: "123-45-6789",
      birthDate: "1990-01-01", relationTypeId: "spouse", gender: "forged-gender", documentFileId });
    expect(added.status).toBeGreaterThanOrEqual(400);
    const response = await added.text();
    expect(response).not.toContain("Private Name");
    expect(response).not.toContain('"workerId":"dependent"');
    expect(storage.workers.updateWorkerContactGender).not.toHaveBeenCalled();
    expect(storage.workers.createWorker).not.toHaveBeenCalled();
    expect(storage.workers.updateWorkerSSN).not.toHaveBeenCalled();
    expect(storage.workers.updateWorkerContactBirthDate).not.toHaveBeenCalled();
    expect(storage.workerRelations.create).not.toHaveBeenCalled();
    expect(state.rows.get(row.id).data.dependents ?? []).toEqual([]);
  });

  it("still permits a new dependent, and reuses established matches without deleting the established relationship", async () => {
    const row = await (await create(plugins[0].id)).json();
    const evidence = await upload(row.id, "dependents");
    const documentFileId = (await evidence.json()).data.pendingDocument.fileId;
    const input = { action: "add", ssn: "123-45-6789", birthDate: "1990-01-01",
      given: "Fictional", family: "Dependent", relationTypeId: "spouse", documentFileId };
    const matched = await step(row.id, "dependents", input);
    expect(matched.status).toBe(200);
    expect((await matched.json()).data.dependents[0]).toMatchObject({
      relationId: "established-relation", createdByWizard: false, matchedExisting: true,
    });
    expect(storage.workerRelations.create).not.toHaveBeenCalled();
    expect((await step(row.id, "dependents", { action: "remove", relationId: "established-relation" })).status).toBe(200);
    state.matched = false;
    const newDependent = await step(row.id, "dependents", input);
    expect(newDependent.status).toBe(200);
    expect(storage.workers.createWorker).toHaveBeenCalledWith("Fictional Dependent");
    expect(storage.workerRelations.create).toHaveBeenCalledWith(expect.objectContaining({
      worker1: "own-worker", worker2: "dependent-new",
    }));
  });

  it("does not let a worker change an established dependent's relationship type to authorize a contact change", async () => {
    const row = await (await create(plugins[0].id)).json();
    const evidence = await upload(row.id, "dependents");
    const documentFileId = (await evidence.json()).data.pendingDocument.fileId;
    const added = await step(row.id, "dependents", { action: "add", ssn: "123-45-6789",
      birthDate: "1990-01-01", relationTypeId: "different-type", gender: "forged-gender", documentFileId });
    expect(added.status).toBeGreaterThanOrEqual(400);
    expect(storage.workers.updateWorkerContactGender).not.toHaveBeenCalled();
    expect(storage.workerRelations.create).not.toHaveBeenCalled();
  });

  it.each(plugins)("rejects persisted launch/data identity conflicts for $id", async plugin => {
    state.cobra = plugin.id === "bao_cobra_enrollment";
    state.active = plugin.id === "life_event_enrollment";
    const row = await (await create(plugin.id)).json();
    for (const changed of [{ workerId: "other-worker" },
      { launchArguments: { workerId: "other-worker" } }, { coveredPersonWorkerId: "other-worker" }]) {
      state.rows.set(row.id, { ...row, data: { ...row.data, ...changed } });
      expect((await request(`/api/wizards/${row.id}`)).status).toBe(403);
      expect((await upload(row.id, "signature")).status).toBe(403);
      expect((await step(row.id, "signature", { signature: { type: "typed", value: "No" } })).status).toBe(403);
    }
  });

  it("gates own-worker eligibility and creation on current elections, COBRA, windows, and components", async () => {
    for (const endpoint of ["first-time", "life-event", "open-enrollment"]) {
      expect((await request(`/api/workers/other-worker/trust-elections/${endpoint}-eligibility`)).status).toBe(403);
      expect((await request(`/api/workers/own-worker/trust-elections/${endpoint}-eligibility`, "GET", undefined, "unlinked")).status).toBe(403);
    }
    state.medical = true;
    expect((await (await request("/api/workers/own-worker/trust-elections/first-time-eligibility")).json()).eligible).toBe(false);
    expect((await create(plugins[0].id)).status).toBe(400);
    expect((await create(plugins[2].id)).status).toBe(400);
    state.window = false;
    expect((await create(plugins[1].id)).status).toBe(400);
    state.cobra = true;
    for (const endpoint of ["first-time", "life-event", "open-enrollment"]) {
      const answer = await (await request(`/api/workers/own-worker/trust-elections/${endpoint}-eligibility`)).json();
      expect(answer).toMatchObject({ eligible: false, reason: expect.stringContaining("COBRA") });
    }
    for (const plugin of plugins.slice(0, 3)) expect((await create(plugin.id)).status).toBe(400);
    state.deadline = "2000-01-01";
    expect((await create(plugins[3].id)).status).toBe(400);
    state.component = false;
    expect((await create(plugins[0].id)).status).toBe(403);
  });

  it.each(plugins)("completes worker steps, evidence, signature, review and post for $id", async plugin => {
    const cobra = plugin.id === "bao_cobra_enrollment";
    const life = plugin.id === "life_event_enrollment";
    state.cobra = cobra; state.active = life;
    const row = await (await create(plugin.id)).json();
    const post = () => step(row.id, "review", { action: "post" });
    expect((await post()).status).toBeGreaterThanOrEqual(400);
    if (cobra) {
      expect((await step(row.id, "coverage", { coverageChoice: "medical" })).status).toBe(200);
      expect((await step(row.id, "covered_people", { relationIds: [] })).status).toBe(200);
    } else {
      if (life) expect((await step(row.id, "event_type", { eventType: "marriage" })).status).toBe(200);
      else {
        expect((await step(row.id, "employer_policy", { employerId: "employer" })).status).toBe(200);
        expect((await step(row.id, "benefits", { benefitIds: ["medical"] })).status).toBe(200);
      }
      const lookup = await step(row.id, "dependents", { action: "lookup", ssn: "123-45-6789", birthDate: "1990-01-01" });
      expect(lookup.status).toBe(200);
      expect((await lookup.json()).data.dependentLookup).not.toHaveProperty("workerId");
      const add = { action: "add", ssn: "123-45-6789", birthDate: "1990-01-01", relationTypeId: "spouse", documentFileId: "foreign-file" };
      state.files.set("foreign-file", { id: "foreign-file", wizardId: "other-enrollment" });
      expect((await step(row.id, "dependents", add)).status).toBeGreaterThanOrEqual(400);
      expect(storage.workerRelations.create).not.toHaveBeenCalled();
      const evidence = await upload(row.id, "dependents");
      expect(evidence.status).toBe(200);
      const documentId = (await evidence.json()).data.pendingDocument.fileId;
      expect((await step(row.id, "dependents", { ...add, documentFileId: documentId })).status).toBe(200);
      expect((await step(row.id, "effective_date", { startYmd: plugin.id === "open_enrollment_enrollment" ? "2027-01-01" : computeDefaultEffectiveDate() })).status).toBe(200);
    }
    expect((await upload(row.id, "signature")).status).toBe(200);
    const signature = state.rows.get(row.id).data.signature;
    const storedSignature = state.files.get(signature.fileId);
    state.files.delete(signature.fileId);
    expect((await post()).status).toBeGreaterThanOrEqual(400);
    expect(storage.workerTrustElections.create).not.toHaveBeenCalled();
    state.files.set(signature.fileId, storedSignature);
    if (cobra) state.deadline = "2000-01-01";
    else if (life) state.active = false;
    else if (plugin.id === "open_enrollment_enrollment") state.window = false;
    else state.medical = true;
    expect((await post()).status).toBeGreaterThanOrEqual(400);
    expect(storage.workerTrustElections.create).not.toHaveBeenCalled();
    Object.assign(state, { deadline: "2099-12-31", active: life, window: true, medical: false });
    const posted = await post();
    expect(posted.status, await posted.clone().text()).toBe(200);
    expect((await posted.json()).status).toBe("posted");
    expect(storage.workerTrustElections.create).toHaveBeenCalledWith("own-worker", expect.objectContaining({
      enrollmentType: cobra ? "cobra" : life ? "life_event" : plugin.id === "open_enrollment_enrollment" ? "open_enrollment" : "first_time",
    }));
    expect((await step(row.id, "signature", { signature: { type: "typed", value: "Again" } })).status).toBeGreaterThanOrEqual(400);
  });
});

describe("actual ownership policy and built-in help", () => {
  it("requires the worker permission and exact linked identity, while retaining staff", async () => {
    for (const [permissions, linked, entityId, granted] of [
      [["worker"], "own", "own", true], [["worker"], "own", "other", false],
      [["worker"], null, "own", false], [[], "own", "own", false], [["staff"], null, "other", true],
    ] as const) {
      expect((await workerMine.evaluate!({
        hasPermission: async (permission: string) => (permissions as readonly string[]).includes(permission),
        getUserWorker: async () => linked ? { id: linked } : null, entityId,
      } as any)).granted).toBe(granted);
    }
  });
  it("separates worker and staff help and keeps matching narrow and HTML sanitized", () => {
    for (const tab of ["current", "list"]) {
      const helps = findSystemHelpsForPath(`/workers/fictional/elections/${tab}`);
      const entry = helps.find(help => help.id === "system:elections-current")!;
      expect(entry.details).toContain("own linked worker");
      expect(entry.details).toContain("<strong>New Election");
      expect(helps.some(help => help.id === "system:enrollment-review")).toBe(false);
    }
    for (const path of ["/workers/fictional/elections/current/edit", "/workers/fictional/benefits/current",
      "/workers/fictional/elections/listing", "/config/helps"]) {
      expect(findSystemHelpsForPath(path).some(help => help.id === "system:elections-current")).toBe(false);
    }
    expect(findSystemHelpsForPath("/trust/enrollment-queue").some(help => help.id === "system:enrollment-review")).toBe(true);
    expect(findSystemHelpsForPath("/workers/fictional/sitespecific/bao/cobra")
      .find(help => help.id === "system:bao-cobra-lifecycle")?.details).toContain("Worker self-service");
  });
});
