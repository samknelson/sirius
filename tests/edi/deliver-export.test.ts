import express from "express";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { assembleEdiFileLines } from "../../server/plugins/trust/provider-edi/base";
import { registeredEdiPlugins } from "./fixtures/harness";

const state = vi.hoisted(() => ({
  wizard: {} as any,
  rows: [] as any[],
  allowed: true,
  gate: vi.fn(),
  upload: vi.fn(async () => ({ success: true })),
  getRows: vi.fn(),
  update: vi.fn(),
}));
vi.mock("../../server/storage", () => ({ storage: {
  wizards: {
    getById: async () => state.wizard,
    getReportData: (...args: unknown[]) => state.getRows(...args),
    update: (...args: unknown[]) => state.update(...args),
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
vi.mock("../../server/plugins/wizards/validation-run", () => ({ startValidationRun: vi.fn() }));
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
  state.allowed = true;
  state.rows = [{ data: { pk: "saved", firstName: "Fixture", memberSsn: "000123456" } }];
  state.getRows.mockImplementation(async () => state.rows);
  state.wizard = {
    id: "saved", type: "trust_provider_edi", currentStep: "deliver", status: "completed",
    data: {
      config: { configId: "cfg", pluginId: "sitespecific-bao-kaiser", data: {}, sftpClientId: "destination" },
      input: { asOfDate: "2026-10-01" },
      reportMeta: { recordCount: 1 },
      delivery: { deliveredAt: "2026-10-01", filename: "old.txt" },
    },
  };
  state.update.mockImplementation(async (_id, update) => ({ ...state.wizard, ...update }));
});
const get = (path: string, authenticated = true) => fetch(`${base}${path}`, { headers: authenticated ? { authorization: "fixture" } : {} });

describe("authorized, read-only Deliver exports", () => {
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
