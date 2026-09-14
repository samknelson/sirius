import type { AddressInfo } from "node:net";
import http from "node:http";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const getByKind = vi.hoisted(() => vi.fn());
const getConfig = vi.hoisted(() => vi.fn());
const countsByConfiguration = vi.hoisted(() => vi.fn());
const checker = vi.hoisted(() => vi.fn());
const wcRequest = vi.hoisted(() => vi.fn());

vi.mock("../../server/storage", () => ({
  storage: {
    pluginConfigs: { getByKind, get: getConfig },
    wcStats: { countsByConfiguration },
  },
}));
vi.mock("../../server/services/access-policy-evaluator", () => ({
  requireAccess: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  getComponentChecker: () => checker,
}));
vi.mock("../../server/services/webclient", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../server/services/webclient")>();
  return { ...actual, wcRequest };
});

const { registerWcVendorRoutes } =
  await import("../../server/modules/system/wc-vendors");

let server: http.Server;
let baseUrl: string;

const twilioConfig = {
  id: "twilio-config",
  pluginKind: "wc-vendors",
  pluginId: "twilio",
  enabled: true,
  name: "Twilio",
  data: {
    accountSid: "AC123",
    fromNumber: "+17025550100",
  },
};

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  registerWcVendorRoutes(app);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(
  () =>
    new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    ),
);

beforeEach(() => {
  getByKind.mockReset().mockResolvedValue([twilioConfig]);
  getConfig.mockReset().mockResolvedValue(twilioConfig);
  countsByConfiguration.mockReset().mockResolvedValue([]);
  checker.mockReset().mockResolvedValue(true);
  wcRequest.mockReset().mockResolvedValue({
    source: "network",
    outcome: "success",
    fresh: true,
    value: { accepted: true },
  });
});

async function postRun(
  operation: string,
  args: unknown,
  options: { forceFresh?: boolean } = {},
) {
  const response = await fetch(
    `${baseUrl}/api/admin/wc-overview/twilio-config/${operation}/run`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ args, ...options }),
    },
  );
  return { status: response.status, body: await response.json() };
}

describe("WC overview real operation schemas", () => {
  it("rejects blank and additional Twilio phone arguments before wcRequest", async () => {
    expect((await postRun("validate-phone", { phoneNumber: "   " })).status).toBe(
      400,
    );
    expect(
      (
        await postRun("validate-phone", {
          phoneNumber: "+17025550100",
          unexpected: "value",
        })
      ).status,
    ).toBe(400);
    expect(wcRequest).not.toHaveBeenCalled();
  });

  it("passes the valid phone argument through the selected configuration", async () => {
    expect(
      (await postRun("validate-phone", { phoneNumber: "+17025550100" })).status,
    ).toBe(200);
    expect(wcRequest).toHaveBeenCalledWith({
      vendor: { configId: "twilio-config" },
      operation: "validate-phone",
      args: { phoneNumber: "+17025550100" },
    });
  });

  it("passes force mode only when a cached operation requests a fresh call", async () => {
    expect(
      (
        await postRun(
          "validate-phone",
          { phoneNumber: "+17025550100" },
          { forceFresh: true },
        )
      ).status,
    ).toBe(200);
    expect(wcRequest).toHaveBeenCalledWith({
      vendor: { configId: "twilio-config" },
      operation: "validate-phone",
      args: { phoneNumber: "+17025550100" },
      mode: "force",
    });

    wcRequest.mockClear();
    expect(
      (
        await postRun("read-configuration", {}, { forceFresh: true })
      ).status,
    ).toBe(400);
    expect(wcRequest).not.toHaveBeenCalled();
  });

  it("accepts empty arguments for reads and continues refusing remote writes", async () => {
    expect((await postRun("read-configuration", {})).status).toBe(200);
    expect((await postRun("list-phone-numbers", {})).status).toBe(200);
    expect((await postRun("list-phone-numbers", { limit: 500 })).status).toBe(400);
    expect((await postRun("send-sms", {})).status).toBe(409);
  });
});
