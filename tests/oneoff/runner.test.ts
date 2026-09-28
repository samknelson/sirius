import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { state, db, columns } = vi.hoisted(() => {
  const columns = {
    id: { name: "id" },
    configurationId: { name: "configurationId" },
    pluginKind: { name: "pluginKind" },
    pluginId: { name: "pluginId" },
    operation: { name: "operation" },
    status: { name: "status" },
    mode: { name: "mode" },
    input: { name: "input" },
    triggeredBy: { name: "triggeredBy" },
    heartbeatAt: { name: "heartbeatAt" },
    startedAt: { name: "startedAt" },
    completedAt: { name: "completedAt" },
    output: { name: "output" },
    confirmationHash: { name: "confirmationHash" },
    confirmationUsedAt: { name: "confirmationUsedAt" },
    cancelRequested: { name: "cancelRequested" },
    progress: { name: "progress" },
    checkpoint: { name: "checkpoint" },
    error: { name: "error" },
  };
  const state: {
    runs: any[];
    lockCalls: any[];
    nextId: number;
    beforeUpdate?: (values: any, condition: any) => void;
  } = {
    runs: [],
    lockCalls: [],
    nextId: 1,
  };
  const db: any = {
    execute: vi.fn(async (query: any) => {
      state.lockCalls.push(query);
      return {};
    }),
    select: vi.fn((projection?: any) => {
      let rows = state.runs;
      const builder: any = {
        from: () => builder,
        where: (condition: any) => {
          rows = rows.filter((row) => matches(row, condition));
          return builder;
        },
        mapRows: (selected: any[]) => selected.map((row) => {
          if (!projection) return row;
          return Object.fromEntries(Object.entries(projection).map(([key, column]: any) => [key, row[column.name]]));
        }),
        limit: async (count: number) => builder.mapRows(rows.slice(0, count)),
        then: (resolve: (value: any) => unknown, reject: (reason: unknown) => unknown) =>
          Promise.resolve(builder.mapRows(rows)).then(resolve, reject),
      };
      return builder;
    }),
    insert: vi.fn(() => ({
      values: (values: any) => ({
        returning: async () => {
          const run = {
            id: `oneoff-run-${state.nextId++}`,
            startedAt: new Date(),
            completedAt: null,
            confirmationUsedAt: null,
            cancelRequested: false,
            ...values,
          };
          state.runs.push(run);
          return [run];
        },
      }),
    })),
    update: vi.fn(() => ({
      set: (values: any) => {
        const builder: any = {
          returning: async (projection: any) => {
            const updated = builder.updated;
            return updated.map((row: any) => Object.fromEntries(
              Object.entries(projection).map(([key, column]: any) => [key, row[column.name]]),
            ));
          },
        };
        builder.where = (condition: any) => {
          builder.condition = condition;
          state.beforeUpdate?.(values, condition);
          const updated = state.runs.filter((row) => matches(row, condition));
          builder.updated = updated;
          updated.forEach((row) => Object.assign(row, values));
          return builder;
        };
        return builder;
      },
    })),
  };
  function matches(row: any, condition: any): boolean {
    if (!condition) return true;
    if (condition.kind === "and") return condition.parts.every((part: any) => matches(row, part));
    if (condition.kind === "or") return condition.parts.some((part: any) => matches(row, part));
    const actual = row[condition.column.name];
    if (condition.kind === "eq") return actual === condition.value;
    if (condition.kind === "isNull") return actual == null;
    if (condition.kind === "lt") return actual != null && actual < condition.value;
    return false;
  }
  return { state, db, columns };
});

vi.mock("@shared/schema", () => ({ jobRuns: columns }));
vi.mock("../../server/storage/db", () => ({ db }));
vi.mock("../../server/storage/transaction-context", () => ({
  getClient: () => db,
  runInTransaction: (fn: () => unknown) => fn(),
  runOutsideTransaction: (fn: () => unknown) => fn(),
}));
vi.mock("../../server/middleware/request-context", () => ({
  requestContext: { run: (_context: unknown, fn: () => unknown) => fn() },
}));
vi.mock("drizzle-orm", () => ({
  and: (...parts: any[]) => ({ kind: "and", parts }),
  or: (...parts: any[]) => ({ kind: "or", parts }),
  eq: (column: any, value: any) => ({ kind: "eq", column, value }),
  isNull: (column: any) => ({ kind: "isNull", column }),
  lt: (column: any, value: any) => ({ kind: "lt", column, value }),
  sql: Object.assign((strings: TemplateStringsArray, ...values: any[]) => ({ strings, values }), {
    raw: (value: string) => value,
  }),
}));

