import { createHash } from "node:crypto";
import type { PoolClient } from "pg";

export const EXECUTION_PROBE_MS = 5_000;
export const EXECUTION_QUERY_TIMEOUT_MS = 5_000;
const CHECKOUT_TIMEOUT_MS = 15_000;
// Two-int advisory keys are separate from the scheduler's single-bigint key.
const NAMESPACE = 0x43524a42; // CRJB
export const cronExecutionKey = (pluginId: string): [number, number] =>
  [NAMESPACE, createHash("sha256").update(pluginId).digest().readInt32BE(0)];

export class CronExecutionLost extends Error {
  constructor() {
    super("Cron execution lock lost. Work may still be finishing; results are uncertain. Nothing was automatically retried.");
  }
}

async function deadline<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([work, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Cron execution lock database operation timed out")), ms);
      timer.unref();
    })]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** A single execution owns a session; no retries, lease expiry, or reacquisition. */
export class CronExecutionLock {
  private closed = false;
  private failure?: CronExecutionLost;
  private timer?: ReturnType<typeof setTimeout>;
  private rejectLoss!: (error: Error) => void;
  readonly lost = new Promise<never>((_, reject) => { this.rejectLoss = reject; });

  private constructor(private readonly client: PoolClient) {
    // Loss may occur before the caller attaches its race.
    void this.lost.catch(() => {});
    client.on("error", () => this.lose());
    client.on("end", () => this.lose());
  }

  static async acquire(pluginId: string, connect: () => Promise<PoolClient>): Promise<CronExecutionLock | null> {
    let abandoned = false;
    const checkout = connect().then(client => {
      if (abandoned) client.release(true);
      return client;
    });
    let client: PoolClient;
    try { client = await deadline(checkout, CHECKOUT_TIMEOUT_MS); }
    catch (error) { abandoned = true; throw error; }
    const lock = new CronExecutionLock(client);
    try {
      const result = await deadline(
        client.query("SELECT pg_try_advisory_lock($1::integer, $2::integer) AS acquired", cronExecutionKey(pluginId)),
        EXECUTION_QUERY_TIMEOUT_MS,
      );
      lock.assertOwned();
      if (!result.rows[0]?.acquired) {
        lock.close();
        return null;
      }
      lock.scheduleProbe();
      return lock;
    } catch (error) {
      lock.close();
      throw error;
    }
  }

  assertOwned(): void {
    if (this.failure) throw this.failure;
    if (this.closed) throw new CronExecutionLost();
  }

  /** Recovery must write on the owning session, never an unrelated checkout. */
  async whileOwned<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    this.assertOwned();
    const result = await Promise.race([
      deadline(work(this.client), EXECUTION_QUERY_TIMEOUT_MS),
      this.lost,
    ]);
    this.assertOwned();
    return result;
  }

  private lose(): void {
    if (this.closed) return;
    this.failure = new CronExecutionLost();
    this.rejectLoss(this.failure);
    this.close();
  }

  private scheduleProbe(): void {
    if (this.closed) return;
    this.timer = setTimeout(() => { void this.probe(); }, EXECUTION_PROBE_MS);
    this.timer.unref();
  }

  private async probe(): Promise<void> {
    try {
      await deadline(this.client.query("SELECT 1"), EXECUTION_QUERY_TIMEOUT_MS);
    } catch {
      this.lose();
    } finally {
      this.scheduleProbe();
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    // Destroy rather than pool a session with a potentially retained lock.
    this.client.release(true);
  }
}
