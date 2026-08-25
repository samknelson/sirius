/**
 * The generated API document is handed to outsiders, so what it OMITS matters
 * as much as what it contains: a service the client is not granted, a service
 * that is switched off, and anything resembling a credential must never appear
 * in it. These tests pin those omissions, the alias-over-id addressing rule
 * (an id-addressed document is wrong in every other environment), and the
 * honest treatment of an operation that declares no payload schema.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const CLIENT_ID = "client-1";

interface Scenario {
  grants: { configId: string }[];
  configs: {
    id: string;
    pluginKind: string;
    pluginId: string;
    enabled: boolean;
    name: string | null;
    data: Record<string, unknown>;
  }[];
  enabledComponents: Record<string, boolean>;
  publicUrl: string | undefined;
}

let scenario: Scenario;

vi.mock("../../server/storage", () => ({
  storage: {
    wsClientGrants: {
      async getByClient() {
        return scenario.grants;
      },
    },
    pluginConfigs: {
      async getByKind() {
        return scenario.configs;
      },
      async get(id: string) {
        return scenario.configs.find((c) => c.id === id);
      },
    },
  },
}));

// Only the component gate is stubbed; the rest of the plugin core (the
// registry the real plugins register into) must stay real.
vi.mock("../../server/plugins/_core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../server/plugins/_core")>()),
  async isPluginComponentEnabledAsync(meta: { requiredComponent?: string }) {
    if (!meta.requiredComponent) return true;
    return scenario.enabledComponents[meta.requiredComponent] === true;
  },
}));

vi.mock("../../server/services/comm/callback-handlers/url-builder", () => ({
  getPublicBaseUrl: () => scenario.publicUrl,
}));

// The real registry, so the document is built from the plugins as actually
// declared — a plugin that stops declaring a verb must break this test.
import { webServiceRegistry } from "../../server/plugins/web-service/registry";
import "../../server/plugins/web-service/plugins/ping";
import "../../server/plugins/web-service/plugins/swagger";
import { buildClientOpenApiDocument } from "../../server/modules/webservices/openapi";
// The dispatcher's own resolver, so the parity test proves the two directions
// agree rather than restating the builder's rule.
import { resolveConfiguration } from "../../server/modules/webservices/addressing";

const CLIENT = { id: CLIENT_ID, name: "Freeman Integration" } as any;

function config(overrides: Partial<Scenario["configs"][number]>): Scenario["configs"][number] {
  return {
    id: "config-ping",
    pluginKind: "web-service",
    pluginId: "ping-v1",
    enabled: true,
    name: "Ping Service",
    data: { alias: "ping" },
    ...overrides,
  };
}

beforeEach(() => {
  scenario = {
    grants: [{ configId: "config-ping" }],
    configs: [config({})],
    enabledComponents: {},
    publicUrl: "https://union.example.org",
  };
});

describe("client API document", () => {
  it("describes a granted service at its alias", async () => {
    const doc = await buildClientOpenApiDocument(CLIENT);

    expect(Object.keys(doc.paths)).toEqual(["/api/ws/ping/ping"]);
    const path = doc.paths["/api/ws/ping/ping"];
    // Exactly the verbs the plugin declares — the dispatcher refuses the rest.
    expect(Object.keys(path).sort()).toEqual(["get", "post"]);
    expect(doc.servers[0].url).toBe("https://union.example.org");
  });

  it("omits a service the client holds no grant for", async () => {
    scenario.configs.push(
      config({ id: "config-other", name: "Not Granted", data: { alias: "other" } }),
    );

    const doc = await buildClientOpenApiDocument(CLIENT);

    expect(Object.keys(doc.paths)).toEqual(["/api/ws/ping/ping"]);
  });

  it("omits a granted service that is switched off", async () => {
    scenario.configs = [config({ enabled: false })];

    const doc = await buildClientOpenApiDocument(CLIENT);

    // A disabled configuration is refused by the dispatcher, so publishing it
    // would document a call that cannot succeed.
    expect(doc.paths).toEqual({});
    expect(String(doc.info.description)).toContain("granted no callable service");
  });

  it("omits a service whose component is disabled", async () => {
    scenario.grants = [{ configId: "config-export" }];
    scenario.configs = [
      config({
        id: "config-export",
        pluginId: "edls-sheet-export-v1",
        name: "Sheet Export",
        data: { alias: "sheets" },
      }),
    ];
    scenario.enabledComponents = { edls: false };

    await import("../../server/plugins/web-service/plugins/edls-sheet-export");
    const doc = await buildClientOpenApiDocument(CLIENT);

    expect(doc.paths).toEqual({});

    scenario.enabledComponents = { edls: true };
    const enabledDoc = await buildClientOpenApiDocument(CLIENT);
    expect(Object.keys(enabledDoc.paths)).toEqual(["/api/ws/sheets/v1_sheet_export"]);
  });

  it("omits a service whose plugin is not registered", async () => {
    scenario.configs = [config({ pluginId: "removed-plugin-v1" })];

    const doc = await buildClientOpenApiDocument(CLIENT);

    expect(doc.paths).toEqual({});
  });

  it("falls back to the configuration id, and says the id is environment-specific", async () => {
    scenario.configs = [config({ data: {} })];

    const doc = await buildClientOpenApiDocument(CLIENT);

    expect(Object.keys(doc.paths)).toEqual(["/api/ws/config-ping/ping"]);
    expect(String(doc.info.description)).toContain("configuration id rather than an alias");
    expect(String((doc.paths["/api/ws/config-ping/ping"].get as any).description)).toContain(
      "only in this environment",
    );
  });

  it("does not publish an alias two configurations share", async () => {
    // Aliases are not unique at save time, and the dispatcher refuses an
    // ambiguous one — publishing it would document a call that always 404s.
    scenario.configs = [
      config({ data: { alias: "shared" } }),
      config({ id: "config-twin", name: "Twin", data: { alias: "shared" } }),
    ];

    const doc = await buildClientOpenApiDocument(CLIENT);

    expect(Object.keys(doc.paths)).toEqual(["/api/ws/config-ping/ping"]);
    expect(String((doc.paths["/api/ws/config-ping/ping"].get as any).description)).toContain(
      "names more than one configuration",
    );
  });

  it("does not publish an alias that another configuration's id shadows", async () => {
    // The dispatcher matches ids before aliases, so this alias reaches the
    // OTHER service. Publishing it would name one service at another's address.
    scenario.configs = [
      config({ data: { alias: "config-other" } }),
      config({ id: "config-other", name: "Other", data: { alias: "other" } }),
    ];

    const doc = await buildClientOpenApiDocument(CLIENT);

    expect(Object.keys(doc.paths)).toEqual(["/api/ws/config-ping/ping"]);
    expect(String((doc.paths["/api/ws/config-ping/ping"].get as any).description)).toContain(
      "another configuration's id",
    );
  });

  it("publishes only addresses the dispatcher resolves back to the same service", async () => {
    // The parity property itself, over a deliberately nasty configuration set.
    scenario.configs = [
      config({ data: { alias: "shared" } }),
      config({ id: "config-twin", name: "Twin", data: { alias: "shared" } }),
      config({ id: "config-shadow", name: "Shadow", data: { alias: "config-ping" } }),
      config({ id: "config-clean", name: "Clean", data: { alias: "clean" } }),
      config({ id: "config-bare", name: "Bare", data: {} }),
    ];
    scenario.grants = scenario.configs.map((c) => ({ configId: c.id }));

    const doc = await buildClientOpenApiDocument(CLIENT);
    const published = Object.keys(doc.paths);

    // Every configuration is documented exactly once...
    expect(published).toHaveLength(scenario.configs.length);

    // ...and the addresses published resolve, through the dispatcher's own
    // resolver, onto exactly the granted configurations: no address that dies,
    // none that lands on a service other than the one it was published for.
    const resolvedIds: string[] = [];
    for (const path of published) {
      const address = path.replace("/api/ws/", "").split("/")[0];
      const resolved = await resolveConfiguration(address);
      expect(resolved, `${address} did not resolve`).toMatchObject({ ok: true });
      resolvedIds.push((resolved as any).config.id);
    }

    expect(resolvedIds.sort()).toEqual(scenario.configs.map((c) => c.id).sort());
  });

  it("publishes both authentication schemes and no credential value", async () => {
    scenario.configs = [
      config({
        data: { alias: "ping", clientSecret: "s3cret-setting", apiKey: "do-not-publish" },
      }),
    ];

    const doc = await buildClientOpenApiDocument(CLIENT);
    const serialized = JSON.stringify(doc);

    expect(Object.keys(doc.components.securitySchemes as object).sort()).toEqual([
      "wsBasicAuth",
      "wsClientKey",
      "wsClientSecret",
    ]);
    // Two alternatives: the header pair, or Basic.
    expect(doc.security).toEqual([{ wsClientKey: [], wsClientSecret: [] }, { wsBasicAuth: [] }]);
    // A configuration's settings are not part of the contract with its caller.
    expect(serialized).not.toContain("s3cret-setting");
    expect(serialized).not.toContain("do-not-publish");
  });

  it("documents a declared response schema and admits an undeclared one", async () => {
    const doc = await buildClientOpenApiDocument(CLIENT);
    const get = doc.paths["/api/ws/ping/ping"].get as any;
    const post = doc.paths["/api/ws/ping/ping"].post as any;

    // Ping declares its echo response...
    expect(get.responses["200"].content["application/json"].schema).toMatchObject({
      type: "object",
    });
    // ...but deliberately accepts any body, so none is fabricated for it.
    expect(post.requestBody).toBeUndefined();
    expect(String(post.description)).toContain("request body is not described");
  });

  it("carries a declared request schema onto the body-bearing verb", async () => {
    scenario.grants = [{ configId: "config-export" }];
    scenario.configs = [
      config({
        id: "config-export",
        pluginId: "edls-sheet-export-v1",
        name: "Sheet Export",
        data: { alias: "sheets" },
      }),
    ];
    scenario.enabledComponents = { edls: true };

    await import("../../server/plugins/web-service/plugins/edls-sheet-export");
    const doc = await buildClientOpenApiDocument(CLIENT);
    const post = doc.paths["/api/ws/sheets/v1_sheet_export"].post as any;

    expect(post.requestBody.content["application/json"].schema).toMatchObject({
      type: "array",
      minItems: 4,
      maxItems: 4,
    });
    expect(post.responses["200"].content["application/json"].schema).toMatchObject({
      type: "object",
    });
  });

  it("describes the swagger service itself when it is granted", async () => {
    scenario.grants = [{ configId: "config-ping" }, { configId: "config-swagger" }];
    scenario.configs.push(
      config({
        id: "config-swagger",
        pluginId: "swagger-v1",
        name: "API Document",
        data: { alias: "swagger" },
      }),
    );

    const doc = await buildClientOpenApiDocument(CLIENT);

    expect(Object.keys(doc.paths).sort()).toEqual([
      "/api/ws/ping/ping",
      "/api/ws/swagger/swagger",
    ]);
  });

  it("gives every operation a unique id, even across configurations sharing a plugin", async () => {
    scenario.grants = [{ configId: "config-ping" }, { configId: "config-ping-2" }];
    scenario.configs.push(
      config({ id: "config-ping-2", name: "Second Ping", data: { alias: "ping-two" } }),
    );

    const doc = await buildClientOpenApiDocument(CLIENT);
    const ids = Object.values(doc.paths).flatMap((item) =>
      Object.values(item).map((op) => (op as any).operationId),
    );

    expect(new Set(ids).size).toBe(ids.length);
  });

  it("uses a relative server when the installation has no public URL", async () => {
    scenario.publicUrl = undefined;

    const doc = await buildClientOpenApiDocument(CLIENT);

    // A localhost URL would be an address on the integrator's own machine.
    expect(doc.servers[0].url).toBe("/");
    expect(doc.servers[0].description).toContain("no public URL");
  });

  it("keeps the registry as the source of the published verbs", () => {
    const ping = webServiceRegistry.get("ping-v1");
    expect(ping?.operations[0].methods).toEqual(["GET", "POST"]);
  });
});
