import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ComponentSchemaState } from "../../shared/components";

const mocks = vi.hoisted(() => ({
  state: null as ComponentSchemaState | null,
  exists: true,
  requiredUser: false,
  rows: ["anonymous", "associated"],
  calls: [] as string[],
  migrationError: false,
  push: vi.fn(),
  migrate: vi.fn(),
  component: {
    id: "system.session_history", name: "Session History", managesSchema: true,
    schemaManifest: { tables: ["session_history"], schemaPath: "history-schema", version: 1 },
  },
}));
vi.mock("../../shared/components", () => ({
  getComponentById: () => mocks.component,
  getComponentSchemaStateVariableName: () => "component_schema_state_system.session_history",
}));
vi.mock("../../server/storage", () => ({
  storage: {
    variables: {
      getByName: async () => mocks.state ? { id: "schema-state", value: mocks.state } : undefined,
      create: async (entry: { value: ComponentSchemaState }) => { mocks.state = entry.value; },
      update: async (_id: string, entry: { value: ComponentSchemaState }) => { mocks.state = entry.value; },
    },
  },
}));
vi.mock("../../server/storage/utils", () => ({
  tableExists: async () => mocks.exists,
  tableHasRows: async () => mocks.rows.length > 0,
}));
vi.mock("../../server/logger", () => ({ storageLogger: { error: vi.fn() } }));
vi.mock("../../server/services/component-cache", () => ({
  isComponentEnabledSync: () => false, isCacheInitialized: () => true, loadComponentCache: vi.fn(),
}));
vi.mock("../../server/services/migration-runner", () => ({
  getComponentMigrations: () => [{ version: 1 }, { version: 2 }, { version: 3 }],
  runComponentMigrations: mocks.migrate,
}));
vi.mock("../../server/services/component-schema-push", () => ({ pushComponentSchema: mocks.push }));

import { disableComponentSchema, enableComponentSchema } from "../../server/services/component-lifecycle";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.exists = true;
  mocks.requiredUser = false;
  mocks.rows = ["anonymous", "associated"];
  mocks.calls = [];
  mocks.migrationError = false;
  mocks.state = {
    manifestVersion: 1, migrationVersion: 2, lastSyncedAt: "2026-10-01T00:00:00Z", drift: null,
    tables: [{ tableName: "session_history", status: "active", appliedAt: "2026-10-01T00:00:00Z", droppedAt: null, checksum: "v1" }],
    migrationsApplied: [{ version: 2, name: "add_device_id", appliedAt: "2026-10-01T00:00:00Z" }],
  };
  mocks.migrate.mockImplementation(async () => {
    mocks.calls.push("migrate");
    if (!mocks.state) throw new Error("No schema state");
    if (mocks.migrationError) return { errors: ["synthetic migration failure"] };
    if (!mocks.exists) throw new Error("No tables to migrate");
    mocks.rows = mocks.rows.filter(row => row !== "anonymous");
    mocks.requiredUser = true;
    mocks.state = { ...mocks.state, migrationVersion: 3 };
    return { errors: [] };
  });
  mocks.push.mockImplementation(async () => {
    mocks.calls.push("push");
    if (mocks.exists && !mocks.requiredUser) throw new Error("Retained table has nullable user_id");
    mocks.exists = true;
    mocks.requiredUser = true;
  });
});

describe("retained session-history upgrades", () => {
  it.each([true, false])("upgrades before verifying retained data (schema state exists=%s)", async hasState => {
    const disabled = await disableComponentSchema("system.session_history");
    expect(disabled.success).toBe(true);
    expect(mocks.exists).toBe(true);
    if (!hasState) mocks.state = null;
    const enabled = await enableComponentSchema("system.session_history");
    expect(enabled.success).toBe(true);
    expect(mocks.calls).toEqual(["migrate", "push"]);
    expect(mocks.rows).toEqual(["associated"]);
    expect(enabled.schemaState?.migrationVersion).toBe(3);
    expect(enabled.schemaState?.tables[0].status).toBe("active");
    expect(mocks.migrate).toHaveBeenCalledOnce();
  });
  it("creates a fresh schema before running its migrations", async () => {
    mocks.exists = false;
    mocks.state = null;
    mocks.rows = [];
    const result = await enableComponentSchema("system.session_history");
    expect(result.success).toBe(true);
    expect(mocks.calls).toEqual(["push", "migrate"]);
    expect(result.schemaState?.migrationVersion).toBe(3);
  });
  it("refuses enablement if the retained-table migration fails", async () => {
    mocks.migrationError = true;
    const result = await enableComponentSchema("system.session_history");
    expect(result.success).toBe(false);
    expect(result.error).toContain("synthetic migration failure");
    expect(mocks.push).not.toHaveBeenCalled();
    expect(mocks.rows).toEqual(["anonymous", "associated"]);
    expect(mocks.state?.migrationVersion).toBe(2);
  });
  it("does not replay migrations for an already-upgraded retained table", async () => {
    mocks.state!.migrationVersion = 3;
    mocks.requiredUser = true;
    mocks.rows = ["associated"];
    const result = await enableComponentSchema("system.session_history");
    expect(result.success).toBe(true);
    expect(mocks.calls).toEqual(["push"]);
    expect(mocks.migrate).not.toHaveBeenCalled();
    expect(result.schemaState?.migrationsApplied).toEqual(mocks.state?.migrationsApplied);
  });
});
