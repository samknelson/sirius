/**
 * The swagger service is granted like any other, so several integrators can
 * hold it at once. Its whole safety property is therefore that the document it
 * returns is about WHOEVER AUTHENTICATED — a caller who could name the subject
 * could read another integrator's endpoint list.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const CALLER_ID = "caller-client";
const OTHER_ID = "other-client";

interface Scenario {
  /** Identity the authentication middleware established, if any. */
  context: { clientId: string } | undefined;
  clients: Record<string, { id: string; name: string } | undefined>;
}

let scenario: Scenario;

/** Every client the builder was asked about, in call order. */
const builtFor: { id: string; name: string }[] = [];

vi.mock("../../server/middleware/webservice-auth", () => ({
  getWebServiceContext: () => scenario.context,
}));

vi.mock("../../server/storage", () => ({
  storage: {
    wsClients: {
      async get(id: string) {
        return scenario.clients[id];
      },
    },
  },
}));

vi.mock("../../server/modules/webservices/openapi", () => ({
  async buildClientOpenApiDocument(client: { id: string; name: string }) {
    builtFor.push(client);
    return { openapi: "3.1.0", info: { title: client.name }, paths: {} };
  },
}));

import { webServiceRegistry } from "../../server/plugins/web-service/registry";
import "../../server/plugins/web-service/plugins/swagger";

function callSwagger(req: Record<string, unknown> = {}) {
  const plugin = webServiceRegistry.get("swagger-v1");
  if (!plugin) throw new Error("swagger-v1 did not register");
  const op = plugin.operations.find((o) => o.name === "swagger");
  if (!op) throw new Error("swagger-v1 declares no 'swagger' operation");

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

  return Promise.resolve(
    op.handler({
      config: { id: "config-swagger", data: {} } as any,
      settings: {},
      req: { method: "GET", query: {}, body: {}, headers: {}, params: {}, ...req } as any,
      res: res as any,
    }),
  ).then(() => result);
}

beforeEach(() => {
  builtFor.length = 0;
  scenario = {
    context: { clientId: CALLER_ID },
    clients: {
      [CALLER_ID]: { id: CALLER_ID, name: "Caller" },
      [OTHER_ID]: { id: OTHER_ID, name: "Other" },
    },
  };
});

describe("swagger web service", () => {
  it("is a read-only GET operation", () => {
    const plugin = webServiceRegistry.get("swagger-v1");
    expect(plugin?.operations.map((o) => o.methods)).toEqual([["GET"]]);
  });

  it("returns the document for the authenticated client", async () => {
    const result = await callSwagger();

    expect(result.status).toBe(200);
    expect(builtFor).toEqual([{ id: CALLER_ID, name: "Caller" }]);
    expect(result.body.info.title).toBe("Caller");
  });

  it("ignores any attempt to name a different client", async () => {
    const result = await callSwagger({
      query: { clientId: OTHER_ID, client: OTHER_ID },
      params: { clientId: OTHER_ID },
      body: { clientId: OTHER_ID },
    });

    expect(result.status).toBe(200);
    expect(builtFor).toEqual([{ id: CALLER_ID, name: "Caller" }]);
  });

  it("refuses rather than guessing when no caller is established", async () => {
    scenario.context = undefined;

    const result = await callSwagger();

    expect(result.status).toBe(500);
    expect(result.body.code).toBe("NO_REQUEST_CONTEXT");
    expect(builtFor).toEqual([]);
  });

  it("refuses when the authenticated client no longer exists", async () => {
    scenario.clients = {};

    const result = await callSwagger();

    expect(result.status).toBe(500);
    expect(result.body.code).toBe("CLIENT_NOT_FOUND");
    expect(builtFor).toEqual([]);
  });
});
