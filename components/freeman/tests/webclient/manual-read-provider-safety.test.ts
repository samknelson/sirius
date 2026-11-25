import { afterEach, describe, expect, it, vi } from "vitest";
import type { PluginConfig } from "@shared/schema";

import { getWcVendorHandler, getWcVendorOperationManifest, getWcVendorPlugin } from "../../../../server/plugins/wc-vendors/registry";

function context(
  pluginId: string,
  credential: string,
  data: Record<string, unknown> = {},
) {
  return {
    http: { fetch: (...args: Parameters<typeof fetch>) => globalThis.fetch(...args) },
    credential: { secretName: "TEST_SECRET", value: credential },
    config: {
      id: `${pluginId}-config`,
      pluginKind: "wc-vendors",
      pluginId,
      enabled: true,
      ordering: 0,
      data,
    } as PluginConfig,
  };
}

function handler(pluginId: string, operation: string) {
  const found = getWcVendorHandler(pluginId, operation as never);
  if (!found) throw new Error(`Missing ${pluginId}.${operation} test handler`);
  return found;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

import "../../server/plugins/wc-vendors/plugins/sitespecific-freeman-authorization";
describe("authorization read safety", () => {
  it("keeps the bearer manual-run field secret and read-only", () => {
    const plugin = getWcVendorPlugin("sitespecific-freeman-authorization")!;
    expect(getWcVendorOperationManifest(plugin)).toContainEqual(expect.objectContaining({
      id: "sitespecific.freeman.authorization.bearer",
      manualRun: expect.objectContaining({effect: "read", uiSchema: {bearerCredential: {"ui:widget": "password"}}}),
    }));
  });
  it("classifies a missing authorization URL as misconfigured", async () => {
    await expect(
      handler("sitespecific-freeman-authorization", "service.test-connection")(
        context("sitespecific-freeman-authorization", "unused", {}), undefined as never,
      ),
    ).resolves.toMatchObject({ status: "misconfigured" });
  });
  it("pings Freeman with GET and without sending the configured bearer token", async () => {
    const fetchMock = vi.fn(async () => new Response("", { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      handler("sitespecific-freeman-authorization", "service.test-connection")(
        context(
          "sitespecific-freeman-authorization",
          "freeman-secret-canary",
          { authorizationUrl: "https://freeman.test/authorize" },
        ),
        {} as never,
      ),
    ).resolves.toMatchObject({ status: "connected" });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://freeman.test/authorize",
      expect.objectContaining({
        method: "GET",
        headers: undefined,
      }),
    );
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain(
      "freeman-secret-canary",
    );
  });

});
