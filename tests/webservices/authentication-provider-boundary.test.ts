import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WsClient } from "@shared/schema";

const state = vi.hoisted(() => ({ enabled: false, connectionAvailable: true }));
vi.mock("../../server/services/component/cache", () => ({
  isComponentEnabledSync: () => state.enabled,
}));
vi.mock("../../server/storage", () => ({ storage: {
  wsClientCredentials: { getByClientKey: vi.fn(), validateSecret: vi.fn(), recordUsage: vi.fn() },
  wsClients: { get: vi.fn() },
  wsClientIpRules: { isIpAllowed: vi.fn() },
} }));
vi.mock("../../server/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn() }, logWsRequest: vi.fn() }));
vi.mock("../../server/plugins/_core", () => ({ isPluginComponentEnabledAsync: () => true }));
vi.mock("../../server/plugins/web-service", () => ({ webServiceRegistry: { get: vi.fn() } }));
vi.mock("../../server/services/comm/callback-handlers/url-builder", () => ({ getPublicBaseUrl: () => "" }));
import { storage } from "../../server/storage";
import { createWebServiceAuthMiddleware } from "../../server/middleware/webservice-auth";
import { authenticationSelection, authenticationSelectionAvailable, authenticateWithProvider, registerAuthenticationProvider } from "../../server/modules/webservices/authentication-providers";
import { buildTestRequestHeaders } from "../../server/modules/webservices/test-request-auth";
import { buildClientOpenApiDocument } from "../../server/modules/webservices/openapi";

const run = vi.fn().mockResolvedValue(undefined);
registerAuthenticationProvider({ id: "test-bearer", component: "optional.test", authenticate: run, available: async () => state.connectionAvailable });
const credential = { id: "key", clientId: "client", isActive: true } as any;
const client = (data: Record<string, unknown>) => ({ id: "client", name: "Partner", status: "active", data }) as WsClient;

beforeEach(() => { state.enabled = false; state.connectionAvailable = true; vi.clearAllMocks(); });
describe("persisted authentication authority", () => {
  it.each([
    { authenticationProvider: { provider: "missing-provider", configId: "retained" } },
    { authenticationProvider: { provider: "test-bearer", configId: "retained" } },
    { authenticationProvider: "corrupt" },
    { missingBearerAuthorizationConfigId: "retained-selection" },
  ])("never falls back to a secret for unavailable or uninterpreted selections: %j", async data => {
    const c = client(data);
    const selection = authenticationSelection(c)!;
    expect(selection).toBeDefined();
    expect(await authenticateWithProvider({} as any, c, credential, selection)).toMatchObject({ success: false, errorCode: "AUTH_PROVIDER_UNAVAILABLE" });
    expect(buildTestRequestHeaders(c, "key", "secret", "POST", "token")).not.toHaveProperty("X-WS-Client-Secret");
    vi.mocked(storage.wsClientCredentials.getByClientKey).mockResolvedValue(credential);
    vi.mocked(storage.wsClients.get).mockResolvedValue(c);
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn(), locals: {} };
    const next = vi.fn();
    await createWebServiceAuthMiddleware()({ headers: {"x-ws-client-id": "key", "x-ws-client-secret": "secret"}, socket: {}, method: "POST" } as any, res as any, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
    expect(storage.wsClientCredentials.validateSecret).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
    const doc = await buildClientOpenApiDocument(c);
    expect(doc.paths).toEqual({});
    expect(doc.security).toEqual([{ wsClientId: [], providerBearerAuth: [] }]);
    expect(JSON.stringify(doc.components)).not.toContain("wsClientSecret");
    expect(doc.info.description).toContain("unavailable");
  });
  it("uses only an available provider, with no secret downgrade", async () => {
    state.enabled = true;
    const c = client({authenticationProvider: {provider: "test-bearer", configId: "selected"}});
    await authenticateWithProvider({} as any, c, credential, authenticationSelection(c)!);
    expect(run).toHaveBeenCalledOnce();
  });
  it("reports an unavailable selected connection even when its provider is enabled", async () => {
    state.enabled = true;
    state.connectionAvailable = false;
    const c = client({authenticationProvider: {provider: "test-bearer", configId: "missing-connection"}});
    expect(await authenticationSelectionAvailable(authenticationSelection(c)!)).toBe(false);
    const doc = await buildClientOpenApiDocument(c);
    expect(doc.paths).toEqual({});
    expect(doc.info.description).toContain("unavailable");
  });
  it("keeps explicit client-secret selection and empty legacy data working", () => {
    expect(authenticationSelection(client({}))).toBeUndefined();
    expect(authenticationSelection(client({unrelatedApplicationSetting: "retained"}))).toBeUndefined();
    expect(authenticationSelection(client({oldSetting: "", authenticationProvider: null}))).toBeUndefined();
    expect(buildTestRequestHeaders(client({}), "key", "secret", "GET")).toHaveProperty("X-WS-Client-Secret", "secret");
  });
});
