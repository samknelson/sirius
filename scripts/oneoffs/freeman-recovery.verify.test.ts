import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const f = vi.hoisted(() => ({
  vars: new Map<string, any>(), available: true, held: false, handle: null as any,
  maintenance: false, enabled: true, active: true, admin: true,
  wc: vi.fn(), reads: [] as string[], writes: 0,
  assertions: 0, scopes: [] as any[], runOutside: vi.fn((fn: any) => fn()),
  releaseCount: 0, assertError: false,
  control: "SITESPECIFIC_FREEMAN_MIGRATE_RUN",
  stop: "SITESPECIFIC_FREEMAN_MIGRATE_STOP",
  state: "SITESPECIFIC_FREEMAN_MIGRATE_STATUS",
}));
vi.mock("../../server/storage", () => ({
  FreemanEdlsFullResetUnexpectedError: class extends Error {},
  storage: {
    variables: {
      getByName: async (name: string) => f.vars.has(name) ? { id: name, value: f.vars.get(name) } : undefined,
      create: async ({ name, value }: any) => { f.vars.set(name, value); f.writes++; },
      update: async (name: string, { value }: any) => { f.vars.set(name, value); f.writes++; },
    },
    advisoryLock: {
      withTransactionLock: async (name: string, fn: any) => {
        // Promise mutex is replaced below by the test hook. No real DB writes.
        return mutex(name, fn);
      },
      tryAcquireSession: async () => {
        if (!f.available || f.held) return null;
        f.held = true;
        const handle = {
          assertHeld: async () => { f.assertions++; if (f.assertError) throw new Error("lost"); },
          release: async () => { if (f.handle === handle) { f.held = false; f.releaseCount++; } },
        };
        f.handle = handle;
        return handle;
      },
    },
    users: {
      getUser: async (id: string) => id === "actor" ? { id, isActive: f.active, email: "actor@example.invalid" } : undefined,
      userHasPermission: async () => f.admin,
    },
    workerIds: { getTypeIdBySiriusId: async () => "fixture-type" },
    employers: { getEmployer: async () => ({ id: "fixture-employer" }) },
  },
}));
const locks = new Map<string, Promise<unknown>>();
async function mutex(name: string, fn: () => Promise<any>) {
  const previous = locks.get(name) ?? Promise.resolve();
  let unlock!: () => void;
  const wait = new Promise<void>(resolve => { unlock = resolve; });
  const next = previous.then(() => wait);
  locks.set(name, next);
  await previous;
  try { return await fn(); } finally { unlock(); if (locks.get(name) === next) locks.delete(name); }
}
vi.mock("../../server/storage/transaction-context", () => ({
  getClient: vi.fn(), runInTransaction: async (fn: any) => fn(), runInSavepoint: async (fn: any) => fn(),
  runOutsideTransaction: (fn: any) => f.runOutside(fn),
}));
vi.mock("../../server/storage/edls/sheets", () => ({ validate: vi.fn() }));
vi.mock("../../server/services/webclient", () => ({
  wcRequest: async (request: any) => {
    const { getRequestContext } = await import("../../server/middleware/request-context");
    f.scopes.push(getRequestContext());
    f.reads.push(request.args.status);
    return f.wc(request);
  },
}));
vi.mock("../../server/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("../../server/modules/components", () => ({ isComponentEnabled: async () => f.enabled }));
vi.mock("../../server/services/maintenance-flag", () => ({ isMaintenanceActive: () => f.maintenance }));
vi.mock("../../server/modules/edls/supervisor-context", () => ({ getEdlsSettings: async () => ({ employer: "fixture-employer" }) }));
vi.mock("../../server/plugins/system/denorm/registry", () => ({ recomputeDenormEntity: vi.fn() }));
vi.mock("../../server/plugins/wc-vendors/plugins/sitespecific-freeman-edls-migrate", () => ({
  FREEMAN_EDLS_FETCH_SHEETS_OPERATION: "fetch",
  FREEMAN_EDLS_MIGRATE_PLUGIN_ID: "fixture-vendor",
  FREEMAN_EDLS_MIGRATE_COMPONENT_ID: "fixture-migrate",
}));

const emptyResponse = () => ({
  outcome: "success",
  value: { success: true, data: { success: true, data: { success: true, data: { sheets: [] } } } },
});
const current = () => JSON.parse(f.vars.get(f.control));
const save = (value: any) => f.vars.set(f.control, JSON.stringify(value));
const tick = async () => { for (let i = 0; i < 150; i++) await new Promise(resolve => setTimeout(resolve, 0)); };
function seed(overrides: Record<string, unknown> = {}) {
  save({
    runId: "saved-run", recoveryEnabled: true, actorId: "actor", originalActorId: null,
    resumedAt: null, resumeCount: 0, deferredReason: null,
    lifecycle: "running", limit: 10, stopRequested: false,
    startedAt: "2026-11-01T00:00:00Z", heartbeatAt: "2026-11-01T00:00:00Z", finishedAt: null,
    batchCount: 5,
    totals: { fetched: 30, valid: 30, created: 12, updated: 4, unchanged: 14, failed: 0,
      records: { crews: { created: 1, updated: 2 }, workers: { created: 3, updated: 4 }, assignments: { created: 5, updated: 6 } } },
    latestBatch: null, error: null,
    ...overrides,
  });
  f.vars.set(f.state, JSON.stringify({ statuses: Object.fromEntries(["draft", "request", "lock", "reserved"].map(status => [
    status, { page: 3, startDate: "2026-01-01T00:00:00Z", sweepStartedAt: "2026-11-01T00:00:00Z" },
  ])) }));
}

beforeEach(() => {
  f.vars.clear(); f.available = true; f.held = false; f.handle = null; f.maintenance = false;
  f.enabled = true; f.active = true; f.admin = true; f.reads = []; f.writes = 0;
  f.assertions = 0; f.scopes = []; f.releaseCount = 0; f.assertError = false;
  f.wc.mockReset().mockImplementation(emptyResponse);
  vi.resetModules();
});
afterEach(async () => { await tick(); });

describe("temporary recovery orchestration checks", () => {
  it("resumes stored identity, cursor, limit, counts and restores actor without inheriting cron actor", async () => {
    seed();
    const mod = await import("../../server/modules/sitespecific/freeman/edls-migrate/import");
    const { requestContext } = await import("../../server/middleware/request-context");
    await requestContext.run({ userId: "wrong-cron-actor", frameworkWrite: true }, () => mod.recoverFreemanMigrate());
    await tick();
    expect(f.wc).toHaveBeenCalledTimes(4);
    expect(f.wc.mock.calls[0][0].args).toMatchObject({ page: 3, limit: 10 });
    expect(current()).toMatchObject({
      runId: "saved-run", startedAt: "2026-11-01T00:00:00Z", batchCount: 6,
      lifecycle: "completed", recoveryEnabled: false, resumeCount: 1,
      totals: { fetched: 30, unchanged: 14 },
    });
    expect(f.scopes.every(scope => scope.userId === "actor" && scope.suppressNotifications && !scope.frameworkWrite)).toBe(true);
    await mod.recoverFreemanMigrate();
    expect(f.wc).toHaveBeenCalledTimes(4);
  });

  it("leaves a stale heartbeat observational and never takes a held lock", async () => {
    seed(); f.available = false;
    const mod = await import("../../server/modules/sitespecific/freeman/edls-migrate/import");
    const before = f.vars.get(f.control);
    const status = await mod.getFreemanMigrateStatus();
    expect(status.recovery.heartbeatStale).toBe(true);
    expect(status.run.lifecycle).toBe("running");
    expect(f.vars.get(f.control)).toBe(before);
    await mod.recoverFreemanMigrate();
    expect(f.wc).not.toHaveBeenCalled();
  });

  it("lets only one of two process modules recover the same run", async () => {
    seed();
    let respond!: () => void;
    f.wc.mockImplementationOnce(() => new Promise(resolve => { respond = () => resolve(emptyResponse()); }));
    const first = await import("../../server/modules/sitespecific/freeman/edls-migrate/import");
    await first.recoverFreemanMigrate(); await tick();
    vi.resetModules();
    const second = await import("../../server/modules/sitespecific/freeman/edls-migrate/import");
    await second.recoverFreemanMigrate(); await tick();
    expect(f.wc).toHaveBeenCalledTimes(1);
    expect(current().resumeCount).toBe(1);
    respond(); await tick();
    expect(current().lifecycle).toBe("completed");
  });

  it("rechecks a stop that arrives after candidate read but before lock acquisition", async () => {
    seed();
    const { storage } = await import("../../server/storage");
    const original = storage.advisoryLock.tryAcquireSession;
    storage.advisoryLock.tryAcquireSession = async (...args) => {
      save({ ...current(), lifecycle: "stopping", recoveryEnabled: false, stopRequested: true });
      f.vars.set(f.stop, "true");
      return original(...args);
    };
    const mod = await import("../../server/modules/sitespecific/freeman/edls-migrate/import");
    try {
      await mod.recoverFreemanMigrate();
      expect(f.wc).not.toHaveBeenCalled();
      expect(current().lifecycle).toBe("stopped");
    } finally {
      storage.advisoryLock.tryAcquireSession = original;
    }
  });

  it("does not let a heartbeat re-enable recovery after Stop safely", async () => {
    seed();
    let respond!: () => void;
    f.wc.mockImplementationOnce(() => new Promise(resolve => { respond = () => resolve(emptyResponse()); }));
    const mod = await import("../../server/modules/sitespecific/freeman/edls-migrate/import");
    await mod.recoverFreemanMigrate(); await tick();
    vi.useFakeTimers();
    try {
      await mod.stopFreemanMigrate();
      await vi.advanceTimersByTimeAsync(30_000);
      expect(current()).toMatchObject({ lifecycle: "stopping", recoveryEnabled: false, stopRequested: true });
    } finally { vi.useRealTimers(); respond(); }
    await tick();
    expect(current().lifecycle).toBe("stopped");
  });

  it.each([
    { lifecycle: "completed" }, { lifecycle: "failed" }, { lifecycle: "stopped" },
    { recoveryEnabled: false },
  ])("does not restart terminal or foreground control: %j", async override => {
    seed(override);
    const mod = await import("../../server/modules/sitespecific/freeman/edls-migrate/import");
    await mod.recoverFreemanMigrate();
    expect(f.wc).not.toHaveBeenCalled();
  });

  it("treats old records as manual and permits an explicit authorized background start", async () => {
    seed();
    const saved = current();
    for (const key of ["runId", "recoveryEnabled", "actorId", "originalActorId", "resumedAt", "resumeCount", "deferredReason"]) delete saved[key];
    save(saved);
    const mod = await import("../../server/modules/sitespecific/freeman/edls-migrate/import");
    expect((await mod.getFreemanMigrateStatus()).recovery.enabled).toBe(false);
    await mod.recoverFreemanMigrate();
    expect(f.wc).not.toHaveBeenCalled();
    const { requestContext } = await import("../../server/middleware/request-context");
    await requestContext.run({ userId: "actor" }, () => mod.startFreemanMigrate({ limit: 7 }));
    await tick();
    expect(f.wc.mock.calls[0][0].args.limit).toBe(7);
    expect(current().runId).not.toBeNull();
  });

  it.each(["maintenance", "components", "inactive", "permission", "missing-user"])("defers recovery without vendor calls for %s", async reason => {
    seed(reason === "missing-user" ? { actorId: "missing" } : {});
    if (reason === "maintenance") f.maintenance = true;
    if (reason === "components") f.enabled = false;
    if (reason === "inactive") f.active = false;
    if (reason === "permission") f.admin = false;
    const mod = await import("../../server/modules/sitespecific/freeman/edls-migrate/import");
    await mod.recoverFreemanMigrate();
    expect(f.wc).not.toHaveBeenCalled();
    expect(current().recoveryEnabled).toBe(true);
    expect((await mod.getFreemanMigrateStatus()).recovery.deferredReason).toBeTruthy();
    f.maintenance = false; f.enabled = true; f.active = true; f.admin = true;
    if (reason === "missing-user") save({ ...current(), actorId: "actor" });
    await mod.recoverFreemanMigrate();
    await tick();
    expect(current().lifecycle).toBe("completed");
  });

  it("settles interrupted stopping without a vendor call", async () => {
    seed({ lifecycle: "stopping", recoveryEnabled: false, stopRequested: true });
    f.vars.set(f.stop, "true");
    const mod = await import("../../server/modules/sitespecific/freeman/edls-migrate/import");
    await mod.recoverFreemanMigrate();
    expect(current()).toMatchObject({ lifecycle: "stopped", recoveryEnabled: false });
    expect(f.vars.get(f.stop)).toBe("false");
    expect(f.wc).not.toHaveBeenCalled();
  });

  it("keeps a deliberate stop durable if the process disappears during a remote request", async () => {
    seed();
    let respond!: () => void;
    f.wc.mockImplementationOnce(() => new Promise(resolve => { respond = () => resolve(emptyResponse()); }));
    const mod = await import("../../server/modules/sitespecific/freeman/edls-migrate/import");
    await mod.recoverFreemanMigrate();
    await tick();
    await mod.stopFreemanMigrate();
    expect(current()).toMatchObject({ lifecycle: "stopping", recoveryEnabled: false, stopRequested: true });
    respond();
    await tick();
    expect(current().lifecycle).toBe("stopped");
    expect(f.wc).toHaveBeenCalledTimes(1);
    await mod.recoverFreemanMigrate();
    expect(f.wc).toHaveBeenCalledTimes(1);
  });

  it("does not retry fatal remote errors", async () => {
    seed();
    f.wc.mockResolvedValue({ outcome: "failed" });
    const mod = await import("../../server/modules/sitespecific/freeman/edls-migrate/import");
    await mod.recoverFreemanMigrate(); await tick();
    expect(current()).toMatchObject({ lifecycle: "failed", recoveryEnabled: false });
    const count = f.wc.mock.calls.length;
    await mod.recoverFreemanMigrate();
    expect(f.wc).toHaveBeenCalledTimes(count);
  });

  it("abandons work without writing state after losing ownership during a request", async () => {
    seed();
    let respond!: () => void;
    f.wc.mockImplementationOnce(() => new Promise(resolve => { respond = () => resolve(emptyResponse()); }));
    const mod = await import("../../server/modules/sitespecific/freeman/edls-migrate/import");
    await mod.recoverFreemanMigrate(); await tick();
    const before = f.vars.get(f.control);
    const state = f.vars.get(f.state);
    f.assertError = true;
    respond(); await tick();
    expect(f.vars.get(f.control)).toBe(before);
    expect(f.vars.get(f.state)).toBe(state);
    expect(f.wc).toHaveBeenCalledTimes(1);
  });

  it("does not allow callbacks from an old run to overwrite a new one", async () => {
    seed();
    let respond!: () => void;
    f.wc.mockImplementationOnce(() => new Promise(resolve => { respond = () => resolve(emptyResponse()); }));
    const mod = await import("../../server/modules/sitespecific/freeman/edls-migrate/import");
    await mod.recoverFreemanMigrate(); await tick();
    save({ ...current(), runId: "newer-run", totals: { ...current().totals, fetched: 99 } });
    const before = f.vars.get(f.control);
    respond(); await tick();
    expect(f.vars.get(f.control)).toBe(before);
    expect(f.wc).toHaveBeenCalledTimes(1);
  });
});