import {
  cancelOneoff,
  interruptStaleOneoffRuns,
  oneoffActiveRun,
  preflightOneoff,
  startOneoff,
  OneoffRefusal,
} from "../../server/services/oneoff-runner";
import type { OneoffPlugin } from "../../server/plugins/system/oneoff/types";

const config = { id: "config-oneoff-test", pluginId: "test-plugin", pluginKind: "oneoff", enabled: true } as any;
const waitFor = async (predicate: () => boolean) => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Timed out waiting for Oneoff run state");
};

function plugin(overrides: Partial<OneoffPlugin> = {}): OneoffPlugin {
  return {
    metadata: { id: "test-plugin", name: "Test", description: "Test", requiredPolicy: "admin" } as any,
    actions: [{
      id: "inspect",
      label: "Inspect",
      preflight: async () => ({ message: "Ready" }),
      execute: async () => ({ ok: true }),
    }],
    status: async () => ({ tableExists: false, rowCount: 0 }),
    ...overrides,
  };
}

beforeEach(() => {
  state.runs.length = 0;
  state.lockCalls.length = 0;
  state.nextId = 1;
  state.beforeUpdate = undefined;
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Oneoff runner authorization and lifecycle", () => {
  it("only provides direct database access to actions that opt in", async () => {
    const observed: Array<{ phase: string; database: unknown }> = [];
    const actions = [
      {
        id: "no-db",
        label: "No DB",
        preflight: async (context: any) => {
          observed.push({ phase: "preflight", database: context.db });
          return { message: "Ready" };
        },
        execute: async (context: any) => {
          observed.push({ phase: "execute", database: context.db });
        },
      },
      {
        id: "with-db",
        label: "With DB",
        preflightDatabaseAccess: "read-write" as const,
        executeDatabaseAccess: "read-write" as const,
        preflight: async (context: any) => {
          observed.push({ phase: "preflight", database: context.db });
          return { message: "Ready" };
        },
        execute: async (context: any) => {
          observed.push({ phase: "execute", database: context.db });
        },
      },
    ];
    for (const action of actions) {
      const checked = await preflightOneoff(config, plugin({ actions }), action.id, {}, "actor");
      await startOneoff(config, plugin({ actions }), action.id, {}, checked.confirmationToken, "actor");
      await waitFor(() => state.runs.at(-1)?.status !== "running");
    }
    expect(observed.map(({ phase, database }) => [phase, database === db])).toEqual([
      ["preflight", false], ["execute", false], ["preflight", true], ["execute", true],
    ]);
  });

  it("binds confirmations to config, action, input, and actor, and consumes them once", async () => {
    const registered = plugin();
    const approved = await preflightOneoff(config, registered, "inspect", { key: "value" }, "actor-1");
    await expect(startOneoff(config, registered, "inspect", { key: "other" }, approved.confirmationToken, "actor-1"))
      .rejects.toMatchObject({ statusCode: 409 });
    await expect(startOneoff(config, registered, "inspect", { key: "value" }, approved.confirmationToken, "actor-2"))
      .rejects.toMatchObject({ statusCode: 409 });
    await expect(startOneoff({ ...config, id: "another-config" }, registered, "inspect", { key: "value" }, approved.confirmationToken, "actor-1"))
      .rejects.toMatchObject({ statusCode: 409 });
    await startOneoff(config, registered, "inspect", { key: "value" }, approved.confirmationToken, "actor-1");
    await expect(startOneoff(config, registered, "inspect", { key: "value" }, approved.confirmationToken, "actor-1"))
      .rejects.toMatchObject({ statusCode: 409 });
    expect(state.lockCalls.length).toBeGreaterThan(0);
  });

  it("invalidates an older approval when a second preflight has the same row count", async () => {
    const registered = plugin({
      actions: [{
        id: "inspect",
        label: "Inspect",
        preflight: async () => ({ message: "Five rows found", rowCount: 5 }),
        execute: async () => ({ ok: true }),
      }],
    });
    const first = await preflightOneoff(config, registered, "inspect", {}, "actor");
    const second = await preflightOneoff(config, registered, "inspect", {}, "actor");
    expect(first.rowCount).toBe(second.rowCount);
    await expect(startOneoff(config, registered, "inspect", {}, first.confirmationToken, "actor"))
      .rejects.toMatchObject({ statusCode: 409 });
    await startOneoff(config, registered, "inspect", {}, second.confirmationToken, "actor");
    await waitFor(() => state.runs.at(-1)?.status !== "running");
    expect(state.runs.at(-1)?.status).toBe("success");
  });

  it("does not invoke an action cancelled before its scheduled execution starts", async () => {
    const execute = vi.fn(async () => ({ shouldNotRun: true }));
    const registered = plugin({
      actions: [{
        id: "inspect",
        label: "Inspect",
        preflight: async () => ({ message: "Ready" }),
        execute,
      }],
    });
    const approved = await preflightOneoff(config, registered, "inspect", {}, "actor");
    let scheduled: (() => void) | undefined;
    const setImmediateSpy = vi.spyOn(globalThis, "setImmediate").mockImplementation(
      ((callback: (...args: any[]) => void, ...args: any[]) => {
        scheduled = () => callback(...args);
        return {} as NodeJS.Immediate;
      }) as typeof setImmediate,
    );
    try {
      const run = await startOneoff(config, registered, "inspect", {}, approved.confirmationToken, "actor");
      await cancelOneoff(run);
      expect(state.runs.find((item) => item.id === run.id)?.cancelRequested).toBe(true);
      expect(scheduled).toBeDefined();
      scheduled!();
      await waitFor(() => state.runs.find((item) => item.id === run.id)?.status !== "running");
      expect(execute).not.toHaveBeenCalled();
      expect(state.runs.find((item) => item.id === run.id)?.status).toBe("cancelled");
    } finally {
      setImmediateSpy.mockRestore();
    }
  });

  it("finishes cancelled when cancellation wins between action return and success compare-and-swap", async () => {
    const execute = vi.fn(async () => ({ ok: true }));
    const registered = plugin({
      actions: [{
        id: "inspect",
        label: "Inspect",
        preflight: async () => ({ message: "Ready" }),
        execute,
      }],
    });
    const approved = await preflightOneoff(config, registered, "inspect", {}, "actor");
    const run = await startOneoff(config, registered, "inspect", {}, approved.confirmationToken, "actor");
    state.beforeUpdate = (values, condition) => {
      if (values.status === "success" && condition?.kind === "and" &&
          condition.parts.some((part: any) =>
            part.kind === "eq" && part.column.name === "cancelRequested" && part.value === false)) {
        state.beforeUpdate = undefined;
        const current = state.runs.find((item) => item.id === run.id);
        if (current) current.cancelRequested = true;
      }
    };
    await waitFor(() => state.runs.find((item) => item.id === run.id)?.status !== "running");
    expect(execute).toHaveBeenCalledOnce();
    expect(state.runs.find((item) => item.id === run.id)).toMatchObject({
      status: "cancelled",
      cancelRequested: true,
    });
  });

  it("refuses cancellation when success has already won", async () => {
    const registered = plugin();
    const approved = await preflightOneoff(config, registered, "inspect", {}, "actor");
    const run = await startOneoff(config, registered, "inspect", {}, approved.confirmationToken, "actor");
    await waitFor(() => state.runs.find((item) => item.id === run.id)?.status !== "running");
    expect(state.runs.find((item) => item.id === run.id)?.status).toBe("success");
    await expect(cancelOneoff(run)).rejects.toMatchObject({ statusCode: 409 });
  });

  it.each([
    ["row count", { tableExists: true, rowCount: 5 }, { tableExists: true, rowCount: 4 }],
    ["table existence", { tableExists: true, rowCount: 5 }, { tableExists: false, rowCount: 0 }],
  ])("rejects destructive confirmation when %s changes after preflight", async (_change, before, after) => {
    const status = vi.fn()
      .mockResolvedValueOnce(before)
      .mockResolvedValue(after);
    const execute = vi.fn(async () => ({ dropped: true }));
    const registered = plugin({
      actions: [{
        id: "cleanup",
        label: "Cleanup",
        destructive: true,
        preflight: async () => ({ message: "Drop scratch table?", rowCount: before.rowCount }),
        execute,
      }],
      status,
    });
    const approved = await preflightOneoff(config, registered, "cleanup", {}, "actor");
    expect(approved.rowCount).toBe(before.rowCount);
    await expect(startOneoff(config, registered, "cleanup", {}, approved.confirmationToken, "actor"))
      .rejects.toMatchObject({ statusCode: 409, message: "The table changed since preflight. Review a new confirmation." });
    expect(execute).not.toHaveBeenCalled();
  });

  it("keeps a long-running preflight alive with periodic heartbeats", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-01T00:00:00.000Z"));
    let entered!: () => void;
    let release!: () => void;
    const hasEntered = new Promise<void>((resolve) => { entered = resolve; });
    const registered = plugin({
      actions: [{
        id: "inspect",
        label: "Inspect",
        preflight: async () => {
          entered();
          await new Promise<void>((resolve) => { release = resolve; });
          return { message: "Ready" };
        },
        execute: async () => ({ ok: true }),
      }],
    });
    const pending = preflightOneoff(config, registered, "inspect", {}, "actor");
    await hasEntered;
    const claim = state.runs[0];
    const initialHeartbeat = claim.heartbeatAt.getTime();
    try {
      await vi.advanceTimersByTimeAsync(65_000);
      expect(claim.heartbeatAt.getTime()).toBeGreaterThan(initialHeartbeat);
      await expect(preflightOneoff(config, registered, "inspect", {}, "second-actor"))
        .rejects.toMatchObject({ statusCode: 409, message: "Another run for this plugin is active" });
      expect(claim.status).toBe("running");
    } finally {
      release();
      await pending;
      vi.useRealTimers();
    }
  });

  it("accepts equivalent jsonb input after Postgres reorders object keys", async () => {
    const registered = plugin();
    const checked = await preflightOneoff(
      config, registered, "inspect", { z: { beta: 2, alpha: 1 }, a: 3 }, "actor",
    );
    const preflight = state.runs.find((run) => run.id === checked.runId);
    preflight.input = { input: { a: 3, z: { alpha: 1, beta: 2 } }, action: "inspect" };
    await startOneoff(
      config, registered, "inspect", { z: { beta: 2, alpha: 1 }, a: 3 },
      checked.confirmationToken, "actor",
    );
    await waitFor(() => state.runs.at(-1)?.status !== "running");
    expect(state.runs.at(-1)?.status).toBe("success");
  });

  it("serializes claims and refuses another active plugin run", async () => {
    state.runs.push({
      id: "active-run", pluginKind: "oneoff", pluginId: "test-plugin", status: "running",
      startedAt: new Date(), heartbeatAt: new Date(),
    });
    await expect(preflightOneoff(config, plugin(), "inspect", {}, "actor"))
      .rejects.toBeInstanceOf(OneoffRefusal);
    expect(state.lockCalls).toHaveLength(1);
  });

  it("persists a cancellation request for a live run", async () => {
    const active = {
      id: "cancellable-run", pluginKind: "oneoff", pluginId: "test-plugin",
      status: "running", cancelRequested: false,
    };
    state.runs.push(active);
    await cancelOneoff(active as any);
    expect(active.cancelRequested).toBe(true);
    expect(active.status).toBe("running");
    await expect(cancelOneoff({ ...active, status: "success" } as any))
      .rejects.toMatchObject({ statusCode: 409 });
  });

  it("interrupts stale runs and sanitizes execution failures", async () => {
    const stale: any = {
      id: "stale-run", pluginKind: "oneoff", pluginId: "test-plugin", status: "running",
      startedAt: new Date(Date.now() - 120_000), heartbeatAt: new Date(Date.now() - 120_000),
    };
    state.runs.push(stale);
    await interruptStaleOneoffRuns();
    expect(stale.status).toBe("interrupted");
    expect(String(stale.error)).not.toContain("stack");

    const registered = plugin({
      actions: [{
        id: "inspect",
        label: "Inspect",
        preflight: async () => { throw new Error("database password/private-value"); },
        execute: async () => ({ ok: true }),
      }],
    });
    await expect(preflightOneoff(config, registered, "inspect", {}, "actor"))
      .rejects.toMatchObject({ statusCode: 400, message: expect.not.stringContaining("private-value") });
    const failed = state.runs.find((item) => item.operation === "preflight" && item.status === "error")!;
    expect(failed.error).toContain("Preflight failed");
    expect(failed.error).not.toContain("private-value");
    expect(await oneoffActiveRun("test-plugin")).toBeUndefined();
  });
});