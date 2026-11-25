import { getBootIdentity } from "./boot/identity";
import { getEnvironmentVariable } from "../config/env-registry";
import { createProcessesStorage, type ProcessIdentity, type ProcessesStorage } from "../storage/system/processes";

/** Serialized observer. Never overlaps writes, never interprets freshness as ownership. */
export class ProcessReporter {
  private stopped = false;
  private started = false;
  private timer?: ReturnType<typeof setTimeout>;
  private pending: Promise<void> = Promise.resolve();
  private stopping?: Promise<void>;
  lastSuccess: Date | null = null;
  writeFailed = false;

  constructor(readonly identity: ProcessIdentity, private store: ProcessesStorage) {}

  start() {
    if (this.started || this.stopped) return;
    this.started = true;
    this.tick();
  }

  private tick() {
    if (this.stopped) return;
    this.pending = this.store.heartbeat(this.identity, () => !this.stopped).then(row => {
      if (row) this.lastSuccess = row.updatedTs;
      this.writeFailed = false;
    }).catch(() => {
      // No raw errors or environment payloads in observer telemetry.
      this.writeFailed = true;
    }).finally(() => {
      if (!this.stopped) {
        this.timer = setTimeout(() => this.tick(), this.writeFailed ? 10_000 : 60_000);
        this.timer.unref();
      }
    });
  }

  stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    this.stopped = true;
    clearTimeout(this.timer);
    const endedTs = new Date();
    const write = this.pending.then(async () => {
      for (let attempt = 0; attempt < 2; attempt++) {
        try { await this.store.end(this.identity, endedTs); return; }
        catch { this.writeFailed = true; }
      }
    });
    this.stopping = new Promise<void>(resolve => {
      const timer = setTimeout(resolve, 5_000);
      void write.finally(() => { clearTimeout(timer); resolve(); });
    });
    return this.stopping;
  }
}

let reporter: ProcessReporter | undefined;
export function startProcessReporter(roles: readonly string[]) {
  if (reporter) return;
  const boot = getBootIdentity();
  reporter = new ProcessReporter({
    id: boot.bootId, startedTs: new Date(boot.startedAt),
    name: getEnvironmentVariable("PROCESS_NAME")?.trim() || null,
    roles: [...roles],
  }, createProcessesStorage());
  reporter.start();
}
export function getLocalProcessReporter() { return reporter; }
export async function stopProcessReporter() { await reporter?.stop(); }
