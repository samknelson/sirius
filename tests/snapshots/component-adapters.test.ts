import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EventName } from "../../server/services/event-bus";

const mocks = vi.hoisted(() => ({
  enabled: true, allowed: true, snapshot: vi.fn(), create: vi.fn(),
  settings: vi.fn(), policyIds: [] as string[],
}));
vi.mock("../../server/storage", () => ({
  storage: { variables: { getByName: mocks.settings }, snapshots: { create: mocks.create, get: mocks.snapshot } },
}));
vi.mock("../../server/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("../../server/services/component/cache", () => ({ isComponentEnabledSync: () => mocks.enabled }));
vi.mock("../../server/services/access-policy-evaluator", () => ({
  requireAccess: (policy: string, entity: (req: any) => string) => (req: any, res: any, next: () => void) => {
    mocks.policyIds.push(`${policy}:${entity(req)}`);
    return mocks.allowed ? next() : res.status(403).json({ message: "Denied" });
  },
}));

beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks();
  mocks.enabled = true; mocks.allowed = true; mocks.policyIds.length = 0;
  mocks.settings.mockResolvedValue(undefined);
  mocks.create.mockResolvedValue({ id: "capture", label: "Saved" });
});
describe("component snapshot declarations", () => {
  it("captures immediately through the registered adapter and honors disablement/settings", async () => {
    const capture = await import("../../server/services/snapshots/capture");
    const exportEntity = vi.fn(async () => ({ version: 1, data: { id: "record" } }));
    const adapter = {
      event: "fixture.saved" as EventName, entityType: "fixture", component: "sample",
      shouldCapture: () => true, getEntityId: () => "record", getLabel: () => "Saved",
      exportEntity, getMetadata: async () => null,
    };
    capture.registerSnapshotCaptureAdapter(adapter);
    expect(exportEntity).not.toHaveBeenCalled();
    await capture.captureEntitySnapshot(adapter.event, {} as never);
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ entityId: "record", entityType: "fixture" }));
    mocks.enabled = false;
    await capture.captureEntitySnapshot(adapter.event, {} as never);
    expect(exportEntity).toHaveBeenCalledTimes(1);
    mocks.enabled = true;
    mocks.settings.mockResolvedValue({ value: { events: { "fixture.saved": false } } });
    await capture.captureEntitySnapshot(adapter.event, {} as never);
    expect(exportEntity).toHaveBeenCalledTimes(1);
    expect(() => capture.registerSnapshotCaptureAdapter(adapter)).toThrow("Duplicate");
    capture.closeSnapshotCaptureRegistration();
    expect(() => capture.registerSnapshotCaptureAdapter(adapter)).toThrow("closed");
  });
  it("keeps live-parent authorization and snapshot membership ahead of decoding", async () => {
    const api = await import("../../server/modules/snapshots");
    const decode = vi.fn((node: { data: unknown }) => node.data);
    api.registerSnapshotEntityType("fixture", { component: "sample", policyId: "fixture.view", decode });
    expect(() => api.registerSnapshotEntityType("fixture", { policyId: "other", decode })).toThrow("Duplicate");
    const routes = new Map<string, Function[]>();
    api.registerSnapshotsRoutes({ get: (path: string, ...handlers: Function[]) => routes.set(path, handlers) } as never,
      (_req: unknown, _res: unknown, next: () => void) => next());
    const handlers = routes.get("/api/snapshots/:entityType/:entityId/:snapshotId")!;
    async function request() {
      const req = { params: { entityType: "fixture", entityId: "parent", snapshotId: "history" } };
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      let index = 0;
      const next = async (): Promise<unknown> => handlers[index++]?.(req, res, next);
      await next();
      await new Promise(resolve => setImmediate(resolve));
      return res;
    }
    mocks.snapshot.mockResolvedValue({ entityType: "fixture", entityId: "someone-else", data: { version: 1, data: {} } });
    expect((await request()).status).toHaveBeenCalledWith(404);
    expect(mocks.policyIds).toEqual(["fixture.view:parent"]);
    expect(decode).not.toHaveBeenCalled();
    mocks.allowed = false;
    expect((await request()).status).toHaveBeenCalledWith(403);
    expect(mocks.snapshot).toHaveBeenCalledTimes(1);
    mocks.enabled = false;
    expect((await request()).status).toHaveBeenCalledWith(404);
    expect(mocks.snapshot).toHaveBeenCalledTimes(1);
    api.closeSnapshotEntityRegistration();
    expect(() => api.registerSnapshotEntityType("new", { policyId: "other", decode })).toThrow("closed");
  });
});
