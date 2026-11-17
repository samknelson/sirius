import { beforeEach, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/pg-proxy";
const state = vi.hoisted(() => ({ client: undefined as unknown, exception: vi.fn() }));
vi.mock("../../server/storage/transaction-context", () => ({
  getClient: () => state.client,
  runOutsideTransaction: (fn: () => unknown) => fn(),
  runInTransaction: (fn: () => unknown) => fn(),
}));
vi.mock("../../server/storage/maintenance", () => ({
  allowInMaintenanceMode: (fn: () => unknown) => { state.exception(); return fn(); },
}));
import { createProcessesStorage } from "../../server/storage/system/processes";
const queries: { sql: string; params: unknown[] }[] = [];
beforeEach(() => {
  queries.length = 0;
  state.exception.mockClear();
  state.client = drizzle(async (sql, params) => {
    queries.push({ sql, params });
    return { rows: sql.includes("count(") ? [[0]] : [] };
  });
});
const identity = { id: "boot", name: null, roles: ["api-user"], startedTs: new Date(0) };
it("guards both lifecycle upserts against ended rows and scopes the maintenance exception", async () => {
  const store = createProcessesStorage();
  await store.heartbeat(identity);
  await store.end(identity, new Date());
  const writes = queries.filter(q => q.sql.startsWith("insert"));
  expect(writes).toHaveLength(2);
  for (const write of writes) expect(write.sql).toContain('where "processes"."ended_ts" is null');
  expect(writes[0].sql).not.toMatch(/set "ended_ts"/);
  expect(state.exception).toHaveBeenCalledTimes(2);
  await store.deleteExpired("boot", new Date());
  expect(state.exception).toHaveBeenCalledTimes(2);
  expect(queries.at(-1)?.sql).toMatch(/delete.*"id" = .*COALESCE.*"ended_ts".*"updated_ts".*</);
});
it("does not write a heartbeat whose connection was delivered after stop", async () => {
  await createProcessesStorage().heartbeat(identity, () => false);
  expect(queries.some(q => q.sql.startsWith("insert"))).toBe(false);
});
it("uses matching unended filters and deterministic bounded pagination without JSON data", async () => {
  await createProcessesStorage().getPage({ page: 3, pageSize: 10 });
  const reads = queries.filter(q => q.sql.startsWith("select"));
  expect(reads).toHaveLength(2);
  for (const read of reads) expect(read.sql).toContain('where "processes"."ended_ts" is null');
  expect(reads[1].sql).toContain('order by "processes"."started_ts" desc, "processes"."id" desc');
  expect(reads[1].params).toEqual([10, 20]);
  expect(reads[1].sql).not.toContain('"data"');
});
