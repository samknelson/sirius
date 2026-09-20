import { beforeEach, describe, expect, it, vi } from "vitest";

const componentState = vi.hoisted(() => ({ enabled: true }));

vi.mock("../../server/services/component-cache", () => ({
  isComponentEnabledSync: () => componentState.enabled,
}));
vi.mock("../../server/storage", () => ({ storage: {} }));
vi.mock("../../server/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn() },
  logWsRequest: vi.fn(),
}));
vi.mock("../../server/services/webclient/client", () => ({ wcRequest: vi.fn() }));

import {
  generateCurlCommand,
  shouldShowFreemanBearerInput,
} from "../../client/src/pages/config/ws/client-test";
import { buildTestRequestHeaders } from "../../server/modules/webservices/test-request-auth";

const configuredClient = {
  id: "client-1",
  name: "Freeman client",
  status: "active",
  ipAllowlistEnabled: false,
  data: { freemanBearerAuthorizationConfigId: "freeman-config-1" },
} as any;

beforeEach(() => {
  componentState.enabled = true;
});

describe("Freeman bearer credentials on admin test requests", () => {
  it("offers the masked input only with both client configuration and component-gated tab access", () => {
    expect(shouldShowFreemanBearerInput(configuredClient.data, true)).toBe(true);
    expect(shouldShowFreemanBearerInput(configuredClient.data, false)).toBe(false);
    expect(shouldShowFreemanBearerInput({}, true)).toBe(false);
    expect(shouldShowFreemanBearerInput({ freemanBearerAuthorizationConfigId: " " }, true))
      .toBe(false);
  });

  it("forwards the bearer header only for a configured client with the component enabled", () => {
    expect(buildTestRequestHeaders(configuredClient, "key", "secret", " canary-token "))
      .toMatchObject({ Authorization: "Bearer canary-token" });

    expect(buildTestRequestHeaders({ ...configuredClient, data: {} }, "key", "secret", "canary-token"))
      .not.toHaveProperty("Authorization");

    componentState.enabled = false;
    expect(buildTestRequestHeaders(configuredClient, "key", "secret", "canary-token"))
      .not.toHaveProperty("Authorization");
  });

  it("omits a missing token so middleware returns its normal missing-bearer response", () => {
    const headers = buildTestRequestHeaders(configuredClient, "key", "secret", "   ");
    expect(headers).not.toHaveProperty("Authorization");
    expect(JSON.stringify(headers)).not.toContain("canary-token");
  });

  it("adds the same bearer header to copied cURL only when applicable", () => {
    const base = {
      baseUrl: "https://example.test/api/ws/service",
      method: "GET",
      path: "/read",
      queryParams: "",
      requestBody: "",
      clientKey: "key",
      clientSecret: "secret",
    };
    expect(generateCurlCommand({ ...base, bearerToken: "canary-token" }))
      .toContain('-H "Authorization: Bearer canary-token"');
    expect(generateCurlCommand(base)).not.toContain("Authorization: Bearer");
  });
});