import { describe, expect, it, vi } from "vitest";

const secretField = {
  name: "secretName",
  label: "Secret Name",
  type: "string",
  required: true,
};

const plugins = [
  { id: "dummy", fields: [] },
  { id: "stripe", fields: [secretField] },
];

vi.mock("../../server/plugins/_core", () => ({
  getPluginKind: () => ({
    registry: {
      list: () => plugins,
      getMetadata: (plugin: { id: string }) => ({ id: plugin.id }),
    },
  }),
  getPluginConfigAdapter: () => ({
    envelopeFields: [secretField],
    envelopeFieldsForPlugin: (plugin: { fields: unknown[] }) => plugin.fields,
  }),
  enforceKindGating: async () => ({ ok: true }),
  enforcePluginGating: async () => ({ ok: true }),
  defaultHydrate: vi.fn(),
}));

vi.mock("../../server/storage", () => ({ storage: {} }));
vi.mock("../../server/storage/system/plugin-configs", () => ({
  SingletonViolationError: class SingletonViolationError extends Error {},
}));
vi.mock("../../server/storage/transaction-context", () => ({
  runInTransaction: vi.fn(),
}));

const { registerPluginsConfigRoutes } = await import(
  "../../server/modules/system/plugins-config"
);

describe("wc-vendor config metadata", () => {
  it("preserves an explicit empty envelope override for credential-free vendors", async () => {
    let metaHandler: ((req: any, res: any) => Promise<void>) | undefined;
    const app = {
      get: vi.fn((path: string, ...handlers: any[]) => {
        if (path === "/api/plugins/:kind/configs/meta") {
          metaHandler = handlers.at(-1);
        }
      }),
      post: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    };
    registerPluginsConfigRoutes(app as any, vi.fn());
    if (!metaHandler) throw new Error("plugin config metadata route was not registered");

    const json = vi.fn();
    const res = {
      status: vi.fn().mockReturnThis(),
      json,
    };
    await metaHandler({ params: { kind: "wc-vendors" } }, res);

    expect(json).toHaveBeenCalledWith({
      envelopeFields: [secretField],
      pluginFields: {},
      pluginEnvelopeFields: {
        dummy: [],
        stripe: [secretField],
      },
    });
  });
});