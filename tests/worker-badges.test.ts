import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import { drizzle } from "drizzle-orm/pg-proxy";
import { getTableConfig } from "drizzle-orm/pg-core";
import { getTableName } from "drizzle-orm";

const state = vi.hoisted(() => ({
  client: undefined as unknown,
  enabled: true, admin: true, signedIn: true,
  queries: [] as { query: string; params: unknown[] }[],
}));
vi.mock("../server/storage/transaction-context", () => ({ getClient: () => state.client }));
vi.mock("../server/storage/middleware/logging", () => ({
  defineLoggingConfig: (config: unknown) => config,
  withStorageLogging: (storage: unknown) => storage,
}));
vi.mock("../server/storage", () => ({ storage: {} }));
vi.mock("../server/logger", () => ({ logger: { error: vi.fn() } }));
vi.mock("../server/services/entity-notes/registry", () => ({
  listEntityNoteContexts: () => [], getEntityNoteContext: vi.fn(),
}));
vi.mock("../server/services/entity-files/registry", () => ({
  listEntityFileContexts: () => [], getEntityFileContext: vi.fn(),
}));
vi.mock("../server/modules/components", () => ({
  isComponentEnabled: async () => state.enabled,
  requireComponent: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../server/services/access-policy-evaluator", () => ({
  requireAccess: (permission: string) => (_req: unknown, res: express.Response, next: () => void) => {
    if (!state.signedIn || (permission === "admin" && !state.admin)) res.status(403).json({ message: "Forbidden" });
    else next();
  },
}));
vi.mock("../server/modules/options-transfer", () => ({
  registerOptionsTransferRoutes: vi.fn(),
  getDisabledOptionFieldNames: async () => new Set(),
}));

import { getComponentById } from "../shared/components";
import { optionsWorkerBadgeTypes, workerBadgesDenorm, insertOptionsWorkerBadgeTypeSchema, insertWorkerBadgeDenormSchema } from "../shared/schema";
import { createUnifiedOptionsStorage, optionsMetadata } from "../server/storage/unified-options";
import { getOptionsType } from "../server/modules/options-registry";
import { buildOptionCreateData, buildOptionUpdateData, optionDbErrorMessage } from "../server/modules/options-write-rules";
import { registerConsolidatedOptionsRoutes } from "../server/modules/options-routes";

let server: Server;
let origin: string;
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  registerConsolidatedOptionsRoutes(app);
  server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No test port");
  origin = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => { if (server) await new Promise<void>(resolve => server.close(() => resolve())); });
beforeEach(() => {
  state.enabled = state.admin = state.signedIn = true;
  state.queries = [];
  state.client = drizzle(async (query, params) => {
    state.queries.push({ query, params });
    return { rows: query.startsWith("delete")
      ? [["badge-fixture"]]
      : [["badge-fixture", "Star", "Badge", null, "Description", { preserved: true }]] };
  });
});
const config = () => getOptionsType("worker-badge-type")!;

