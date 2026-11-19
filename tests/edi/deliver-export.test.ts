import express from "express";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readCoverageEvidence } from "../../server/plugins/trust/provider-edi/coverage-evidence";
import { evidenceHash } from "../../server/plugins/trust/provider-edi/coverage-conflicts";
import type { EdiCoverageEntry } from "@shared/edi-coverage-choices";
/** One bounded evidence read: nothing excluded unless a case says so. */
const evidence = vi.hoisted(() => (over: Record<string, unknown> = {}) => ({
  rule: "exclude-conflicting", excludedIds: new Set<string>(), starts: new Map(), terminationCandidates: null,
  exclusions: [] as unknown[], warnings: [] as unknown[], exclusionDigest: "nothing-excluded", fingerprint: "fixture",
  population: 1, timings: [{ phase: "Reading report-month coverage", milliseconds: 1 }],
  budget: { check: () => {}, retain: () => {}, release: () => {}, log: () => {} },
  ...over,
}));
vi.mock("../../server/plugins/trust/provider-edi/coverage-evidence", () => ({
  readCoverageEvidence: vi.fn(async () => evidence()),
}));
import { assembleEdiFileLines } from "../../server/plugins/trust/provider-edi/base";
import { registeredEdiPlugins } from "./fixtures/harness";
import { assertUnmixedCoverage } from "../../server/plugins/trust/provider-edi/coverage-segments";

const state = vi.hoisted(() => ({
  wizard: {} as any,
  rows: [] as any[],
  allowed: true,
  gate: vi.fn(),
  upload: vi.fn(async () => ({ success: true })),
  getRows: vi.fn(),
  update: vi.fn(),
  writeProgress: vi.fn(),
}));
vi.mock("../../server/storage", () => ({ storage: {
  wizards: {
    getById: async () => structuredClone(state.wizard),
    getReportData: (...args: unknown[]) => state.getRows(...args),
    update: (...args: unknown[]) => state.update(...args),
    writeStepProgress: (...args: unknown[]) => state.writeProgress(...args),
    mergeData: async (_id: string, patch: Record<string, unknown>) => {
      state.wizard.data = { ...state.wizard.data, ...patch };
      return state.wizard;
    },
    deleteReportData: async () => { state.rows = []; },
    saveReportData: async (_id: string, pk: string, data: unknown) => { state.rows.push({ pk, data }); },
  },
  sftpClientDestinations: { getById: async () => ({
    id: "destination", name: "Fixture", data: { protocol: "sftp", host: "fixture.invalid", port: 22, username: "fixture", password: "fixture" },
  }) },
} }));
vi.mock("../../server/plugins/_core", async original => ({
  ...await original<any>(),
  enforcePluginGating: (...args: unknown[]) => {
    state.gate(...args);
    return state.allowed ? { ok: true } : { ok: false, status: 403, message: "Forbidden" };
  },
}));
vi.mock("../../server/plugins/wizards/validation-run", async original => ({
  ...await original<any>(), startValidationRun: vi.fn(),
}));
vi.mock("../../server/storage/wizard-validation-lock", () => ({
  withWizardValidationWrite: (write: () => Promise<unknown>) => write(),
}));
vi.mock("../../server/plugins/wizards/process-run", () => ({ startProcessRun: vi.fn(), PROCESS_PROTOCOL: "fixture" }));
vi.mock("../../server/services/file-transfer-client", () => ({ testUpload: (...args: unknown[]) => state.upload(...args as []) }));
vi.mock("../../server/modules/masquerade", () => ({ getEffectiveUser: async () => ({ dbUser: { id: "fixture-user" } }) }));

