import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Express, RequestHandler } from "express";

const routes = new Map<string, RequestHandler>();
const state = vi.hoisted(() => ({
  smsConfigs: [] as Array<{
    id: string;
    pluginKind: string;
    pluginId: string;
    enabled: boolean;
    data: Record<string, unknown>;
  }>,
}));

vi.mock("../../server/services/access-policy-evaluator", () => ({
  requireAccess: () => ((_req: unknown, _res: unknown, next: () => void) => next()),
}));

vi.mock("../../server/services/maintenance-flag", () => ({
  sendIfMaintenanceRefusal: () => false,
}));

vi.mock("../../server/storage", () => ({
  storage: {
    pluginConfigs: {
      getByKindAndPlugin: vi.fn(async (_kind: string, pluginId: string) =>
        state.smsConfigs.filter((config) => config.pluginId === pluginId)
      ),
      update: vi.fn(async (id: string, patch: Record<string, unknown>) => {
        const config = state.smsConfigs.find((entry) => entry.id === id);
        if (config) Object.assign(config, patch);
        return config;
      }),
    },
  },
}));

vi.mock("../../server/services/webclient", () => ({
  wcRequest: vi.fn(),
}));

vi.mock("../../server/services/comm/email-vendor", () => ({
  emailVendorTarget: vi.fn(),
  ensureEmailVendorConfig: vi.fn(),
  getEmailVendorConfigs: vi.fn(async () => []),
  setEmailVendor: vi.fn(),
}));

vi.mock("../../server/services/comm/postal-vendor", () => ({
  getPostalVendorConfig: vi.fn(),
  getPostalVendorConfigs: vi.fn(async () => []),
  postalRequest: vi.fn(),
  postalSupportsOperation: vi.fn(),
  resolvePostalPluginId: vi.fn(),
  resolvePostalVendorTarget: vi.fn(),
  setPostalVendor: vi.fn(),
}));

vi.mock("../../server/services/comm/sms-vendor", () => {
  class SmsVendorConfigurationError extends Error {}
  return {
    SmsVendorConfigurationError,
    ensureSmsVendorConfig: vi.fn(async () => {
      const enabled = state.smsConfigs.filter((config) => config.enabled);
      if (enabled.length !== 1) throw new SmsVendorConfigurationError("SMS is unconfigured");
      return enabled[0];
    }),
    ensureSmsVendorTarget: vi.fn(async (pluginId: string) => {
      let config = state.smsConfigs.find((entry) => entry.pluginId === pluginId);
      if (!config) {
        config = {
          id: `sms-${pluginId}`,
          pluginKind: "wc-vendors",
          pluginId,
          enabled: false,
          data: {},
        };
        state.smsConfigs.push(config);
      }
      return config;
    }),
    getSmsVendorConfigs: vi.fn(async () => state.smsConfigs),
    resolveSmsVendor: vi.fn(),
  };
});

vi.mock("../../server/storage/transaction-context", () => ({
  getClient: () => ({ execute: vi.fn() }),
  runInTransaction: async (callback: () => Promise<unknown>) => callback(),
}));

vi.mock("../../server/services/comm/validators/address-verification", () => ({
  verifyPostalAddress: vi.fn(),
}));

vi.mock("../../server/plugins/wc-vendors", () => ({
  getWcVendorPlugin: vi.fn(),
}));

import { registerEmailConfigRoutes } from "../../server/modules/email-config";
import { registerPostalConfigRoutes } from "../../server/modules/postal-config";
import { registerTwilioRoutes } from "../../server/modules/twilio";

function fakeApp(): Express {
  const register = (method: string) =>
    (path: string, ...handlers: RequestHandler[]) => {
      routes.set(`${method} ${path}`, handlers.at(-1)!);
    };
  return {
    get: register("GET"),
    post: register("POST"),
    put: register("PUT"),
  } as unknown as Express;
}

async function invoke(method: "GET" | "PUT", path: string, requestBody?: unknown) {
  const handler = routes.get(`${method} ${path}`);
  if (!handler) throw new Error(`Missing ${method} route ${path}`);
  let body: unknown;
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn((value: unknown) => {
      body = value;
      return res;
    }),
  };
  await handler({ body: requestBody } as never, res as never, vi.fn());
  return { body, res };
}

beforeEach(() => {
  routes.clear();
  state.smsConfigs = [];
});

describe("unconfigured communication provider routes", () => {
  it("offers email providers before a canonical row exists", async () => {
    registerEmailConfigRoutes(fakeApp());

    const { body, res } = await invoke("GET", "/api/config/email");

    expect(res.status).not.toHaveBeenCalled();
    expect(body).toMatchObject({
      defaultProvider: null,
      currentProvider: null,
      providers: [
        { id: "sendgrid" },
        { id: "local" },
      ],
      configuredVendors: [],
    });
  });

  it("offers postal providers before a canonical row exists", async () => {
    registerPostalConfigRoutes(fakeApp());

    const { body, res } = await invoke("GET", "/api/config/postal");

    expect(res.status).not.toHaveBeenCalled();
    expect(body).toMatchObject({
      defaultProvider: null,
      currentProvider: null,
      providers: [
        { id: "lob" },
        { id: "local-postal" },
      ],
    });
  });

  it("offers SMS providers and creates Local SMS from the initial selection", async () => {
    registerTwilioRoutes(fakeApp());

    const initial = await invoke("GET", "/api/config/sms");
    expect(initial.res.status).not.toHaveBeenCalled();
    expect(initial.body).toMatchObject({
      defaultProvider: null,
      currentProvider: null,
      providers: [
        { id: "twilio" },
        { id: "sms-local" },
      ],
    });

    const selected = await invoke("PUT", "/api/config/sms/provider", {
      providerId: "sms-local",
    });
    expect(selected.res.status).not.toHaveBeenCalled();
    expect(selected.body).toEqual({
      success: true,
      defaultProvider: "sms-local",
    });
    expect(state.smsConfigs).toMatchObject([
      {
        pluginKind: "wc-vendors",
        pluginId: "sms-local",
        enabled: true,
      },
    ]);
  });
});