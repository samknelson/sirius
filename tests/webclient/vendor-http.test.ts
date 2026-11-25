import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IncomingMessage, RequestOptions } from "node:http";

const fixture = vi.hoisted(() => ({
  request: vi.fn(),
  lookup: vi.fn(),
  status: 200,
  body: '{"ok":true}',
  responseHeaders: [] as string[],
}));
vi.mock("node:https", () => ({ request: fixture.request }));
vi.mock("node:dns/promises", () => ({ lookup: fixture.lookup }));

import { createVendorHttp } from "../../server/services/webclient/vendor-http";
import { WcEndpointPolicyError } from "../../server/services/webclient/refusals";
import { WcTwilioHttpClient } from "../../server/services/webclient/twilio-http";
const publicPolicy = () => ({ allowedHosts: ["api.example.com"], allowPrivateAddresses: false });

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

beforeEach(() => {
  fixture.status = 200;
  fixture.body = '{"ok":true}';
  fixture.responseHeaders = ["Content-Type", "application/json"];
  fixture.lookup.mockReset().mockResolvedValue([{ address: "8.8.8.8", family: 4 }]);
  fixture.request.mockReset().mockImplementation((
    url: URL, options: RequestOptions, receive: (response: IncomingMessage) => void,
  ) => {
    const req = new EventEmitter() as EventEmitter & { end(body: unknown): void; body?: unknown };
    req.end = (body) => {
      req.body = body;
      options.lookup!(url.hostname, { all: true }, (error) => {
        if (error) { req.emit("error", error); return; }
        const response = Object.assign(new PassThrough(), {
          statusCode: fixture.status, rawHeaders: fixture.responseHeaders,
        });
        // The mock supplies only the stream/status/header members the transport reads.
        receive(response as unknown as IncomingMessage);
        response.end(fixture.body);
      });
    };
    return req;
  });
});

