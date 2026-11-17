import { EventEmitter } from "node:events";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ connect: vi.fn() }));
vi.mock("../../server/storage/db", () => ({ pool: { connect: mocks.connect } }));
import { semaphoreStorage } from "../../server/storage/system/semaphores";
const id = { key: "cron:test", owner: "owner", token: "token" };
function client() {
  return Object.assign(new EventEmitter(), {
    query: vi.fn(async (_sql: string) => ({ rowCount: 1, rows: [{ key: id.key }] })),
    release: vi.fn(),
  });
}
beforeEach(() => { vi.useFakeTimers(); vi.resetAllMocks(); });
afterEach(() => vi.useRealTimers());
it("returns its connection after each operation without accumulating listeners", async () => {
  const c = client(); mocks.connect.mockResolvedValue(c);
  await semaphoreStorage.claim(id); await semaphoreStorage.renew(id); await semaphoreStorage.release(id);
  expect(c.release).toHaveBeenCalledTimes(3); expect(c.listenerCount("error")).toBe(0);
});
it("destroys a checkout that arrives after the operation timed out", async () => {
  const c = client(); let finish!: (c: unknown) => void;
  mocks.connect.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const result = expect(semaphoreStorage.claim(id)).rejects.toThrow("ownership lost");
  await vi.advanceTimersByTimeAsync(5000); await result;
  finish(c); await Promise.resolve(); await Promise.resolve();
  expect(c.release).toHaveBeenCalledExactlyOnceWith(true);
  expect(c.query).not.toHaveBeenCalled();
});
it("destroys an ambiguous operation and cannot commit it later", async () => {
  const c = client(); let finish!: (value: any) => void;
  c.query.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  mocks.connect.mockResolvedValue(c);
  const result = expect(semaphoreStorage.claim(id)).rejects.toThrow();
  await vi.advanceTimersByTimeAsync(5000); await result;
  finish({ rowCount: 1, rows: [] });
  for (let i = 0; i < 15; i++) await Promise.resolve();
  expect(c.release).toHaveBeenCalledExactlyOnceWith(true);
  expect(c.query.mock.calls.some(([sql]) => sql === "COMMIT")).toBe(false);
});
it("guards history before and after its write and rolls back on stale ownership", async () => {
  const c = client(); mocks.connect.mockResolvedValue(c);
  const write = vi.fn(async () => {
    c.query.mockResolvedValueOnce({ rowCount: 0, rows: [] });
  });
  await expect(semaphoreStorage.guarded(id, write)).rejects.toThrow();
  expect(write).toHaveBeenCalledOnce();
  expect(c.release).toHaveBeenCalledExactlyOnceWith(true);
});
