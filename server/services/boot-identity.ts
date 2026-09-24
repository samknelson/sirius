/**
 * Boot identity — a per-process identifier and start timestamp (Task #1258).
 *
 * The admin Restart page fires a restart, then polls `/health` until a
 * *different* process answers. "Different" needs something the old process
 * cannot also report, so every process mints a fresh random id at module
 * load and records when it started.
 *
 * PURE LEAF MODULE: only `node:crypto`. Both entry points import it before
 * the application exists (`server/production-entry.ts` registers `/health`
 * before app-init is even loaded), so it must never reach the logger, the
 * database, or the env registry.
 *
 * The value lives for the lifetime of the process and is deliberately NOT
 * persisted: a restarted process must not be able to reproduce it.
 */
import { randomUUID } from "node:crypto";

export interface BootIdentity {
  /** Random per-process id. Changes on every process start. */
  bootId: string;
  /** ISO timestamp of when this process started. */
  startedAt: string;
}

const bootIdentity: BootIdentity = {
  bootId: randomUUID(),
  startedAt: new Date().toISOString(),
};

export function getBootIdentity(): BootIdentity {
  return bootIdentity;
}
