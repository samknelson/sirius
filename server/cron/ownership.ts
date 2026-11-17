import { CronExecutionLock } from "./execution-lock";

export const CRON_RETRY_MIN_MS = 5_000;
export const CRON_RETRY_MAX_MS = 10_000;
interface OwnershipOptions {
  acquire?: () => Promise<CronExecutionLock | null>;
  acquired: (generation: number) => Promise<void>;
  lost: () => void;
  report: (event: "acquired" | "standby" | "lost" | "error", error?: unknown) => void;
}

export class CronOwnership {
  private active = false;
  private generation = 0;
  private owner?: CronExecutionLock;
  private timer?: ReturnType<typeof setTimeout>;
  private attempting = false;
  private state?: string;
  constructor(private readonly options: OwnershipOptions) {}
  get token(): number | undefined {
    return this.owns(this.generation) ? this.generation : undefined;
  }
  owns(token: number): boolean {
    if (!this.active || !this.owner || token !== this.generation) return false;
    try { this.owner.assertOwned(); return true; }
    catch { this.withdraw(this.owner); return false; }
  }
  start(): void {
    if (this.active) return;
    this.active = true;
    this.generation++;
    void this.attempt();
  }
  async stop(): Promise<void> {
    this.active = false;
    this.generation++;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    const owner = this.owner;
    this.owner = undefined;
    this.options.lost();
    await owner?.close();
    this.state = undefined;
  }
  private retry(): void {
    if (!this.active || this.owner || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.attempt();
    }, CRON_RETRY_MIN_MS + Math.random() * (CRON_RETRY_MAX_MS - CRON_RETRY_MIN_MS));
    this.timer.unref();
  }
  private report(event: "acquired" | "standby" | "lost" | "error", error?: unknown): void {
    if (event !== this.state) this.options.report(event, error);
    this.state = event;
  }
  private withdraw(owner: CronExecutionLock, error?: unknown): void {
    if (this.owner !== owner) return;
    this.owner = undefined;
    this.generation++;
    this.options.lost();
    void owner.close();
    this.report("lost", error);
    this.retry();
  }
  private async attempt(): Promise<void> {
    if (!this.active || this.owner || this.attempting) return;
    this.attempting = true;
    const generation = this.generation;
    try {
      const owner = await (this.options.acquire?.() ?? CronExecutionLock.acquireKey("cron:scheduler"));
      if (!this.active || generation !== this.generation) { await owner?.close(); return; }
      if (!owner) { this.report("standby"); return; }
      owner.assertOwned();
      this.owner = owner;
      const token = ++this.generation;
      void owner.lost.catch(error => this.withdraw(owner, error));
      this.report("acquired");
      void this.options.acquired(token).catch(error => this.withdraw(owner, error));
    } catch (error) {
      if (this.active && generation === this.generation) this.report("error", error);
    } finally {
      this.attempting = false;
      this.retry();
    }
  }
}
