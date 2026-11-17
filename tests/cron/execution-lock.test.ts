import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PoolClient } from "pg";
vi.mock("../../server/storage/db", () => ({ pool: {} }));
import { CronExecutionLock, type SemaphoreStore } from "../../server/cron/execution-lock";
const locks: CronExecutionLock[] = [];
function store() {
  return {
    claim: vi.fn(async () => true), renew: vi.fn(async () => true),
    release: vi.fn(async () => {}),
    guarded: async <T>(_id: unknown, work: (client: PoolClient) => Promise<T>) => work({} as PoolClient),
  } satisfies SemaphoreStore;
}
beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] }));
afterEach(async () => { await Promise.all(locks.splice(0).map(l => l.close())); vi.useRealTimers(); });
async function acquire(s = store()) {
  const lock = (await CronExecutionLock.acquire("test", s))!;
  locks.push(lock);
  return lock;
}
it("uses full resource names, boot ownership and new tokens for each acquisition", async () => {
  const s = store();
  await acquire(s); await acquire(s);
  const calls = s.claim.mock.calls as unknown as [{ key: string; owner: string; token: string }][];
  expect(calls[0][0].key).toBe("cron:execution:test");
  expect(calls[0][0].owner).toBe(calls[1][0].owner);
  expect(calls[0][0].token).not.toBe(calls[1][0].token);
});
it("does not retry a contested execution", async () => {
  const s = store(); s.claim.mockResolvedValue(false);
  expect(await CronExecutionLock.acquire("test", s)).toBeNull();
  await vi.advanceTimersByTimeAsync(60000);
  expect(s.claim).toHaveBeenCalledOnce();
});
it("renews and releases with the same identity", async () => {
  const s = store(); const lock = await acquire(s);
  await vi.advanceTimersByTimeAsync(10000);
  expect(s.renew).toHaveBeenCalledTimes(2);
  await lock.close();
  expect(s.release.mock.calls[0]).toEqual(s.claim.mock.calls[0]);
  await vi.advanceTimersByTimeAsync(10000);
  expect(s.renew).toHaveBeenCalledTimes(2);
});
it("loses authority on renewal rejection without reacquiring or releasing early", async () => {
  const s = store(); const lock = await acquire(s);
  s.renew.mockRejectedValue(new Error("network"));
  const lost = expect(lock.lost).rejects.toThrow("ownership lost");
  await vi.advanceTimersByTimeAsync(5000); await lost;
  expect(() => lock.assertOwned()).toThrow();
  expect(s.claim).toHaveBeenCalledOnce(); expect(s.release).not.toHaveBeenCalled();
});
it("cannot revive local ownership after the previous deadline passes", async () => {
  const s = store(); const lock = await acquire(s);
  let finish!: (value: boolean) => void;
  s.renew.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  await vi.advanceTimersByTimeAsync(30001);
  finish(true);
  await Promise.resolve(); await Promise.resolve();
  expect(() => lock.assertOwned()).toThrow();
});
it("checks the local deadline even before the event-loop heartbeat executes", async () => {
  const s = store(); const lock = await acquire(s);
  vi.spyOn(performance, "now").mockReturnValue(31000);
  expect(() => lock.assertOwned()).toThrow();
  vi.restoreAllMocks();
});