const { trustProviderEdiWizardPlugin } = await import("../../server/plugins/wizards/plugins/trust-provider-edi");
const { registerWizardDispatcherRoutes } = await import("../../server/plugins/wizards/dispatcher");
let server: Server;
let base: string;
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  registerWizardDispatcherRoutes(app, (req, res, next) => {
    if (req.headers.authorization !== "fixture") return void res.status(401).end();
    next();
  });
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as any).port}/api/wizards/saved/dispatch`;
});
afterAll(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(readCoverageEvidence).mockImplementation(async () => evidence() as any);
  state.allowed = true;
  state.rows = [{ pk: "saved", data: { pk: "saved", firstName: "Fixture", memberSsn: "000123456" } }];
  state.getRows.mockImplementation(async () => state.rows);
  state.wizard = {
    id: "saved", type: "trust_provider_edi", currentStep: "deliver", status: "completed",
    data: {
      config: { configId: "cfg", pluginId: "sitespecific-bao-kaiser", data: {}, sftpClientId: "destination" },
      input: { asOfDate: "2026-10-01" },
      reportMeta: { recordCount: 1 },
      delivery: { deliveredAt: "2026-10-01", filename: "old.txt" },
      coverageSnapshot: { fingerprint: "fixture", rule: "exclude-conflicting", exclusionDigest: "nothing-excluded",
        exclusionCount: 0, warningCount: 0, exclusions: [], warnings: [] },
      progress: { coverage: { status: "completed", runId: "previous-check" } },
    },
  };
  state.update.mockImplementation(async (_id, update) => {
    state.wizard = { ...state.wizard, ...update };
    return structuredClone(state.wizard);
  });
  state.wizard.data.coverageSnapshot.revision = revision();
  state.writeProgress.mockImplementation(async (_id, step, runId, patch, start, dataPatch = {}, status, _lease, _type, _policy, expected) => {
    const data = state.wizard.data;
    const progress = data.progress?.[step];
    if (start) {
      if (Object.values(data.progress ?? {}).some((p: any) => p?.status === "in_progress") ||
          JSON.stringify(expected) !== JSON.stringify(data)) return undefined;
    } else if (progress?.runId !== runId || progress?.status !== "in_progress") return undefined;
    state.wizard.data = { ...data, ...dataPatch,
      progress: { ...data.progress, [step]: { ...progress, ...patch, runId } } };
    if (status) state.wizard.status = status;
    return structuredClone(state.wizard);
  });
});
const get = (path: string, authenticated = true) => fetch(`${base}${path}`, { headers: authenticated ? { authorization: "fixture" } : {} });
function revision() {
  const data = state.wizard.data;
  return evidenceHash({ config: data.config, input: data.input, terminationPolicy: data.terminationPolicy,
    rule: "exclude-conflicting" });
}

describe("authorized, read-only Deliver exports", () => {
  const postCoverage = (input: Record<string, unknown>) => fetch(`${base}/coverage/run`, {
    method: "POST", headers: { authorization: "fixture", "Content-Type": "application/json" },
    body: JSON.stringify({ input: { action: "check", ...input } }),
  });
  const finished = () => vi.waitFor(() => expect(state.wizard.data.progress?.coverage?.status).not.toBe("in_progress"));
  const navigate = () => fetch(`${base}/navigate`, { method: "POST",
    headers: { authorization: "fixture", "Content-Type": "application/json" },
    body: JSON.stringify({ direction: "next" }) });
  const coverageState = () => trustProviderEdiWizardPlugin.steps.find(s => s.id === "coverage")!.getState!(state.wizard);
  const entry: EdiCoverageEntry = {
    kind: "exclusion", reason: "conflicting-coverage", workerId: "fictional-person", personLabel: "Fictional Member",
    benefitId: "benefit", benefitLabel: "Fixture Benefit", month: "2026-10",
    records: ["cobra", "own"].map(id => ({ id, employerId: id, employerLabel: "Fixture Employer",
      employerSiriusId: id === "cobra" ? "COBRA" : "100", sourceRelationId: null,
      subscriberWorkerId: "fictional-person", subscriberLabel: "Fictional Member", isCobra: id === "cobra" })),
  };
  /** Every later read reports the same one conflicting month left out. */
  function excluding(digest = "one-excluded") {
    vi.mocked(readCoverageEvidence).mockImplementation(async () =>
      evidence({ excludedIds: new Set(["cobra", "own"]), exclusions: [entry], exclusionDigest: digest }) as any);
    return digest;
  }
  const runGenerate = async () => {
    const { storage } = await import("../../server/storage");
    return trustProviderEdiWizardPlugin.steps.find(s => s.id === "run")!.run!({
      wizard: state.wizard, wizardId: "saved", storage, input: {}, req: {}, reportProgress: async () => {},
    } as any);
  };
  it.each(["sitespecific-bao-kaiser", "sitespecific-smf-local11"])(
    "allows Parameters → Coverage sources → Generate when nothing is excluded for %s", async pluginId => {
      state.wizard.data.config.pluginId = pluginId;
      state.wizard.currentStep = "params";
      expect((await navigate()).status).toBe(200);
      expect(state.wizard.currentStep).toBe("coverage");
      // An hours-only file reads no coverage, so there is no check to run:
      // the step is complete as soon as Parameters are saved.
      if (pluginId === "sitespecific-bao-kaiser") {
        expect((await navigate()).status).toBe(400);
        expect((await postCoverage({})).status).toBe(202);
        await finished();
      }
      expect(coverageState()).toBe("completed");
      expect((await navigate()).status).toBe(200);
      expect(state.wizard.currentStep).toBe("run");
    });
  it("gates coverage inspection and checking before evidence reads or writes", async () => {
    expect((await get("/coverage/data", false)).status).toBe(401);
    state.allowed = false;
    expect((await get("/coverage/data")).status).toBe(403);
    expect((await postCoverage({})).status).toBe(403);
    expect(readCoverageEvidence).not.toHaveBeenCalled();
    expect(state.update).not.toHaveBeenCalled();
  });
  it("no longer accepts a manual source decision", async () => {
    for (const action of ["decision", "complete"]) {
      const response = await postCoverage({ action, key: "any", selectedId: "cobra", reason: "Reviewed" });
      expect(response.status).toBe(400);
      expect(await response.text()).toContain("no longer accepted");
    }
    expect(readCoverageEvidence).not.toHaveBeenCalled();
    expect(state.writeProgress).not.toHaveBeenCalled();
    expect(state.wizard.data.coverageDecisions).toBeUndefined();
  });
  it("holds Generate until an administrator acknowledges exactly the list on screen", async () => {
    const digest = excluding();
    state.wizard.currentStep = "coverage";
    expect((await postCoverage({})).status).toBe(202);
    await finished();
    expect(state.wizard.data.coverageSnapshot).toMatchObject({ rule: "exclude-conflicting", exclusionCount: 1,
      exclusionDigest: digest, byReason: { "conflicting-coverage": 1 }, exclusions: [entry] });
    expect(coverageState()).toBe("pending");
    expect((await navigate()).status).toBe(400);
    await expect(runGenerate()).rejects.toThrow(/no administrator has acknowledged/);
    // A list other than the one checked, or other settings, is never acknowledged.
    expect((await postCoverage({ action: "acknowledge", revision: revision(), exclusionDigest: "another-list" })).status).toBe(400);
    expect((await postCoverage({ action: "acknowledge", revision: "previous-settings", exclusionDigest: digest })).status).toBe(400);
    expect(state.wizard.data.coverageAcknowledgement).toBeUndefined();
    expect((await postCoverage({ action: "acknowledge", revision: revision(), exclusionDigest: digest,
      actor: "forged", acknowledgedBy: "forged", acknowledgedAt: "forged" })).status).toBe(202);
    await finished();
    expect(state.wizard.data.coverageAcknowledgement).toMatchObject({
      acknowledgedBy: "fixture-user", exclusionDigest: digest, exclusionCount: 1, rule: "exclude-conflicting" });
    expect(state.wizard.data.coverageAcknowledgement.acknowledgedAt).not.toBe("forged");
    expect(coverageState()).toBe("completed");
    expect((await navigate()).status).toBe(200);
  });
  it("saves the exclusion list with the generated run and refuses a list that changed since", async () => {
    const digest = excluding();
    const plugin = registeredEdiPlugins().find(p => p.id === "sitespecific-bao-kaiser")!;
    const keys = vi.spyOn(plugin, "getPrimaryKeys").mockResolvedValue(["member"]);
    const process = vi.spyOn(plugin, "processBatch").mockResolvedValue([{ pk: "member", firstName: "Fixture" }]);
    state.wizard.data.coverageAcknowledgement = { acknowledgedBy: "fixture-user", acknowledgedAt: "2026-10-01T00:00:00.000Z",
      exclusionDigest: digest, exclusionCount: 1, rule: "exclude-conflicting" };
    try {
      const result = await runGenerate();
      // Every membership reader worked from the one evidence read.
      expect((process.mock.calls[0][1] as any).coverageEvidence.excludedIds).toEqual(new Set(["cobra", "own"]));
      expect(result?.data?.reportMeta).toMatchObject({ recordCount: 1, coverage: {
        rule: "exclude-conflicting", exclusionCount: 1, warningCount: 0, exclusionDigest: digest,
        acknowledgement: { acknowledgedBy: "fixture-user" } } });
      state.wizard.data = { ...state.wizard.data, ...result!.data, progress: { run: { status: "completed" } } };
      expect(await (await get("/deliver/data")).json()).toMatchObject({ ready: true, rowCount: 1, coverage: { exclusionCount: 1 } });
      // The list travels beside the rows, and is never a file row.
      expect(await (await get("/deliver/export?format=provider")).text()).not.toContain("Fictional Member");
      expect((await (await get("/results/data")).json()).records).toEqual([{ pk: "member", firstName: "Fixture" }]);
      const download = await get("/deliver/export?format=coverage-exclusions");
      expect(download.status).toBe(200);
      expect(download.headers.get("content-disposition")).toContain("-coverage-exclusions.csv");
      const csv = await download.text();
      for (const detail of ["Excluded", "Fictional Member", "fictional-person", "Fixture Benefit", "2026-10",
        "cobra", "own", "Fixture Employer", "COBRA", "Non-COBRA", "Subscriber"]) expect(csv).toContain(detail);
      // Coverage changed after acknowledgement: the earlier acknowledgement is of another list.
      excluding("a-different-list");
      await expect(runGenerate()).rejects.toThrow(/list changed since it was acknowledged/);
    } finally {
      keys.mockRestore();
      process.mockRestore();
    }
  });
  it("checks source evidence again before publishing completed metadata", async () => {
    const plugin = registeredEdiPlugins().find(p => p.id === "sitespecific-bao-kaiser")!;
    const keys = vi.spyOn(plugin, "getPrimaryKeys").mockResolvedValue([]);
    vi.mocked(readCoverageEvidence).mockResolvedValueOnce(evidence({ fingerprint: "before" }) as any)
      .mockResolvedValueOnce(evidence({ fingerprint: "after" }) as any);
    try {
      await expect(runGenerate()).rejects.toThrow(/changed during generation/);
      expect(state.wizard.data.reportMeta).toBeNull();
      expect((await get("/deliver/export")).status).toBe(500);
    } finally { keys.mockRestore(); }
  });
  it("admits slow checks promptly, keeps reads cheap and excludes competing operations", async () => {
    let release!: (value: any) => void;
    const held = new Promise<any>(resolve => { release = resolve; });
    vi.mocked(readCoverageEvidence).mockReturnValueOnce(held);
    const admitted = await postCoverage({});
    expect(admitted.status).toBe(202); // the evidence read is deliberately still unresolved
    expect(state.wizard.data.progress.coverage.status).toBe("in_progress");
    try {
      for (let i = 0; i < 3; i++) {
        const response = await get("/coverage/data");
        expect(response.status).toBe(200);
        expect((await response.json()).ready).toBe(false);
      }
      expect(readCoverageEvidence).toHaveBeenCalledTimes(1);
      expect((await postCoverage({})).status).toBe(409);
      expect((await fetch(`${base}/run/run`, { method: "POST",
        headers: { authorization: "fixture", "Content-Type": "application/json" }, body: "{}" })).status).toBe(409);
      expect((await fetch(`${base}/params/submit`, { method: "POST",
        headers: { authorization: "fixture", "Content-Type": "application/json" },
        body: JSON.stringify({ input: { asOfDate: "2026-10-01" } }) })).status).toBe(500);
    } finally {
      release(evidence({ fingerprint: "new" }));
      await finished();
    }
    expect((await (await get("/coverage/data")).json())).toMatchObject({
      ready: true, rule: "exclude-conflicting", exclusions: [], warnings: [], fingerprint: "new", legacyDecisions: [] });
    expect(readCoverageEvidence).toHaveBeenCalledTimes(1);
  });
  it("keeps the previous check when a check is refused, and shows older source decisions read-only", async () => {
    const previous = structuredClone(state.wizard.data.coverageSnapshot);
    const decision = { key: "old", selectedId: "cobra", reason: "Reviewed before exclusion was automatic", decidedBy: "earlier-user" };
    state.wizard.data.coverageDecisions = [decision];
    vi.mocked(readCoverageEvidence).mockRejectedValueOnce(
      new Error("Coverage lifecycle events are not ready for 3 people in this run. Wait for maintenance to finish, then check again."));
    expect((await postCoverage({})).status).toBe(202);
    await finished();
    expect(state.wizard.data.progress.coverage).toMatchObject({ status: "failed", error: expect.stringContaining("3 people") });
    expect(state.wizard.data.coverageSnapshot).toEqual(previous);
    expect(coverageState()).toBe("pending");
    expect((await postCoverage({ action: "acknowledge", revision: revision(), exclusionDigest: previous.exclusionDigest })).status).toBe(400);
    expect((await postCoverage({})).status).toBe(202);
    await finished();
    expect(coverageState()).toBe("completed");
    // Shown for the record; nothing reads them, and the evidence read never receives them.
    expect((await (await get("/coverage/data")).json()).legacyDecisions).toEqual([decision]);
    expect(state.wizard.data.coverageDecisions).toEqual([decision]);
  });
  it("never publishes late evidence from a replaced owner", async () => {
    let release!: (value: any) => void;
    vi.mocked(readCoverageEvidence).mockReturnValueOnce(new Promise(resolve => { release = resolve; }));
    expect((await postCoverage({})).status).toBe(202);
    state.wizard.data.progress.coverage.runId = "different-owner";
    release(evidence({ fingerprint: "late" }));
    await vi.waitFor(() => expect(state.writeProgress.mock.calls.some(c => c[3].status === "completed")).toBe(true));
    expect(state.wizard.data.coverageSnapshot.fingerprint).toBe("fixture");
    expect(state.wizard.data.progress.coverage.runId).toBe("different-owner");
  });
  it("persists actionable mixed-overlap failures and refuses stale output", async () => {
    const plugin = registeredEdiPlugins().find(p => p.id === "sitespecific-bao-kaiser")!;
    const keys = vi.spyOn(plugin, "getPrimaryKeys").mockImplementation(async () => {
      const row = { id: "ordinary-wmb", workerId: "fictional-person", benefitId: "fictional-benefit",
        year: 2026, month: 10, employerId: "ordinary-employer", sourceRelationId: null };
      assertUnmixedCoverage([row, { ...row, id: "cobra-wmb", employerId: "cobra-employer", employerSiriusId: "13226164" }]);
      return [];
    });
    state.writeProgress.mockImplementation(async (_id, step, _runId, patch) => {
      state.wizard.data.progress = { ...state.wizard.data.progress, [step]: {
        ...state.wizard.data.progress?.[step], ...patch,
      } };
      return state.wizard;
    });
    try {
      const response = await fetch(`${base}/run/run`, {
        method: "POST", headers: { authorization: "fixture", "Content-Type": "application/json" }, body: "{}",
      });
      expect(response.status).toBe(202);
      await vi.waitFor(() => expect(state.wizard.data.progress?.run?.status).toBe("failed"));
      const saved = state.wizard.data.progress.run.error;
      for (const detail of ["Correction required", "fictional-person", "fictional-benefit", "2026-10",
        "ordinary-wmb", "cobra-wmb", "ordinary-employer", "cobra-employer", "13226164"]) expect(saved).toContain(detail);
      expect(state.wizard.data.reportMeta).toBeNull();
      expect((await get("/deliver/export?format=provider")).status).toBe(500);
      expect(state.upload).not.toHaveBeenCalled();
    } finally {
      keys.mockRestore();
      state.writeProgress.mockReset();
    }
  });
  it("downloads saved/delivered runs in either format without generating, delivering or writing", async () => {
    const snapshot = structuredClone(state.wizard);
    for (const format of ["provider", "carrier-csv"]) {
      const response = await get(`/deliver/export?format=${format}`);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-disposition")).toContain(format === "provider" ? ".txt" : "-carrier-layout-qa.csv");
      expect(response.headers.get("content-type")).toContain(format === "provider" ? "text/plain" : "text/csv");
      expect(response.headers.get("cache-control")).toBe("no-store");
      const body = await response.text();
      expect(body.includes("QA-only")).toBe(format === "carrier-csv");
    }
    expect(state.wizard).toEqual(snapshot);
    expect(state.update).not.toHaveBeenCalled();
    expect(state.upload).not.toHaveBeenCalled();
  });
  it("validates saved choices before admitting generation, ignoring unsaved request input", async () => {
    state.wizard.data.terminationPolicy = { explicitSubscriberTerminations: true, explicitDependentTerminations: false, terminationLookbackMonths: 13 };
    const response = await fetch(`${base}/run/run`, {
      method: "POST", headers: { authorization: "fixture", "Content-Type": "application/json" },
      body: JSON.stringify({ input: { explicitSubscriberTerminations: false, terminationLookbackMonths: 1 } }),
    });
    expect(response.status).toBe(400);
    expect(await response.text()).toContain("Termination lookback months");
    expect(state.writeProgress).not.toHaveBeenCalled();
  });
  it("recovers Carelon through Parameters save, Generate and both downloads without delivery", async () => {
    state.wizard.data.config.pluginId = "sitespecific-smf-carelon";
    state.wizard.data.progress = { run: { status: "failed", error: "Historical contract refusal" } };
    const plugin = registeredEdiPlugins().find(p => p.id === "sitespecific-smf-carelon")!;
    const keys = vi.spyOn(plugin, "getPrimaryKeys").mockResolvedValue(["history"]);
    const process = vi.spyOn(plugin, "processBatch").mockResolvedValue([{
      pk: "history", memberStatus: "C", coverageEnd: "20261031",
      terminationRole: "subscriber", terminationEvidence: "coverage inferred",
    }]);
    state.writeProgress.mockImplementation(async (_id, step, runId, patch, _initial, data = {}) => {
      state.wizard.data = { ...state.wizard.data, ...data, progress: {
        ...state.wizard.data.progress, [step]: { ...state.wizard.data.progress?.[step], ...patch, runId },
      } };
      return state.wizard;
    });
    const post = (path: string, input: unknown) => fetch(`${base}${path}`, {
      method: "POST", headers: { authorization: "fixture", "Content-Type": "application/json" },
      body: JSON.stringify({ input }),
    });
    try {
      const saved = await post("/params/submit", {
        asOfDate: "2026-11-01", explicitSubscriberTerminations: true,
        explicitDependentTerminations: true, terminationLookbackMonths: 1,
      });
      expect(saved.status).toBe(200);
      expect(state.wizard.data).toMatchObject({
        reportMeta: null, delivery: null,
        previousGeneration: { error: "Historical contract refusal" },
        terminationPolicy: { explicitSubscriberTerminations: true, explicitDependentTerminations: true },
      });
      expect((await get("/deliver/data")).status).toBe(200);
      expect(await (await get("/deliver/data")).json()).toMatchObject({ ready: false });
      expect((await post("/run/run", { explicitSubscriberTerminations: false })).status).toBe(202);
      await vi.waitFor(() => expect(state.wizard.data.progress.run.status).toBe("completed"));
      expect(process.mock.calls[0][1].terminationPolicy).toEqual({ subscribers: true, dependents: true, months: 1 });
      expect(state.wizard.data.reportMeta.terminationCounts).toEqual({ subscribers: 1, dependents: 0, inferred: 1 });
      for (const format of ["provider", "carrier-csv"]) {
        const response = await get(`/deliver/export?format=${format}`);
        expect(response.status).toBe(200);
        expect(await response.text()).toContain("20261031");
      }
      expect(state.upload).not.toHaveBeenCalled();
    } finally {
      keys.mockRestore();
      process.mockRestore();
    }
  });
  it("refuses rows replaced during a concurrent generation", async () => {
    const oldWizard = structuredClone(state.wizard);
    state.getRows.mockImplementation(async () => {
      state.wizard.data.progress = { run: { status: "in_progress" } };
      return [{ data: { pk: "partial" } }];
    });
    const { storage } = await import("../../server/storage");
    const ctx = { wizard: oldWizard, wizardId: "saved", storage } as any;
    const handler = trustProviderEdiWizardPlugin.steps.find(step => step.id === "deliver")!;
    await expect(handler.exportFile!(ctx, "provider")).rejects.toThrow(/Generation changed/);
    expect(state.upload).not.toHaveBeenCalled();
  });
  it("downloads with the completed generation's encoding inputs", async () => {
    state.wizard.data.reportMeta.generationContext = {
      configData: {}, input: { asOfDate: "2026-09-01" },
      terminationPolicy: { subscribers: false, dependents: true, months: 2 },
    };
    const plugin = registeredEdiPlugins().find(p => p.id === state.wizard.data.config.pluginId)!;
    const filename = plugin.buildFilename({ input: { asOfDate: "2026-09-01" }, configData: {} } as any);
    expect((await get("/deliver/export")).headers.get("content-disposition")).toContain(filename);
  });
  it("retains native content and filename for every provider before and after QA", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-02T12:34:56Z"));
    try {
      for (const plugin of registeredEdiPlugins()) {
        state.wizard.data.config.pluginId = plugin.id;
        const ctx = { configData: {}, input: state.wizard.data.input } as any;
        const lines = assembleEdiFileLines(plugin, state.rows.map(r => r.data), ctx);
        const expected = lines.join("\r\n") + (lines.length ? "\r\n" : "");
        const first = await get("/deliver/export");
        expect(await first.text()).toBe(expected);
        expect(first.headers.get("content-disposition")).toContain(plugin.buildFilename(ctx));
        expect((await get("/deliver/export?format=carrier-csv")).status).toBe(200);
        expect(await (await get("/deliver/export?format=provider")).text()).toBe(expected);
      }
    } finally { vi.useRealTimers(); }
  });
  it("enforces authentication and plugin/component policy before loading export rows", async () => {
    for (const format of ["provider", "carrier-csv"]) {
      expect((await get(`/deliver/export?format=${format}`, false)).status).toBe(401);
      state.allowed = false;
      expect((await get(`/deliver/export?format=${format}`)).status).toBe(403);
    }
    expect(state.getRows).not.toHaveBeenCalled();
    expect(state.gate).toHaveBeenCalledWith(expect.objectContaining({ requiredPolicy: "admin", requiredComponent: "trust.providers.edi" }), expect.anything());
  });
  it("leaves the generic Results CSV as preview columns rather than carrier layout", async () => {
    state.wizard.data.reportMeta.columns = [
      { id: "pk", header: "Preview identifier" },
      { id: "viewLink", header: "View", type: "link" },
    ];
    const response = await get("/results/export");
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("Preview identifier\nsaved");
  });
  it("rejects missing generation and bad formats; export failures cannot create a success or side effect", async () => {
    expect((await get("/deliver/export?format=bad")).status).toBe(500);
    state.wizard.data.reportMeta = null;
    expect((await get("/deliver/export?format=carrier-csv")).status).toBe(500);
    state.wizard.data.reportMeta = { recordCount: 1 };
    state.getRows.mockRejectedValue(new Error("fixture read failure"));
    expect((await get("/deliver/export?format=provider")).status).toBe(500);
    expect(state.update).not.toHaveBeenCalled();
    expect(state.upload).not.toHaveBeenCalled();
  });
  it("allows empty downloads but refuses empty SFTP transmission", async () => {
    state.rows = [];
    for (const format of ["provider", "carrier-csv"]) expect((await get(`/deliver/export?format=${format}`)).status).toBe(200);
    const response = await fetch(`${base}/deliver/submit`, {
      method: "POST", headers: { authorization: "fixture", "Content-Type": "application/json" }, body: JSON.stringify({ input: { format: "carrier-csv" } }),
    });
    expect(response.status).toBe(500);
    expect(state.upload).not.toHaveBeenCalled();
  });
  it.each(["in_progress", "failed"])("refuses old or partial generation while %s", async status => {
    state.wizard.data.progress = { run: { status } };
    for (const format of ["provider", "carrier-csv"]) {
      expect((await get(`/deliver/export?format=${format}`)).status).toBe(500);
    }
    const handler = trustProviderEdiWizardPlugin.steps.find(step => step.id === "deliver")!;
    const { storage } = await import("../../server/storage");
    const ctx = { wizard: state.wizard, wizardId: "saved", storage, input: {}, req: {} } as any;
    expect(await handler.getData!(ctx)).toMatchObject({ ready: false });
    await expect(handler.submit!(ctx)).rejects.toThrow(/Generate/);
    expect(state.getRows).not.toHaveBeenCalled();
    expect(state.upload).not.toHaveBeenCalled();
  });
  it("hides Results data and CSV after a later generation batch fails", async () => {
    const plugin = registeredEdiPlugins().find(p => p.id === "sitespecific-bao-kaiser")!;
    const keys = vi.spyOn(plugin, "getPrimaryKeys").mockResolvedValue(
      Array.from({ length: 101 }, (_, i) => `row-${i}`),
    );
    const process = vi.spyOn(plugin, "processBatch")
      .mockImplementationOnce(async batch => batch.map(pk => ({ pk, firstName: "Partial fixture" })))
      .mockRejectedValueOnce(new Error("fixture later batch failure"));
    try {
      state.wizard.data.reportMeta.columns = [{ id: "firstName", header: "Old column" }];
      state.wizard.data.progress = { run: { status: "in_progress", runId: "fixture" } };
      const { storage } = await import("../../server/storage");
      const run = trustProviderEdiWizardPlugin.steps.find(s => s.id === "run")!;
      const ctx = {
        wizard: state.wizard, wizardId: "saved", runId: "fixture", storage,
        input: {}, req: {}, reportProgress: async (percent: number | null) => {
          if (percent === null) return; // discovery / unknown-duration stages precede row batches
          expect(state.rows).toHaveLength(100);
          expect(state.wizard.data.reportMeta).toBeNull();
          for (const path of ["/results/data", "/results/export"]) {
            const response = await get(path);
            expect(response.status).toBe(500);
            expect(await response.text()).not.toContain("Partial fixture");
          }
        },
      } as any;
      await expect(run.run!(ctx)).rejects.toThrow("fixture later batch failure");
      expect(state.rows).toHaveLength(100);
      expect(state.wizard.data.reportMeta).toBeNull();
      state.wizard.data.progress.run.status = "failed";
      for (const path of ["/results/data", "/results/export"]) {
        const response = await get(path);
        expect(response.status).toBe(500);
        expect(await response.text()).not.toContain("Partial fixture");
      }
      expect(state.getRows).not.toHaveBeenCalled();
      expect(state.upload).not.toHaveBeenCalled();
    } finally {
      keys.mockRestore();
      process.mockRestore();
    }
  });
  it("SFTP and re-delivery ignore QA selection and use native bytes and filename", async () => {
    const handler = trustProviderEdiWizardPlugin.steps.find(step => step.id === "deliver")!;
    const { storage } = await import("../../server/storage");
    const context = { wizard: state.wizard, wizardId: "saved", storage, input: { format: "carrier-csv" }, req: {} } as any;
    await handler.exportFile!(context, "carrier-csv");
    for (let i = 0; i < 2; i++) {
      const result = await handler.submit!(context);
      expect(result.data?.delivery).toMatchObject({ rowCount: 1, destinationId: "destination" });
    }
    const native = await handler.exportFile!(context, "provider");
    expect(state.upload).toHaveBeenCalledTimes(2);
    for (const call of state.upload.mock.calls as unknown[][]) {
      expect(call[2]).toBe(native.filename);
      expect((call[3] as Buffer).toString("utf8")).toBe(native.content);
      expect((call[3] as Buffer).toString("utf8")).not.toContain("QA-only");
    }
  });
});
