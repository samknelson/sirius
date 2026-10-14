/**
 * Infrastructure coordination only: no code registries, auth TTL caches,
 * credentials or business-data caches are implicitly discovered or cleared.
 */
export const CONFIGURATION_POLL_INTERVAL_MS = 5_000;

export interface ConfigurationParticipant {
  id: string;
  label?: string;
  scopes: readonly string[];
  /** Explicit dependency edges, registration order is otherwise execution order. */
  after?: readonly string[];
  everyPoll?: boolean;
  /** Cheap synchronous invalidation runs before any active reload. */
  invalidate?: () => void;
  refresh?: () => Promise<void | string>;
}

export interface ConfigurationRefreshResult {
  id: string;
  label: string;
  ok: boolean;
  message: string;
  durationMs: number;
}

/**
 * One serialized refresh, with per-participant completion. A failed dependency
 * stays pending and blocks only its dependants. Successful siblings aren't
 * repeatedly reloaded while retrying it. String revisions avoid bigint rounding.
 */
export class ConfigurationCoherency {
  private participants: ConfigurationParticipant[] = [];
  private completed = new Map<string, string>();
  private flight?: Promise<ConfigurationRefreshResult[]>;
  private timer?: ReturnType<typeof setInterval>;
  private requested = false;

  constructor(
    private readRevisions: () => Promise<Record<string, string>>,
    private outsideTransaction: <T>(fn: () => T) => T,
    private reportFailure: (error: unknown) => void,
  ) {}

  register(participant: ConfigurationParticipant): void {
    if (this.participants.some(p => p.id === participant.id)) throw new Error(`Duplicate configuration participant: ${participant.id}`);
    for (const id of participant.after ?? []) {
      if (!this.participants.some(p => p.id === id)) throw new Error(`Configuration dependency must register first: ${id}`);
    }
    this.participants.push(participant);
  }

  async poll(): Promise<ConfigurationRefreshResult[]> {
    if (this.flight) return this.flight;
    const work = this.outsideTransaction(async () => {
      const revisions = await this.readRevisions();
      const keys = new Map(this.participants.map(p => [
        p.id, JSON.stringify([revisions.global ?? "0", ...p.scopes.map(s => revisions[s] ?? "0")]),
      ]));
      const pending = this.participants.filter(p => p.everyPoll || this.completed.get(p.id) !== keys.get(p.id));
      // Drop all lazy snapshots first, then active subsystems in dependency order.
      const invalidationFailures = new Map<string, unknown>();
      for (const p of pending) {
        try { p.invalidate?.(); }
        catch (error) { invalidationFailures.set(p.id, error); }
      }
      const failed = new Set<string>();
      const results: ConfigurationRefreshResult[] = [];
      for (const p of pending) {
        const started = Date.now();
        try {
          if (invalidationFailures.has(p.id)) throw invalidationFailures.get(p.id);
          if (p.after?.some(id => failed.has(id))) throw new Error("Configuration dependency refresh failed; retry pending");
          const message = await p.refresh?.();
          this.completed.set(p.id, keys.get(p.id)!);
          results.push({ id: p.id, label: p.label ?? p.id, ok: true, message: message ?? "Refreshed in this process.", durationMs: Date.now() - started });
        } catch (error) {
          failed.add(p.id);
          results.push({ id: p.id, label: p.label ?? p.id, ok: false, message: String(error), durationMs: Date.now() - started });
          this.reportFailure(error);
        }
      }
      return results;
    });
    this.flight = work;
    try {
      return await work;
    } finally {
      this.flight = undefined;
      if (this.requested) {
        this.requested = false;
        this.requestRefresh();
      }
    }
  }

  /** A committed admin request must not merely join a pre-commit poll. */
  async refreshCommitted(): Promise<ConfigurationRefreshResult[]> {
    if (this.flight) await this.flight;
    return this.poll();
  }

  /** Coalesce committed local writes; a write during a poll gets another pass. */
  requestRefresh(): void {
    if (this.flight) { this.requested = true; return; }
    void this.poll().catch(this.reportFailure);
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.requestRefresh(), CONFIGURATION_POLL_INTERVAL_MS);
    this.timer.unref();
    this.requestRefresh();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
}
