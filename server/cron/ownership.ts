import type { PoolClient, QueryResult } from "pg";

// One scheduler per database, across all api-user replicas. Separate namespace
// from the per-job locks; never change this key during a rolling deployment.
export const CRON_OWNER_LOCK = 0x43524f4e; // "CRON"
export const CRON_RETRY_MIN_MS = 5_000;
export const CRON_RETRY_MAX_MS = 10_000;
export const CRON_PROBE_MS = 5_000;
export const CRON_QUERY_TIMEOUT_MS = 5_000;

interface OwnershipOptions {
  connect: () => Promise<PoolClient>;
  acquired: (generation: number) => Promise<void>;
  lost: () => void;
  report: (event: "acquired" | "standby" | "lost" | "error", error?: unknown) => void;
}

/**
 * Session lock, not a lease: no takeover based on an old heartbeat. Probes
 * detect broken connections; a timed-out/uncertain session is destroyed.
 * This controls future scheduling ONLY, not already-running job effects.
 */
export class CronOwnership {
  private active = false;
  private generation = 0;
  private owner?: PoolClient;
  private timer?: ReturnType<typeof setTimeout>;
  private attempting = false;
  private probing = false;
  private state?: string;

  constructor(private readonly options: OwnershipOptions) {}

  get token(): number | undefined {
    return this.owner ? this.generation : undefined;
  }

  owns(token: number): boolean {
    return this.active && !!this.owner && this.generation === token;
  }

  start(): void {
    if (this.active) return;
    this.active = true;
    this.generation++;
    void this.attempt();
  }

  stop(): void {
    this.active = false;
    this.generation++;
    this.clearTimer();
    const client = this.owner;
    this.owner = undefined;
    this.options.lost();
    // Closing the session releases its advisory lock, without an unbounded
    // unlock query or a chance of returning a locked session to the pool.
    client?.release(true);
    this.state = undefined;
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private retry(): void {
    if (!this.active || this.owner || this.timer) return;
    const delay = CRON_RETRY_MIN_MS +
      Math.floor(Math.random() * (CRON_RETRY_MAX_MS - CRON_RETRY_MIN_MS + 1));
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.attempt();
    }, delay);
    this.timer.unref();
  }

  private report(event: "acquired" | "standby" | "lost" | "error", error?: unknown): void {
    // Contention is normal. Log transitions, not every retry.
    if (this.state !== event) this.options.report(event, error);
    this.state = event;
  }

  private withdraw(client: PoolClient, error?: unknown): void {
    if (this.owner !== client) return;
    this.owner = undefined;
    this.generation++;
    this.clearTimer();
    this.options.lost(); // revoke callbacks before releasing the connection
    client.release(true);
    this.report("lost", error);
    this.retry();
  }

  private scheduleProbe(client: PoolClient): void {
    if (this.owner !== client || !this.active) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.probe(client);
    }, CRON_PROBE_MS);
    this.timer.unref();
  }

  private async query(client: PoolClient, text: string, values?: number[]): Promise<QueryResult> {
    // Own the deadline so both pg and Neon behave identically. Every caller
    // destroys the session after a timeout; abandoning just the promise would
    // leave a possibly locked session alive.
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        client.query(text, values),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => reject(new Error("Cron ownership database query timed out")), CRON_QUERY_TIMEOUT_MS);
          timeout.unref();
        }),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  private async probe(client: PoolClient): Promise<void> {
    if (this.owner !== client || this.probing) return;
    this.probing = true;
    try {
      await this.query(client, "SELECT 1");
    } catch (error) {
      this.withdraw(client, error);
    } finally {
      this.probing = false;
      this.scheduleProbe(client);
    }
  }

  private async attempt(): Promise<void> {
    if (!this.active || this.owner || this.attempting) return;
    this.attempting = true;
    const generation = this.generation;
    let client: PoolClient | undefined;
    let handedOff = false;
    let broken = false;
    try {
      client = await this.options.connect();
      const candidate = client;
      // Keep an error listener until this destroyed client is gone. A second
      // driver error after release must not become an uncaught exception.
      candidate.on("error", error => { broken = true; this.withdraw(candidate, error); });
      candidate.on("end", () => { broken = true; this.withdraw(candidate); });
      if (!this.active || generation !== this.generation) return;
      const result = await this.query(candidate, "SELECT pg_try_advisory_lock($1) AS acquired", [CRON_OWNER_LOCK]);
      if (broken || !this.active || generation !== this.generation) return;
      if (!result.rows[0]?.acquired) {
        this.report("standby");
        return;
      }
      this.owner = candidate;
      handedOff = true;
      const token = ++this.generation;
      this.report("acquired");
      // Probe even while a fresh configuration read is in flight.
      this.scheduleProbe(candidate);
      // Do not let a slow/abandoned configuration read prevent this process
      // from retrying after loss. Its generation guards publication instead.
      void this.options.acquired(token).catch(error => this.withdraw(candidate, error));
    } catch (error) {
      if (this.active && generation === this.generation) this.report("error", error);
    } finally {
      if (client && !handedOff) client.release(true);
      this.attempting = false;
      this.retry();
    }
  }
}