describe("worker badge schema and options declaration", () => {
  it("owns its tables in dependency order and starts disabled", () => {
    const component = getComponentById("worker.badges")!;
    expect(component.enabledByDefault).toBe(false);
    expect(component.schemaManifest?.tables).toEqual(["options_worker_badge_types", "worker_badges_denorm"]);
    expect(component.pluginConfigs).toBeUndefined();
  });
  it("declares both independent unconditional unique constraints and cascading required FKs", () => {
    const table = getTableConfig(workerBadgesDenorm);
    expect(table.uniqueConstraints.map(c => c.columns.map(column => column.name))).toEqual([
      ["worker_id", "badge_type_id"], ["denorm_id"],
    ]);
    expect(table.indexes).toEqual([]);
    expect(table.foreignKeys).toHaveLength(3);
    for (const fk of table.foreignKeys) {
      expect(fk.onDelete).toBe("cascade");
      expect(fk.reference().columns[0].notNull).toBe(true);
    }
    expect(table.foreignKeys.map(fk => getTableName(fk.reference().foreignTable)).sort()).toEqual([
      "denorm", "options_worker_badge_types", "workers",
    ]);
    expect(insertWorkerBadgeDenormSchema.safeParse({}).success).toBe(false);
    expect(insertWorkerBadgeDenormSchema.safeParse({ workerId: "worker", badgeTypeId: "type", denormId: "status" }).success).toBe(true);
  });
  it("offers a dedicated icon picker but no raw JSON or editable awards resource", () => {
    const metadata = optionsMetadata["worker-badge-type"];
    expect(metadata.table).toBe(optionsWorkerBadgeTypes);
    expect(metadata.requiredComponent).toBe("worker.badges");
    const definition = createUnifiedOptionsStorage().getDefinition("worker-badge-type")!;
    expect(definition.fields.find(f => f.name === "icon")?.dataField).toBeUndefined();
    expect(definition.schema.properties?.icon?.["x-widget"]).toBe("icon");
    expect(definition.schema.properties).not.toHaveProperty("data");
    expect(getOptionsType("worker_badges_denorm")).toBeUndefined();
  });
  it("normalizes explicit blanks without inventing values for omitted partial fields", () => {
    expect(insertOptionsWorkerBadgeTypeSchema.parse({ name: " Badge ", siriusId: "  " })).toEqual({ name: "Badge", siriusId: null });
    expect(insertOptionsWorkerBadgeTypeSchema.partial().parse({ name: "Renamed" })).toEqual({ name: "Renamed" });
    expect(buildOptionCreateData(config(), { name: "Badge", siriusId: "" })).toEqual({ data: { name: "Badge", siriusId: null } });
    expect(buildOptionUpdateData(config(), { siriusId: " " })).toEqual({ updates: { siriusId: null } });
    expect(buildOptionUpdateData(config(), { name: "Renamed" })).toEqual({ updates: { name: "Renamed" } });
    expect(buildOptionCreateData(config(), { name: "   " })).toHaveProperty("error");
    expect(buildOptionUpdateData(config(), { siriusId: 42 })).toHaveProperty("error");
    expect(buildOptionCreateData(config(), { name: "Badge", workerId: "worker", active: true }))
      .toEqual({ data: { name: "Badge" } });
  });
  it("validates direct generic storage calls too", async () => {
    const storage = createUnifiedOptionsStorage();
    await storage.create("worker-badge-type", { name: "Badge", icon: "Star", siriusId: "" });
    expect(state.queries[0].params).toContain(null);
    expect(state.queries[0].query).toContain('"icon"');
    await storage.update("worker-badge-type", "badge-fixture", { name: "Renamed" });
    expect(state.queries[1].query.split(" where ")[0]).not.toContain('"sirius_id"');
    await expect(storage.create("worker-badge-type", { name: "" })).rejects.toThrow();
  });
  it("uses existing Sirius-ID conflict messaging", () => {
    expect(optionDbErrorMessage({ code: "23505", constraint: "options_worker_badge_types_sirius_id_unique" }))
      .toEqual({ status: 400, message: "An item with this Sirius ID already exists. Sirius IDs must be unique." });
  });
});

describe("existing generic badge-type routes", () => {
  it("keeps the component hint in code-supplied definitions without reading disabled data", async () => {
    state.enabled = false;
    const response = await fetch(`${origin}/api/options/definitions`);
    expect(response.status).toBe(200);
    const definitions = await response.json();
    expect(definitions.find((definition: { type: string }) => definition.type === "worker-badge-type"))
      .toMatchObject({ requiredComponent: "worker.badges" });
    expect(state.queries).toHaveLength(0);
  });
  it.each([
    ["GET", ""], ["GET", "/badge-fixture"], ["GET", "/definition"],
    ["POST", ""], ["PUT", "/badge-fixture"], ["DELETE", "/badge-fixture"],
  ])("refuses %s %s without querying a disabled table", async (method, path) => {
    state.enabled = false;
    const response = await fetch(`${origin}/api/options/worker-badge-type${path}`, { method });
    expect(response.status).toBe(403);
    expect((await response.json()).componentId).toBe("worker.badges");
    expect(state.queries).toHaveLength(0);
  });
  it("offers its definition and exercises CRUD through existing routes", async () => {
    const definition = await fetch(`${origin}/api/options/worker-badge-type/definition`);
    expect(definition.status).toBe(200);
    expect(await definition.json()).toMatchObject({ requiredComponent: "worker.badges" });
    for (const [method, path, body, expected] of [
      ["GET", "", undefined, 200],
      ["GET", "/badge-fixture", undefined, 200],
      ["POST", "", { name: "Badge", icon: "Star", siriusId: "" }, 201],
      ["PUT", "/badge-fixture", { name: "Renamed" }, 200],
      ["DELETE", "/badge-fixture", undefined, 204],
    ] as const) {
      const response = await fetch(`${origin}/api/options/worker-badge-type${path}`, {
        method, headers: { "Content-Type": "application/json" },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      expect(response.status).toBe(expected);
    }
    expect(state.queries.every(call => call.query.includes("options_worker_badge_types"))).toBe(true);
    const update = state.queries.find(call => call.query.startsWith("update"))!;
    expect(update.query.split(" where ")[0]).not.toMatch(/"(data|sirius_id)"/);
  });
  it.each(["POST", "PUT", "DELETE"])("keeps %s administrator-only", async method => {
    state.admin = false;
    const path = method === "POST" ? "" : "/badge-fixture";
    const response = await fetch(`${origin}/api/options/worker-badge-type${path}`, { method });
    expect(response.status).toBe(403);
    expect(state.queries).toHaveLength(0);
  });
});
