import type { Express, Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ComponentDefinition } from "../../shared/components";

const mocks = vi.hoisted(() => ({
  components: [] as ComponentDefinition[],
  read: vi.fn(), update: vi.fn(), tableExists: vi.fn(),
}));
vi.mock("../../shared/components", () => ({
  getAllComponents: () => mocks.components,
  getComponentById: (id: string) => mocks.components.find(component => component.id === id),
}));
vi.mock("../../server/storage", () => ({ storage: {} }));
vi.mock("../../server/storage/utils", () => ({ tableExists: mocks.tableExists, tableHasRows: vi.fn() }));
vi.mock("../../server/logger", () => ({ storageLogger: { error: vi.fn() } }));
vi.mock("../../server/services/boot/migration-runner", () => ({
  runComponentMigrations: vi.fn(), getComponentMigrations: vi.fn(),
}));
vi.mock("../../server/services/component/state", () => ({
  readComponentStateFromStorage: mocks.read,
  resolveComponentEnabled: (component: ComponentDefinition, state: Record<string, boolean>) =>
    Object.hasOwn(state, component.id) ? state[component.id] : component.enabledByDefault,
}));
vi.mock("../../server/services/component/cache", () => ({ updateComponentCache: mocks.update }));
vi.mock("../../server/services/component/permissions", () => ({ syncComponentPermissions: vi.fn() }));
vi.mock("../../server/services/access-policy-evaluator", () => ({
  requireAccess: () => vi.fn(), clearAccessCache: vi.fn(),
}));
import { checkComponentDependents, disableComponentSchema } from "../../server/services/component/lifecycle";
import { registerComponentRoutes } from "../../server/modules/components";

const definition = (id: string, extra: Partial<ComponentDefinition> = {}): ComponentDefinition => ({
  id, name: id.toUpperCase(), description: id, enabledByDefault: false, ...extra,
});
beforeEach(() => {
  vi.clearAllMocks();
  mocks.components = [
    definition("base"),
    definition("consumer", { enabledByDefault: true, dependsOnComponents: ["base"] }),
    definition("base.child", { enabledByDefault: true }),
    definition("off", { dependsOnComponents: ["base"] }),
  ];
  mocks.read.mockResolvedValue({ state: {} });
});

describe("refusing component disables with enabled dependents", () => {
  it("uses the declared list and effective flags, not dotted names or disabled consumers", async () => {
    expect(await checkComponentDependents("base")).toEqual([{ componentId: "consumer", componentName: "CONSUMER" }]);
    mocks.read.mockResolvedValue({ state: { consumer: false, off: true } });
    expect(await checkComponentDependents("base")).toEqual([{ componentId: "off", componentName: "OFF" }]);
    mocks.read.mockResolvedValue({ state: { consumer: false } });
    expect(await checkComponentDependents("base")).toEqual([]);
  });

  it.each([true, false])("refuses direct lifecycle calls before any mutation with retainData=%s", async retainData => {
    mocks.components[0].managesSchema = true;
    mocks.components[0].schemaManifest = { version: 1, schemaPath: "unused", tables: ["base_rows"] };
    expect(await disableComponentSchema("base", { retainData })).toMatchObject({
      success: false, schemaOperations: [],
      enabledDependents: [{ componentId: "consumer", componentName: "CONSUMER" }],
    });
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.tableExists).not.toHaveBeenCalled();
  });

  it.each([true, false])("returns 409 before confirmation or writes for managesSchema=%s", async managesSchema => {
    mocks.components[0].managesSchema = managesSchema;
    let put: ((req: Request, res: Response) => Promise<unknown>) | undefined;
    const app = {
      get: vi.fn(), post: vi.fn(),
      put: (_path: string, _auth: unknown, handler: typeof put) => { put = handler; },
    } as unknown as Express;
    registerComponentRoutes(app, vi.fn(), () => vi.fn());
    const status = vi.fn().mockReturnThis();
    const json = vi.fn();
    await put!({ params: { componentId: "base" }, body: { enabled: false, retainData: false } } as unknown as Request,
      { status, json } as unknown as Response);
    expect(status).toHaveBeenCalledWith(409);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({
      enabledDependents: [{ componentId: "consumer", componentName: "CONSUMER" }],
      schemaOperations: [],
    }));
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.tableExists).not.toHaveBeenCalled();
  });

  it("allows the lifecycle after dependents are off", async () => {
    mocks.read.mockResolvedValue({ state: { consumer: false } });
    expect(await disableComponentSchema("base")).toMatchObject({ success: true });
  });

  it("fails closed when current state cannot be read", async () => {
    mocks.read.mockRejectedValue(new Error("Storage unavailable"));
    await expect(disableComponentSchema("base")).rejects.toThrow("Storage unavailable");
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
