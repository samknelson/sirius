import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  configState,
  pluginState,
  gates,
  preflightOneoff,
  startOneoff,
  pluginConfigsGet,
  oneoffActiveRun,
} = vi.hoisted(() => ({
  configState: { value: {} as any },
  pluginState: { value: {} as any },
  gates: {
    kind: { ok: true } as { ok: boolean; status?: number; message?: string },
    plugin: { ok: true } as { ok: boolean; status?: number; message?: string },
  },
  preflightOneoff: vi.fn(),
  startOneoff: vi.fn(),
  pluginConfigsGet: vi.fn(),
  oneoffActiveRun: vi.fn(),
}));

vi.mock("../../server/storage", () => ({
  storage: {
    pluginConfigs: { get: pluginConfigsGet },
    jobRuns: { list: vi.fn(async () => []), getById: vi.fn(async () => null) },
  },
}));
vi.mock("../../server/storage/db", () => ({ db: {} }));
vi.mock("../../server/plugins/_core/gating", () => ({
  enforceKindGating: vi.fn(async () => gates.kind),
  enforcePluginGating: vi.fn(async () => gates.plugin),
}));
vi.mock("../../server/plugins/system/oneoff/registry", () => ({
  oneoffPluginRegistry: { get: (id: string) => id === pluginState.value.metadata?.id ? pluginState.value : undefined },
}));
vi.mock("../../server/modules/masquerade", () => ({
  getEffectiveUser: vi.fn(async () => ({ dbUser: { id: "admin-user" } })),
}));
vi.mock("../../server/services/oneoff-runner", () => ({
  OneoffRefusal: class OneoffRefusal extends Error {
    constructor(public statusCode: number, message: string) { super(message); }
  },
  preflightOneoff,
  startOneoff,
  cancelOneoff: vi.fn(),
  oneoffActiveRun,
}));

import { registerOneoffRoutes } from "../../server/modules/system/oneoff";

type Handler = (req: any, res: any) => Promise<void>;
const posts = new Map<string, Handler>();
const gets = new Map<string, Handler>();
const app = {
  get: (path: string, ...handlers: Handler[]) => { gets.set(path, handlers.at(-1)!); },
  post: (path: string, ...handlers: Handler[]) => { posts.set(path, handlers.at(-1)!); },
};

registerOneoffRoutes(app as any, ((_req: any, _res: any, next: () => void) => next()) as any);

function response() {
  const state: any = { statusCode: 200, headers: {}, body: undefined };
  const res = {
    status(code: number) { state.statusCode = code; return res; },
    json(body: unknown) { state.body = body; return res; },
    setHeader(name: string, value: string) { state.headers[name] = value; return res; },
  };
  return { res, state };
}

async function post(path: string, body: any) {
  const { res, state } = response();
  await posts.get(path)!({
    params: { id: "config-identity-under-test" },
    body,
    session: {},
    user: {},
  }, res);
  return state;
}

async function get(path: string) {
  const { res, state } = response();
  await gets.get(path)!({
    params: { id: "config-identity-under-test" },
    session: {},
    user: {},
  }, res);
  return state;
}

beforeEach(() => {
  vi.clearAllMocks();
  configState.value = {
    id: "config-identity-under-test",
    pluginId: "same-plugin-id",
    pluginKind: "oneoff",
    enabled: true,
  };
  pluginState.value = {
    metadata: { id: "same-plugin-id" },
    actions: [],
    status: vi.fn(async () => ({ tableExists: true, rowCount: 7 })),
  };
  pluginConfigsGet.mockImplementation(async (id: string) => id === configState.value.id ? configState.value : null);
  gates.kind = { ok: true };
  gates.plugin = { ok: true };
  preflightOneoff.mockResolvedValue({ message: "Ready", confirmationToken: "token" });
  startOneoff.mockResolvedValue({ id: "run-1" });
  oneoffActiveRun.mockResolvedValue(undefined);
});

describe("Oneoff route authorization and config identity", () => {
  it("uses the same resolved configuration for authorization and preflight execution", async () => {
    const result = await post("/api/oneoff/configs/:id/preflight", {
      action: "inspect",
      input: { value: 1 },
    });
    expect(result.statusCode).toBe(200);
    expect(pluginConfigsGet).toHaveBeenCalledWith(configState.value.id);
    expect(preflightOneoff).toHaveBeenCalledWith(
      configState.value, pluginState.value, "inspect", { value: 1 }, "admin-user",
    );
  });

  it("passes that exact configuration to the confirmed execution", async () => {
    const result = await post("/api/oneoff/configs/:id/run", {
      action: "inspect",
      input: { value: 2 },
      confirmationToken: "approved-token",
    });
    expect(result.statusCode).toBe(202);
    expect(startOneoff).toHaveBeenCalledWith(
      configState.value, pluginState.value, "inspect", { value: 2 }, "approved-token", "admin-user",
    );
  });

  it("reports another configuration as blocked without exposing that run", async () => {
    oneoffActiveRun.mockResolvedValue({
      id: "private-active-run-id",
      configurationId: "different-config-id",
      pluginKind: "oneoff",
      pluginId: "same-plugin-id",
      operation: "cleanup",
      status: "running",
      input: { sensitive: "other-config-payload" },
      confirmationHash: "secret-hash",
    });
    const result = await get("/api/oneoff/configs/:id/status");
    expect(result.statusCode).toBe(200);
    expect(result.body).toMatchObject({
      tableExists: true,
      rowCount: 7,
      activeRun: null,
      blockedByOtherConfiguration: true,
    });
    expect(JSON.stringify(result.body)).not.toContain("private-active-run-id");
    expect(JSON.stringify(result.body)).not.toContain("different-config-id");
    expect(JSON.stringify(result.body)).not.toContain("other-config-payload");
    expect(JSON.stringify(result.body)).not.toContain("secret-hash");
  });

  it("does not resolve or execute a configuration when kind authorization fails", async () => {
    gates.kind = { ok: false, status: 403, message: "admin policy required" };
    const result = await post("/api/oneoff/configs/:id/preflight", { action: "inspect" });
    expect(result.statusCode).toBe(403);
    expect(pluginConfigsGet).not.toHaveBeenCalled();
    expect(preflightOneoff).not.toHaveBeenCalled();
  });

  it("returns a sanitized response for unexpected action failures", async () => {
    preflightOneoff.mockRejectedValue(new Error("database credential leaked"));
    const result = await post("/api/oneoff/configs/:id/preflight", { action: "inspect" });
    expect(result.statusCode).toBe(500);
    expect(result.body.message).toBe("Oneoff operation failed");
    expect(JSON.stringify(result)).not.toContain("database credential");
  });
});