describe("webclient HTTP socket handoff", () => {
  it("allows explicitly bounded long requests past 30s but keeps ordinary requests at 30s", async () => {
    vi.useFakeTimers();
    // Node's native AbortSignal.timeout uses its internal real clock. Substitute
    // only that clock; run the REAL transport's timeout composition and request.
    const timeout = vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(new Error("Deadline exceeded")), ms);
      return controller.signal;
    });
    fixture.request.mockImplementation((_url: URL, options: RequestOptions, receive: (res: IncomingMessage) => void) => {
      const req = new EventEmitter() as EventEmitter & { end(): void };
      req.end = () => {
        options.signal!.addEventListener("abort", () => req.emit("error", new Error("Aborted")), { once: true });
        setTimeout(() => {
          if (options.signal!.aborted) return;
          const response = Object.assign(new PassThrough(), {
            statusCode: 200, rawHeaders: ["Content-Type", "application/json"],
          });
          receive(response as unknown as IncomingMessage);
          response.end('{"ok":true}');
        }, 45_000);
      };
      return req;
    });
    const http = createVendorHttp("test", publicPolicy);
    const long = http.fetch("https://api.example.com/chat", { timeoutMs: 180_000 });
    const ordinary = http.fetch("https://api.example.com/catalog");
    // Attach rejection observation before advancing the clock.
    const ordinaryCheck = expect(ordinary).rejects.toMatchObject({ code: "WC_TIMEOUT" });
    await vi.advanceTimersByTimeAsync(30_001);
    await ordinaryCheck;
    expect(fixture.request.mock.calls[0][1].signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(await (await long).json()).toEqual({ ok: true });
    expect(timeout.mock.calls.map(([ms]) => ms)).toEqual([180_000, 30_000]);
  });

  it("caps opted-in deadlines and preserves earlier caller cancellation", async () => {
    vi.useFakeTimers();
    vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), ms);
      return controller.signal;
    });
    const http = createVendorHttp("test", publicPolicy);
    for (const timeoutMs of [0, -1, 180_001, Infinity, NaN, 1.5]) {
      await expect(http.fetch("https://api.example.com", { timeoutMs })).rejects.toThrow("HTTPS request failed");
    }
    expect(fixture.request).not.toHaveBeenCalled();
    fixture.request.mockImplementation((_url: URL, options: RequestOptions) => {
      const req = new EventEmitter() as EventEmitter & { end(): void };
      req.end = () => options.signal!.addEventListener("abort", () => req.emit("error", new Error("Aborted")), { once: true });
      return req;
    });
    const controller = new AbortController();
    const cancelled = http.fetch("https://api.example.com/chat", { timeoutMs: 180_000, signal: controller.signal });
    const cancelledCheck = expect(cancelled).rejects.toThrow("HTTPS request failed");
    controller.abort();
    await cancelledCheck;
    const bounded = http.fetch("https://api.example.com/chat", { timeoutMs: 180_000 });
    const boundedCheck = expect(bounded).rejects.toMatchObject({ code: "WC_TIMEOUT" });
    await vi.advanceTimersByTimeAsync(180_001);
    await boundedCheck;
  });

  it("rereads private access for subsequent requests without broadening another plugin", async () => {
    let allowPrivateAddresses = true;
    const http = createVendorHttp("private", () => ({ ...publicPolicy(), allowPrivateAddresses }));
    fixture.lookup.mockResolvedValue([
      { address: "10.248.12.15", family: 4 }, { address: "fd12::1", family: 6 },
    ]);
    expect((await http.fetch("https://api.example.com")).status).toBe(200);
    expect(fixture.request.mock.calls[0][1]).toMatchObject({ rejectUnauthorized: true, agent: false });
    await expect(createVendorHttp("other", publicPolicy).fetch("https://api.example.com"))
      .rejects.toThrow(WcEndpointPolicyError);
    allowPrivateAddresses = false;
    await expect(http.fetch("https://api.example.com")).rejects.toThrow(WcEndpointPolicyError);
    expect(() => http.throwIfRefused()).toThrow(WcEndpointPolicyError);
  });
  it("does not follow redirects or permit custom Host even with private access", async () => {
    const privatePolicy = () => ({ ...publicPolicy(), allowPrivateAddresses: true });
    fixture.lookup.mockResolvedValue([{ address: "10.248.12.15", family: 4 }]);
    fixture.status = 302;
    await expect(createVendorHttp("private", privatePolicy).fetch("https://api.example.com"))
      .rejects.toThrow("returned a redirect");
    await expect(createVendorHttp("private", privatePolicy).fetch("https://api.example.com",
      { headers: { Host: "internal" } })).rejects.toThrow("custom Host");
    expect(fixture.request).toHaveBeenCalledTimes(1);
  });
  it("sends through the checked resolver with TLS verification and no pooled alternate socket", async () => {
    const http = createVendorHttp("test", publicPolicy);
    const response = await http.fetch("https://api.example.com/path?private=canary", {
      method: "POST", headers: { Authorization: "Bearer fake-token" }, body: '{"x":1}',
    });
    expect(await response.json()).toEqual({ ok: true });
    expect(fixture.request).toHaveBeenCalledTimes(1);
    const [url, options] = fixture.request.mock.calls[0];
    expect(url.hostname).toBe("api.example.com");
    expect(options).toMatchObject({
      agent: false, rejectUnauthorized: true, method: "POST",
      headers: { authorization: "Bearer fake-token" },
    });
    expect(fixture.lookup).toHaveBeenCalledWith("api.example.com", { all: true, verbatim: true });
  });
  it("does not open a request for a host mismatch, unsafe scheme, or custom Host", async () => {
    for (const [url, init] of [
      ["https://attacker.example", {}], ["http://api.example.com", {}],
      ["https://api.example.com", { headers: { Host: "internal" } }],
    ] as const) {
      await expect(createVendorHttp("test", publicPolicy).fetch(url, init))
        .rejects.toBeInstanceOf(WcEndpointPolicyError);
    }
    expect(fixture.request).not.toHaveBeenCalled();
  });
  it.each([301, 302, 303, 307, 308])("never follows redirect %i or relays its location", async (status) => {
    fixture.status = status;
    fixture.responseHeaders = ["Location", "http://169.254.169.254/?token=canary"];
    const http = createVendorHttp("test", publicPolicy);
    await expect(http.fetch("https://api.example.com", {
      method: "POST", headers: { Authorization: "Bearer fake" }, body: "credential=fake",
    })).rejects.toThrow("returned a redirect");
    expect(fixture.request).toHaveBeenCalledTimes(1);
    try { http.throwIfRefused(); } catch (error) { expect(String(error)).not.toContain("canary"); }
  });
  it("rejects private DNS results in the socket resolver", async () => {
    fixture.lookup.mockResolvedValue([{ address: "169.254.169.254", family: 4 }]);
    const http = createVendorHttp("test", publicPolicy);
    await expect(http.fetch("https://api.example.com/private?token=canary"))
      .rejects.toThrow("169.254.169.254: link-local/metadata");
    expect(() => http.throwIfRefused()).toThrow(WcEndpointPolicyError);
    expect(() => http.throwIfRefused()).toThrow("rejected 1/1 answers");
    try { http.throwIfRefused(); } catch (error) { expect(String(error)).not.toContain("canary"); }
  });
  it("fails safely for an invalid upstream status instead of throwing out of the stream callback", async () => {
    fixture.status = 999;
    await expect(createVendorHttp("test", publicPolicy).fetch("https://api.example.com"))
      .rejects.toThrow("HTTPS request failed");
  });
  it("preserves the Twilio SDK form, auth, repeated parameters and response contract", async () => {
    const send = vi.fn().mockResolvedValue(new Response('{"sid":"SMfake"}', {
      status: 201, headers: { "content-type": "application/json" },
    }));
    const client = new WcTwilioHttpClient({ fetch: send });
    const response = await client.request({
      uri: "https://api.twilio.com/path", method: "post",
      username: "ACfake", password: "fake",
      data: { Body: "Hello & goodbye", To: ["+100", "+200"] },
    });
    const [url, init] = send.mock.calls[0];
    expect(url.hostname).toBe("api.twilio.com");
    expect(init.headers.get("Authorization")).toBe(`Basic ${Buffer.from("ACfake:fake").toString("base64")}`);
    expect(init.body).toBe("Body=Hello+%26+goodbye&To=%2B100&To=%2B200");
    expect(response).toMatchObject({ statusCode: 201, body: { sid: "SMfake" } });
  });
});
