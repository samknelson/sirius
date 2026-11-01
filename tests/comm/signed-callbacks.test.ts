import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac, generateKeyPairSync, sign } from "node:crypto";
import type { Server } from "node:http";
import express, { type Request } from "express";
import twilio from "twilio";

const state = vi.hoisted(() => ({
  configs: {} as Record<string, any[]>,
  secrets: {} as Record<string, string>,
  comm: {} as any,
}));
const writes = vi.hoisted(() => ({
  updateComm: vi.fn(async () => ({})),
  updateCommEmail: vi.fn(async () => ({})),
  updateCommPostal: vi.fn(async () => ({})),
  updateCommSms: vi.fn(async () => ({})),
}));
const logs = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock("../../server/config/env-registry", () => ({
  getEnvironmentVariable: (name: string) => state.secrets[name],
  registerEnvironmentVariable: vi.fn(),
}));
vi.mock("../../server/storage", () => ({
  storage: { pluginConfigs: {
    getByKindAndPlugin: async (_kind: string, id: string) => state.configs[id] ?? [],
  } },
}));
vi.mock("../../server/storage/comm", () => ({
  createCommStorage: () => ({
    getCommWithDetails: async () => state.comm,
    updateComm: writes.updateComm,
  }),
  createCommEmailStorage: () => ({ updateCommEmail: writes.updateCommEmail }),
  createCommPostalStorage: () => ({ updateCommPostal: writes.updateCommPostal }),
  createCommSmsStorage: () => ({ updateCommSms: writes.updateCommSms }),
}));
vi.mock("../../server/logger", () => ({ storageLogger: logs }));

import { SendGridStatusHandler } from "../../server/services/comm/callback-handlers/sendgrid";
import { LobStatusHandler } from "../../server/services/comm/callback-handlers/lob";
import { TwilioStatusHandler } from "../../server/services/comm/callback-handlers/twilio";
import { handleStatusCallback } from "../../server/services/comm/callback-handlers/handler";
import { captureCallbackBody, refuseCallbackParseError, type CallbackRequest } from "../../server/services/comm/callback-handlers/verification";

const keys = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const publicKey = keys.publicKey.export({ type: "spki", format: "der" }).toString("base64");
const body = {
  sendgrid: '[ { "event": "delivered", "sg_message_id": "msg-1.filter", "email": "é@example.test" } ]\n',
  lob: '{ "event_type": "letter.delivered", "body": { "id": "ltr_1" }, "note": "é" }\n',
};
const handlers = { sendgrid: new SendGridStatusHandler(), lob: new LobStatusHandler() };
type Provider = keyof typeof handlers;
function signedRequest(provider: Provider, timestamp = String(Math.floor(Date.now() / 1000))): CallbackRequest {
  const raw = Buffer.from(body[provider]);
  const headers = provider === "sendgrid"
    ? {
        "x-twilio-email-event-webhook-timestamp": timestamp,
        "x-twilio-email-event-webhook-signature": sign(
          "sha256", Buffer.concat([Buffer.from(timestamp), raw]), keys.privateKey,
        ).toString("base64"),
      }
    : {
        "lob-signature-timestamp": timestamp,
        "lob-signature": createHmac("sha256", "test-webhook-key")
          .update(timestamp).update(".").update(raw).digest("hex"),
      };
  return { body: JSON.parse(raw.toString()), rawCallbackBody: raw, headers } as unknown as CallbackRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  state.configs = {
    sendgrid: [{ data: { webhookPublicKey: publicKey } }],
    lob: [{ data: { webhookSecretName: "LOB_WEBHOOK_TEST" } }],
  };
  state.secrets = { LOB_WEBHOOK_TEST: "test-webhook-key" };
});

describe.each(["sendgrid", "lob"] as const)("%s callback authentication", (provider) => {
  it("verifies real signatures over original non-canonical UTF-8 bytes", async () => {
    expect(await handlers[provider].validateRequest(signedRequest(provider))).toEqual({ valid: true });
  });

  it.each([-301, 301])("rejects signed timestamps outside the replay window (%s seconds)", async (offset) => {
    const request = signedRequest(provider, String(Math.floor(Date.now() / 1000) + offset));
    expect((await handlers[provider].validateRequest(request)).valid).toBe(false);
  });

  it.each(["missing-signature", "missing-timestamp", "malformed-timestamp", "duplicate-header", "tampered", "reserialized", "no-raw"] as const)(
    "rejects %s without trusting a browser session", async (mode) => {
      const request = signedRequest(provider);
      const sig = provider === "sendgrid" ? "x-twilio-email-event-webhook-signature" : "lob-signature";
      const ts = provider === "sendgrid" ? "x-twilio-email-event-webhook-timestamp" : "lob-signature-timestamp";
      (request as any).user = { id: "signed-in-admin" };
      if (mode === "missing-signature") delete request.headers[sig];
      if (mode === "missing-timestamp") delete request.headers[ts];
      if (mode === "malformed-timestamp") request.headers[ts] = "NaN";
      if (mode === "duplicate-header") request.headers[sig] = ["one", "two"];
      if (mode === "tampered") request.rawCallbackBody = Buffer.from(body[provider].replace("delivered", "failed"));
      if (mode === "reserialized") request.rawCallbackBody = Buffer.from(JSON.stringify(request.body));
      if (mode === "no-raw") delete request.rawCallbackBody;
      expect((await handlers[provider].validateRequest(request)).valid).toBe(false);
    },
  );

  it.each(["absent", "ambiguous", "no-key", "wrong-key"] as const)("rejects %s provider verification configuration", async (mode) => {
    const request = signedRequest(provider);
    if (mode === "absent") state.configs[provider] = [];
    if (mode === "ambiguous") state.configs[provider].push(state.configs[provider][0]);
    if (mode === "no-key") state.configs[provider][0].data = {};
    if (mode === "wrong-key") {
      state.configs[provider][0].data.webhookPublicKey = "not-a-key";
      state.secrets.LOB_WEBHOOK_TEST = "wrong";
    }
    expect((await handlers[provider].validateRequest(request)).valid).toBe(false);
  });

  it("uses the originating configuration, even after it is disabled, and never another row", async () => {
    state.configs[provider][0].id = "originating";
    state.configs[provider][0].enabled = false;
    state.configs[provider].push({ id: "new-provider", data: {} });
    expect((await handlers[provider].validateRequest(signedRequest(provider), "originating")).valid).toBe(true);
    expect((await handlers[provider].validateRequest(signedRequest(provider), "new-provider")).valid).toBe(false);
    expect((await handlers[provider].validateRequest(signedRequest(provider), "deleted-provider")).valid).toBe(false);
  });
});

