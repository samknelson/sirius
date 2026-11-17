import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { getBootIdentity } from "../services/boot-identity";
import { semaphoreStorage, SemaphoreLost, SEMAPHORE_LEASE_MS, type SemaphoreIdentity } from "../storage/system/semaphores";

export { SemaphoreLost as CronExecutionLost };
export const EXECUTION_PROBE_MS = 5_000;
export const cronExecutionKey = (pluginId: string) => `cron:execution:${pluginId}`;
export type SemaphoreStore = typeof semaphoreStorage;

/** A token owns a lease, never a connection. An execution never reacquires. */
export class CronExecutionLock {
  private closed = false;
  private timer?: ReturnType<typeof setTimeout>;
  private validUntil: number;
  private rejectLoss!: (error: Error) => void;
  readonly lost = new Promise<never>((_, reject) => { this.rejectLoss = reject; });

  private constructor(
    private readonly identity: SemaphoreIdentity,
    private readonly store: SemaphoreStore,
    requestStarted: number,
  ) {
    this.validUntil = requestStarted + SEMAPHORE_LEASE_MS;
    void this.lost.catch(() => {});
    this.schedule();
  }

  static async acquire(pluginId: string, store = semaphoreStorage): Promise<CronExecutionLock | null> {
    return this.acquireKey(cronExecutionKey(pluginId), store);
  }
  static async acquireKey(key: string, store = semaphoreStorage): Promise<CronExecutionLock | null> {
    const identity = { key, owner: getBootIdentity().bootId, token: randomUUID() };
    const started = performance.now();
    if (!await store.claim(identity)) return null;
    const lock = new CronExecutionLock(identity, store, started);
    lock.assertOwned();
    return lock;
  }
  assertOwned(): void {
    if (this.closed || performance.now() >= this.validUntil) {
      this.lose();
      throw new SemaphoreLost();
    }
  }
  async whileOwned<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    this.assertOwned();
    try {
      const result = await this.store.guarded(this.identity, async client => {
        this.assertOwned();
        return work(client);
      });
      this.assertOwned();
      return result;
    } catch (error) {
      this.lose();
      throw error;
    }
  }
  private lose(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.rejectLoss(new SemaphoreLost());
    // Do not release uncertain live work early. Let its lease expire.
  }
  private schedule(): void {
    this.timer = setTimeout(() => { void this.renew(); }, EXECUTION_PROBE_MS);
    this.timer.unref();
  }
  private async renew(): Promise<void> {
    try {
      this.assertOwned();
      const started = performance.now();
      const previousDeadline = this.validUntil;
      const renewed = await this.store.renew(this.identity);
      if (this.closed) return;
      if (!renewed || performance.now() >= previousDeadline) throw new SemaphoreLost();
      this.validUntil = started + SEMAPHORE_LEASE_MS;
      this.assertOwned();
      this.schedule();
    } catch { this.lose(); }
  }
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    await this.store.release(this.identity).catch(() => {});
  }
}
