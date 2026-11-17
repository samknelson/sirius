import { EventEmitter } from "node:events";
import type { PoolClient } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CronOwnership, CRON_QUERY_TIMEOUT_MS, CRON_PROBE_MS, CRON_RETRY_MAX_MS } from "../../server/cron/ownership";

// Duplicate automatic starts have occurred in production. These cheap tests
// protect authority withdrawal and stop/restart races, not PostgreSQL itself.
class Client extends EventEmitter {
  query = vi.fn(async () => ({ rows: [{ acquired: true }] }));
  release = vi.fn();
  asPoolClient() { return this as unknown as PoolClient; }
}
const owners: CronOwnership[] = [];
function setup(client = new Client()) {
  const callbacks = {
    connect: vi.fn(async () => client.asPoolClient()),
    acquired: vi.fn(async (_token: number) => {}),
    lost: vi.fn(),
    report: vi.fn(),
  };
  const owner = new CronOwnership(callbacks);
  owners.push(owner);
  return { owner, client, ...callbacks };
}
const settle = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  owners.splice(0).forEach(owner => owner.stop());
  vi.useRealTimers();
});

describe("database-backed cron ownership", () => {
  it("only grants authority after a successful lock and revokes it synchronously on loss", async () => {
    const { owner, client, acquired, lost } = setup();
    owner.start();
    expect(owner.token).toBeUndefined();
    await settle();
    const token = owner.token!;
    expect(owner.owns(token)).toBe(true);
    expect(acquired).toHaveBeenCalledWith(token);
    client.emit("error", new Error("connection lost"));
    expect(owner.owns(token)).toBe(false);
    expect(lost).toHaveBeenCalledOnce();
    expect(client.release).toHaveBeenCalledExactlyOnceWith(true);
    client.emit("end");
    expect(client.release).toHaveBeenCalledOnce();
  });

  it("retries normal contention without granting authority or repeating standby logs", async () => {
    const { owner, client, acquired, report, connect } = setup();
    client.query.mockResolvedValue({ rows: [{ acquired: false }] });
    owner.start();
    await settle();
    await vi.advanceTimersByTimeAsync(CRON_RETRY_MAX_MS * 3);
    expect(connect.mock.calls.length).toBeGreaterThan(2);
    expect(acquired).not.toHaveBeenCalled();
    expect(report).toHaveBeenCalledExactlyOnceWith("standby", undefined);
    owner.stop();
    const count = connect.mock.calls.length;
    await vi.advanceTimersByTimeAsync(CRON_RETRY_MAX_MS * 2);
    expect(connect).toHaveBeenCalledTimes(count);
  });

  it("destroys a lock acquired after stop without publishing ownership", async () => {
    const { owner, client, acquired } = setup();
    let finish!: (value: { rows: { acquired: boolean }[] }) => void;
    client.query.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    owner.start();
    await settle();
    owner.stop();
    finish({ rows: [{ acquired: true }] });
    await settle();
    expect(acquired).not.toHaveBeenCalled();
    expect(client.release).toHaveBeenCalledExactlyOnceWith(true);
    expect(owner.token).toBeUndefined();
  });

  it("does not let a stopped attempt gain authority after restart", async () => {
    const { owner, client, acquired, connect } = setup();
    let finish!: (client: PoolClient) => void;
    connect.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    owner.start();
    owner.stop();
    owner.start();
    finish(client.asPoolClient());
    await settle();
    expect(acquired).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(CRON_RETRY_MAX_MS);
    expect(acquired).toHaveBeenCalledOnce();
  });

  it("withdraws authority and destroys the session when a probe times out", async () => {
    const { owner, client } = setup();
    owner.start();
    await settle();
    const token = owner.token!;
    client.query.mockImplementationOnce(() => new Promise(() => {}));
    await vi.advanceTimersByTimeAsync(CRON_PROBE_MS + CRON_QUERY_TIMEOUT_MS);
    expect(owner.owns(token)).toBe(false);
    expect(client.release).toHaveBeenCalledExactlyOnceWith(true);
  });

  it("destroys an uncertain session when lock acquisition times out", async () => {
    const { owner, client, acquired } = setup();
    client.query.mockImplementationOnce(() => new Promise(() => {}));
    owner.start();
    await settle();
    await vi.advanceTimersByTimeAsync(CRON_QUERY_TIMEOUT_MS);
    expect(acquired).not.toHaveBeenCalled();
    expect(client.release).toHaveBeenCalledExactlyOnceWith(true);
  });

  it("releases authority and retries when initial configuration loading fails", async () => {
    const { owner, acquired, client } = setup();
    acquired.mockRejectedValueOnce(new Error("snapshot unavailable"));
    owner.start();
    await settle();
    expect(owner.token).toBeUndefined();
    expect(client.release).toHaveBeenCalledExactlyOnceWith(true);
    await vi.advanceTimersByTimeAsync(CRON_RETRY_MAX_MS);
    expect(acquired).toHaveBeenCalledTimes(2);
    expect(owner.token).toBeDefined();
  });
});