describe("HTTP callback boundary", () => {
  let server: Server;
  let url: string;
  beforeAll(async () => {
    const app = express();
    app.use(express.json({ verify: captureCallbackBody }));
    app.use(express.urlencoded({ extended: false }));
    app.use(refuseCallbackParseError);
    app.post("/api/comm/statuscallback/:commId", (req, res) => {
      void handleStatusCallback(req, res, req.params.commId);
    });
    server = await new Promise<Server>((resolve) => {
      const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
    });
    const address = server.address() as { port: number };
    url = `http://127.0.0.1:${address.port}/api/comm/statuscallback/comm-1`;
  });
  afterAll(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));

  it("refuses malformed JSON without relaying payloads to error logging", async () => {
    const response = await fetch(url, {
      method: "POST", headers: { "content-type": "application/json" },
      body: '{"private":"callback-payload-canary"',
    });
    expect(response.status).toBe(400);
    expect(await response.text()).toBe("Invalid callback body");
    expect(Object.values(writes).every((write) => write.mock.calls.length === 0)).toBe(true);
    expect(logs.error).not.toHaveBeenCalled();
  });

  it("refuses Lob's publicly known debugger secret", async () => {
    state.secrets.LOB_WEBHOOK_TEST = "secret";
    const request = signedRequest("lob");
    request.headers["lob-signature"] = createHmac("sha256", "secret")
      .update(String(request.headers["lob-signature-timestamp"])).update(".")
      .update(request.rawCallbackBody!).digest("hex");
    expect((await handlers.lob.validateRequest(request)).valid).toBe(false);
  });

  it.each(["sendgrid", "lob"] as const)("only writes authenticated %s updates for the named message", async (provider) => {
    state.comm = {
      id: "comm-1", status: "sent", contactId: "contact-1",
      medium: provider === "sendgrid" ? "email" : "postal",
      data: provider === "sendgrid" ? { messageId: "msg-1" } : { letterId: "ltr_1" },
      ...(provider === "sendgrid" ? { emailDetails: { id: "email-1" } } : { postalDetails: { id: "postal-1" } }),
    };
    const request = signedRequest(provider);
    const post = (headers: Request["headers"]) => {
      const httpHeaders = new Headers({ "content-type": "application/json" });
      for (const [name, value] of Object.entries(headers)) {
        if (typeof value === "string") httpHeaders.set(name, value);
      }
      return fetch(url, { method: "POST", headers: httpHeaders, body: body[provider] });
    };
    expect((await post({})).status).toBe(403);
    expect(Object.values(writes).every((write) => write.mock.calls.length === 0)).toBe(true);
    state.comm.data = provider === "sendgrid" ? { messageId: "different" } : { letterId: "different" };
    expect((await post(request.headers)).status).toBe(403);
    expect(Object.values(writes).every((write) => write.mock.calls.length === 0)).toBe(true);
    state.comm.data = provider === "sendgrid" ? { messageId: "msg-1" } : { letterId: "ltr_1" };
    expect((await post(request.headers)).status).toBe(200);
    expect(writes.updateComm).toHaveBeenCalledWith("comm-1", expect.objectContaining({ status: "delivered" }));
    const logText = JSON.stringify(Object.values(logs).flatMap((log) => log.mock.calls));
    expect(logText).not.toContain("é@example.test");
    expect(logText).not.toContain("test-webhook-key");
    expect(logText).not.toContain("rawPayload");
  });

  it("keeps real Twilio form signatures working and rejects forged ones", async () => {
    state.configs.twilio = [{ data: { accountSid: "AC_test", secretName: "TWILIO_TEST" } }];
    state.secrets.TWILIO_TEST = "test-twilio-key";
    state.comm = { id: "comm-1", medium: "sms", status: "sent", data: { messageId: "SM_test" } };
    const params = { AccountSid: "AC_test", MessageSid: "SM_test", MessageStatus: "delivered" };
    const signature = twilio.getExpectedTwilioSignature("test-twilio-key", url, params);
    const request = { body: params, protocol: "http", originalUrl: new URL(url).pathname,
      headers: { host: new URL(url).host, "x-twilio-signature": signature } } as unknown as Request;
    expect((await new TwilioStatusHandler().validateRequest(request)).valid).toBe(true);
    for (const [sig, status] of [["forged", 403], [signature, 200]] as const) {
      const response = await fetch(url, {
        method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": sig },
        body: new URLSearchParams(params),
      });
      expect(response.status).toBe(status);
      if (status === 403) expect(writes.updateComm).not.toHaveBeenCalled();
    }
  });
});
