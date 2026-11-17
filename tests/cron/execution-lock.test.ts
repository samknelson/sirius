import { EventEmitter } from "node:events";
import type { PoolClient } from "pg";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CronExecutionLock, cronExecutionKey } from "../../server/cron/execution-lock";

const clients: Array<ReturnType<typeof client>> = [];
function client() {
  return Object.assign(new EventEmitter(), {
    query: vi.fn(async () => ({ rows: [{ acquired: true }] })),
    release: vi.fn(),
  });
}
function setup() {
  const c = client(); clients.push(c);
  return { c, connect: vi.fn(async () => c as unknown as PoolClient) };
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => { clients.splice(0).forEach(c => c.emit("end")); vi.useRealTimers(); });

it("keys only by plugin identity, not configuration, mode or process", () => {
  expect(cronExecutionKey("one")).toEqual(cronExecutionKey("one"));
  expect(cronExecutionKey("one")).not.toEqual(cronExecutionKey("two"));
});
it("returns contention without a retry and closes the connection", async () => {
  const { c, connect } = setup();
  c.query.mockResolvedValue({ rows: [{ acquired: false }] });
  expect(await CronExecutionLock.acquire("job", connect)).toBeNull();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(connect).toHaveBeenCalledOnce();
  expect(c.release).toHaveBeenCalledExactlyOnceWith(true);
});
it("probes and closes exactly once on success", async () => {
  const { c, connect } = setup();
  const lock = (await CronExecutionLock.acquire("job", connect))!;
  await vi.advanceTimersByTimeAsync(5_000);
  expect(c.query).toHaveBeenLastCalledWith("SELECT 1");
  lock.close(); lock.close();
  await vi.advanceTimersByTimeAsync(20_000);
  expect(c.query).toHaveBeenCalledTimes(2);
  expect(c.release).toHaveBeenCalledExactlyOnceWith(true);
});
it("withdraws ownership immediately without reacquiring on connection error", async () => {
  const { c, connect } = setup();
  const lock = (await CronExecutionLock.acquire("job", connect))!;
  const loss = expect(lock.lost).rejects.toThrow("results are uncertain");
  c.emit("error", new Error("disconnected"));
  await loss;
  expect(() => lock.assertOwned()).toThrow("lock lost");
  await vi.advanceTimersByTimeAsync(60_000);
  expect(connect).toHaveBeenCalledOnce();
  expect(c.release).toHaveBeenCalledOnce();
});
it("fails closed when acquisition times out", async () => {
  const { c, connect } = setup();
  c.query.mockImplementation(() => new Promise(() => {}));
  const attempt = expect(CronExecutionLock.acquire("job", connect)).rejects.toThrow("timed out");
  await vi.advanceTimersByTimeAsync(5_000);
  await attempt;
  expect(c.release).toHaveBeenCalledExactlyOnceWith(true);
});
it("destroys a late checkout after its deadline", async () => {
  const { c } = setup();
  let finish!: (c: PoolClient) => void;
  const attempt = expect(CronExecutionLock.acquire("job", () => new Promise(resolve => { finish = resolve; }))).rejects.toThrow("timed out");
  await vi.advanceTimersByTimeAsync(15_000);
  await attempt;
  finish(c as unknown as PoolClient);
  await Promise.resolve();
  expect(c.release).toHaveBeenCalledExactlyOnceWith(true);
  expect(c.query).not.toHaveBeenCalled();
});
it("reports a probe timeout as lost ownership", async () => {
  const { c, connect } = setup();
  const lock = (await CronExecutionLock.acquire("job", connect))!;
  c.query.mockImplementation(() => new Promise(() => {}));
  const loss = expect(lock.lost).rejects.toThrow("lock lost");
  await vi.advanceTimersByTimeAsync(10_000);
  await loss;
  expect(c.release).toHaveBeenCalledOnce();
});
