import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("../../server/storage/db", () => ({ pool: {} }));
import { CronOwnership, CRON_RETRY_MAX_MS } from "../../server/cron/ownership";
import type { CronExecutionLock } from "../../server/cron/execution-lock";
const owners: CronOwnership[] = [];
const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
function setup() {
  let lose!: (error: Error) => void;
  const lock = {
    assertOwned: vi.fn(), close: vi.fn(async () => {}),
    lost: new Promise<never>((_, reject) => { lose = reject; }),
  };
  const callbacks = {
    acquire: vi.fn(async (): Promise<CronExecutionLock | null> => lock as unknown as CronExecutionLock),
    acquired: vi.fn(async (_token: number) => {}), lost: vi.fn(), report: vi.fn(),
  };
  const owner = new CronOwnership(callbacks); owners.push(owner);
  return { owner, lock, lose, ...callbacks };
}
beforeEach(() => vi.useFakeTimers());
afterEach(async () => { await Promise.all(owners.splice(0).map(o => o.stop())); vi.useRealTimers(); });
it("revokes generation and callbacks on lost lease", async () => {
  const s = setup(); s.owner.start(); await settle();
  const token = s.owner.token!;
  s.lose(new Error("lost")); await settle();
  expect(s.owner.owns(token)).toBe(false); expect(s.lost).toHaveBeenCalledOnce();
});
it("retries contention quietly and stops retries on shutdown", async () => {
  const s = setup(); s.acquire.mockResolvedValue(null);
  s.owner.start(); await settle();
  await vi.advanceTimersByTimeAsync(CRON_RETRY_MAX_MS * 3);
  expect(s.acquire.mock.calls.length).toBeGreaterThan(2);
  expect(s.report).toHaveBeenCalledExactlyOnceWith("standby", undefined);
  await s.owner.stop(); const count = s.acquire.mock.calls.length;
  await vi.advanceTimersByTimeAsync(20000);
  expect(s.acquire).toHaveBeenCalledTimes(count);
});
it("releases a late acquisition after stop without publishing it", async () => {
  const s = setup(); let finish!: (lock: CronExecutionLock) => void;
  s.acquire.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  s.owner.start(); await s.owner.stop();
  finish(s.lock as unknown as CronExecutionLock); await settle();
  expect(s.acquired).not.toHaveBeenCalled(); expect(s.lock.close).toHaveBeenCalledOnce();
});
it("does not let a pre-stop attempt publish after restart", async () => {
  const s = setup(); let finish!: (lock: CronExecutionLock) => void;
  s.acquire.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  s.owner.start(); await s.owner.stop(); s.owner.start();
  finish(s.lock as unknown as CronExecutionLock); await settle();
  expect(s.acquired).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(10000);
  expect(s.acquired).toHaveBeenCalledOnce();
});
it("withdraws when configuration loading fails and retries", async () => {
  const s = setup(); s.acquired.mockRejectedValueOnce(new Error("snapshot"));
  s.owner.start(); await settle();
  expect(s.owner.token).toBeUndefined(); expect(s.lock.close).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(10000);
  expect(s.acquired).toHaveBeenCalledTimes(2);
});
