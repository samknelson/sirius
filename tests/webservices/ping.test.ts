/**
 * Ping is the one web service whose entire contract is its response body: an
 * integrator reads it to decide whether their credential, their query string
 * and their payload arrived intact. So these tests pin the response shape, and
 * pin what it must never contain — the configuration's settings and the
 * caller's own credential are both in scope at the handler and neither belongs
 * in an echo.
 */
import { beforeAll, describe, expect, it } from "vitest";

import { webServiceRegistry } from "../../server/plugins/web-service/registry";
import "../../server/plugins/web-service/plugins/ping";

const CONFIG = {
  id: "config-1",
  pluginKind: "web-service",
  pluginId: "ping-v1",
  enabled: true,
  data: { alias: "ping", secretSetting: "s3cret-setting" },
} as any;

const SETTINGS = CONFIG.data as Record<string, unknown>;

let handler: (ctx: any) => unknown;
let methods: string[];

beforeAll(() => {
  const plugin = webServiceRegistry.get("ping-v1");
  if (!plugin) throw new Error("ping-v1 did not register");
  const op = plugin.operations.find((o) => o.name === "ping");
  if (!op) throw new Error("ping-v1 declares no 'ping' operation");
  handler = op.handler as typeof handler;
  methods = op.methods;
});

/** Call the operation with a stub request/response pair. */
async function ping(req: {
  method: string;
  query?: Record<string, unknown>;
  body?: unknown;
  headers?: Record<string, string>;
}) {
  const result: { status: number; body?: any } = { status: 200 };
  const res = {
    status(code: number) {
      result.status = code;
      return res;
    },
    json(body: unknown) {
      result.body = body;
      return res;
    },
  };

  await handler({
    config: CONFIG,
    settings: SETTINGS,
    req: { query: {}, body: {}, headers: {}, ...req },
    res,
  });
  return result;
}

describe("ping web service", () => {
  it("accepts GET and POST, and nothing else", () => {
    // The dispatcher answers 405 for every verb not listed here, so this list
    // IS the operation's method contract.
    expect(methods).toEqual(["GET", "POST"]);
  });

  it("echoes the parsed query on a GET", async () => {
    const result = await ping({
      method: "GET",
      query: { page: "2", tag: ["a", "b"] },
    });

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      ok: true,
      method: "GET",
      contentType: null,
      // Repeated keys stay as the array the query parser produced rather than
      // being flattened to the last value.
      query: { page: "2", tag: ["a", "b"] },
      body: null,
    });
    expect(typeof result.body.receivedAt).toBe("string");
  });

  it("reports an empty query rather than omitting it", async () => {
    const result = await ping({ method: "GET" });

    expect(result.body.query).toEqual({});
  });

  it("echoes a parsed JSON body on a POST", async () => {
    const body = { nested: { list: [1, 2, 3] }, flag: true };
    const result = await ping({
      method: "POST",
      body,
      headers: { "content-type": "application/json", "content-length": "42" },
    });

    expect(result.body).toMatchObject({
      method: "POST",
      contentType: "application/json",
      body,
    });
  });

  it("echoes a form body, naming the content type that produced it", async () => {
    const result = await ping({
      method: "POST",
      body: { field: "value" },
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "content-length": "11",
      },
    });

    expect(result.body).toMatchObject({
      contentType: "application/x-www-form-urlencoded",
      body: { field: "value" },
    });
  });

  it("reports no body when none was sent, not the parser's empty object", async () => {
    // express.json() assigns `{}` to every request before deciding whether to
    // parse one; echoing that back would tell a caller their POST arrived with
    // an empty object when they sent nothing at all.
    const result = await ping({
      method: "POST",
      body: {},
      headers: { "content-length": "0" },
    });

    expect(result.body.body).toBeNull();
  });

  it("echoes a streamed body with no content-length", async () => {
    const result = await ping({
      method: "POST",
      body: { streamed: true },
      headers: { "content-type": "application/json", "transfer-encoding": "chunked" },
    });

    expect(result.body.body).toEqual({ streamed: true });
  });

  it("never echoes the configuration's settings or the caller's credential", async () => {
    const result = await ping({
      method: "POST",
      query: { ok: "1" },
      body: { ok: true },
      headers: {
        "content-type": "application/json",
        "content-length": "12",
        "x-ws-client-key": "client-key-value",
        "x-ws-client-secret": "client-secret-value",
      },
    });

    const serialized = JSON.stringify(result.body);
    expect(serialized).not.toContain("s3cret-setting");
    expect(serialized).not.toContain("client-key-value");
    expect(serialized).not.toContain("client-secret-value");
    expect(result.body).not.toHaveProperty("settings");
    expect(result.body).not.toHaveProperty("headers");
  });
});
