import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  configs: new Map<string, any>(), variables: new Map<string, any>(),
  failDelete: false, race: false, transactions: 0,
  warn: vi.fn(),
  SingletonError: class SingletonError extends Error {},
}));
vi.mock("../../server/logger", () => ({ logger: { info: vi.fn(), warn: state.warn, error: vi.fn() } }));
vi.mock("../../server/middleware/request-context", () => ({
  withFrameworkWrite: (fn: () => unknown) => fn(),
}));
vi.mock("../../server/storage/system/plugin-configs", () => ({
  SingletonViolationError: state.SingletonError,
}));
vi.mock("../../server/storage/transaction-context", () => ({
  runInTransaction: async (fn: () => Promise<unknown>) => {
    state.transactions++;
    const configs = structuredClone(state.configs);
    const variables = structuredClone(state.variables);
    try { return await fn(); }
    catch (error) {
      if (!(error instanceof state.SingletonError)) state.configs = configs;
      state.variables = variables;
      throw error;
    }
  },
}));
vi.mock("../../server/storage", () => ({ storage: {
  variables: {
    getByNamePrefix: async () => [...state.variables.values()],
    getByName: async (name: string) => state.variables.get(name),
    delete: async (id: string) => {
      if (state.failDelete) throw new Error("Delete failed");
      state.variables.delete(id);
      return true;
    },
  },
  pluginConfigs: {
    getByKindAndPlugin: async (_kind: string, id: string) => state.configs.has(id) ? [state.configs.get(id)] : [],
    create: async (row: any) => {
      if (state.race) {
        state.race = false;
        // Another process committed a user-disabled singleton before our insert.
        state.configs.set(row.pluginId, { ...row, enabled: false });
        throw new state.SingletonError();
      }
      if (state.configs.has(row.pluginId)) throw new state.SingletonError();
      state.configs.set(row.pluginId, row);
      return { id: row.pluginId, ...row };
    },
  },
} }));
import { initializeFloodPluginSystem, floodPluginRegistry } from "../../server/plugins/system/flood";
import { migrateLegacyFloodConfigs } from "../../server/plugins/system/flood/migrate-legacy";
import { bootstrapSingletonPluginConfigs } from "../../server/plugins/_core/singleton-seeder";
initializeFloodPluginSystem();
beforeEach(() => {
  state.configs.clear(); state.variables.clear(); state.warn.mockClear();
  state.failDelete = false; state.race = false; state.transactions = 0;
});
function legacy(id: string, value: unknown) {
  const name = `flood_${id}`;
  state.variables.set(name, { id: name, name, value });
}
it.each([false, true])("imports legacy settings once (JSON string=%s), ahead of default seeding", async string => {
  const limits = { threshold: 37, windowSeconds: 125 };
  legacy("local-login", string ? JSON.stringify(limits) : limits);
  await migrateLegacyFloodConfigs();
  await bootstrapSingletonPluginConfigs();
  expect(state.configs.get("local-login")).toMatchObject({ enabled: true, data: limits });
  expect(state.variables.size).toBe(0);
  expect(state.configs.size).toBe(floodPluginRegistry.listIds().length);
  await migrateLegacyFloodConfigs();
  await bootstrapSingletonPluginConfigs();
  expect(state.configs.get("local-login").data).toEqual(limits);
});
it("preserves existing operator settings and explicit disablement", async () => {
  const existing = { enabled: false, data: { threshold: 99, windowSeconds: 456 } };
  state.configs.set("local-login", existing);
  legacy("local-login", { threshold: 1, windowSeconds: 2 });
  await migrateLegacyFloodConfigs();
  expect(state.configs.get("local-login")).toEqual(existing);
  expect(state.variables.size).toBe(0);
});
it("retains malformed and orphaned sources, while generic seeding supplies safe defaults", async () => {
  legacy("local-login", "{broken");
  legacy("bookmark", { threshold: -1, windowSeconds: 5 });
  legacy("retired", { threshold: 1, windowSeconds: 2 });
  await migrateLegacyFloodConfigs();
  expect(state.variables.size).toBe(3);
  expect(state.configs.size).toBe(0);
  expect(state.warn).toHaveBeenCalledTimes(3);
  await bootstrapSingletonPluginConfigs();
  expect(state.configs.get("local-login").data).toEqual({ threshold: 10, windowSeconds: 900 });
  expect(state.variables.size).toBe(3);
});
it("rolls back both halves on failure and can safely retry", async () => {
  legacy("local-login", { threshold: 23, windowSeconds: 45 });
  state.failDelete = true;
  await expect(migrateLegacyFloodConfigs()).rejects.toThrow("Delete failed");
  expect(state.configs.size).toBe(0);
  expect(state.variables.size).toBe(1);
  state.failDelete = false;
  await migrateLegacyFloodConfigs();
  expect(state.configs.get("local-login").data.threshold).toBe(23);
  expect(state.variables.size).toBe(0);
});
it("retries a concurrent singleton winner outside the aborted transaction", async () => {
  legacy("local-login", { threshold: 7, windowSeconds: 8 });
  state.race = true;
  await migrateLegacyFloodConfigs();
  expect(state.transactions).toBe(2);
  expect(state.configs.get("local-login").enabled).toBe(false);
  expect(state.variables.size).toBe(0);
});
