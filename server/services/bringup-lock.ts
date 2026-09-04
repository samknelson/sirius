/**
 * Cross-process serialization of schema bring-up (Task #1350).
 *
 * The deployed topology runs one image as TWO ECS services — a UI service and
 * an API service — against a single shared database, and a rollout restarts
 * both at the same instant. Each task runs the entire bring-up: classify,
 * bootstrap, core migrations, component migrations, drift gate. Nothing used
 * to serialize the two, so both could read the same pending version and both
 * start applying it. The loser either failed on objects the winner had
 * already created (permanent init-failed) or blocked on the winner's
 * Postgres locks and — with no timeouts anywhere on the boot path — waited
 * forever. Either way the task never became ready while the rollout reported
 * success. That was observed in UAT: the UI served the app, the API never
 * came up, and re-running the same deploy against the same database came up
 * clean, which is the signature of a race rather than a bad migration.
 *
 * TWO MECHANISMS, both required:
 *
 *   - a database-held advisory lock, so exactly one task does the work while
 *     the others wait (bounded — see `BRINGUP_LOCK_TIMEOUT_MS`);
 *   - a recorded outcome for the run, so a waiter can tell the difference
 *     between "the task ahead of me finished the job" and "the task ahead of
 *     me failed at it". Without that, a waiter that simply re-runs would
 *     reproduce the winner's failure and report it as its own.
 *
 * The record lives in one `variables` row rather than a table of its own: it
 * needs no schema change (and therefore no migration and no drift-gate
 * entry), and it is written by the very phase that would be creating that
 * table. It is a diagnostic breadcrumb, never an authority — the waiter still
 * re-reads the database's ACTUAL state before deciding it has nothing to do.
 */
import { getEnvironmentVariable } from "../config/env-registry";
import { logger } from "../logger";
import { storage } from "../storage";
import type { AdvisoryLockHandle } from "../storage/advisory-lock";
import { getBootIdentity } from "./boot-identity";
import type { BringUpPeerRun } from "./bringup-report";

/** Advisory lock name. Every booting process contends for this one name. */
export const BRINGUP_LOCK_NAME = "schema-bringup";

/** Variables row holding the most recent bring-up run's outcome. */
const BRINGUP_STATE_VARIABLE = "bringup_state";

const DEFAULT_LOCK_TIMEOUT_MS = 300_000; // 5 minutes
const DEFAULT_STEP_TIMEOUT_MS = 300_000; // 5 minutes

function msEnv(name: string, fallback: number, opts: { zeroDisables: boolean }): number {
  const raw = getEnvironmentVariable(name);
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number(raw);
  const floor = opts.zeroDisables ? 0 : 1;
  if (!Number.isFinite(parsed) || parsed < floor) {
    // Fall back loudly. Silently reinterpreting the value is how an operator
    // ends up believing a limit is in force that isn't — or, worse for the
    // lock wait, believing they disabled a limit that then fires instantly.
    logger.warn(`Ignoring ${name}: expected a number of milliseconds`, {
      source: "startup",
      service: "bringup",
      value: raw,
      usingMs: fallback,
      note: opts.zeroDisables ? "0 disables the deadline" : "0 is not accepted here",
    });
    return fallback;
  }
  return Math.floor(parsed);
}

/**
 * How long a booting task waits for another task's bring-up before giving up.
 * Long enough for a real migration run on a large database; never infinite.
 *
 * There is deliberately NO way to disable this one. An unbounded wait for the
 * lock is the failure mode this whole task exists to remove: the process would
 * sit in "initializing" forever, the load balancer would keep it in rotation,
 * and the rollout would report success. A value below 1 ms is therefore an
 * operator mistake, not an escape hatch, and is refused in favour of the
 * default. Long migrations get a LARGER number, not zero.
 */
export function getBringUpLockTimeoutMs(): number {
  return msEnv("BRINGUP_LOCK_TIMEOUT_MS", DEFAULT_LOCK_TIMEOUT_MS, { zeroDisables: false });
}

/**
 * Deadline applied to each individual bring-up step.
 *
 * 0 genuinely disables it, and unlike the lock wait that is a defensible
 * choice: a step deadline can fire on a legitimately slow migration, and the
 * consequence of firing (this process holds the bring-up lock until it is
 * replaced, because the abandoned work may still be running) is heavier than
 * letting a known-slow migration finish.
 */
export function getBringUpStepTimeoutMs(): number {
  return msEnv("BRINGUP_STEP_TIMEOUT_MS", DEFAULT_STEP_TIMEOUT_MS, { zeroDisables: true });
}

/** Gave up waiting for the bring-up lock. */
export class BringUpLockTimeoutError extends Error {
  constructor(readonly waitedMs: number) {
    super(
      `Timed out after ${waitedMs} ms waiting for the "${BRINGUP_LOCK_NAME}" lock. ` +
        "Another task is running the schema bring-up and has not finished, or a task " +
        "died while holding the lock and its connection has not yet been reaped. " +
        "Redeploying this service alone is the normal repair; raise " +
        "BRINGUP_LOCK_TIMEOUT_MS if the migration legitimately takes longer.",
    );
    this.name = "BringUpLockTimeoutError";
  }
}

/** Another task ran the bring-up while this one waited, and its run failed. */
export class BringUpPeerFailedError extends Error {
  constructor(readonly peer: BringUpPeerRun) {
    super(
      `Another booting task (boot ${peer.bootId}) ran the schema bring-up while this ` +
        `task waited, and it FAILED in phase "${peer.phase ?? "unknown"}": ` +
        `${peer.error ?? "(no message recorded)"}. This task refuses to re-apply what ` +
        "just failed — fix that failure and redeploy; both tasks come up together.",
    );
    this.name = "BringUpPeerFailedError";
  }
}

/**
 * Take the bring-up lock, waiting at most the configured timeout.
 *
 * Throws {@link BringUpLockTimeoutError} on deadline, and whatever the driver
 * threw when the DATABASE is the problem — the caller must report those two
 * as different blockers.
 */
export async function acquireBringUpLock(): Promise<AdvisoryLockHandle> {
  const timeoutMs = getBringUpLockTimeoutMs();
  const startedAt = Date.now();
  const handle = await storage.advisoryLock.tryAcquireSession(BRINGUP_LOCK_NAME, {
    timeoutMs,
    onWaitStart: () => {
      logger.warn("Another task is running the schema bring-up; waiting for it", {
        source: "startup",
        service: "bringup",
        lock: BRINGUP_LOCK_NAME,
        timeoutMs,
      });
    },
  });
  if (!handle) throw new BringUpLockTimeoutError(Date.now() - startedAt);
  return handle;
}

/** Shape stored in the `bringup_state` variable. Tolerant on read. */
interface StoredBringUpRun {
  status?: unknown;
  bootId?: unknown;
  startedAt?: unknown;
  finishedAt?: unknown;
  phase?: unknown;
  error?: unknown;
  /** MIGRATIONS_RESUME_FROM_VERSION the run applied, when it applied one. */
  resumeVersion?: unknown;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

/**
 * Read the last recorded bring-up run, or null when there is none (or the
 * row is unreadable — a breadcrumb that cannot be parsed must not be able to
 * stop a boot).
 *
 * Callers must only ask once the database is known to be initialized: on an
 * empty or foreign database there is no `variables` table to read.
 */
export async function readRecordedBringUpRun(): Promise<
  (BringUpPeerRun & { resumeVersion: number | null }) | null
> {
  try {
    const row = await storage.variables.getByName(BRINGUP_STATE_VARIABLE);
    if (!row) return null;
    const value = (row.value ?? {}) as StoredBringUpRun;
    const status = asString(value.status);
    const bootId = asString(value.bootId);
    if (
      !bootId ||
      (status !== "in-progress" && status !== "succeeded" && status !== "failed")
    ) {
      return null;
    }
    const resume = typeof value.resumeVersion === "number" ? value.resumeVersion : null;
    return {
      status,
      bootId,
      startedAt: asString(value.startedAt) ?? "(unknown)",
      finishedAt: asString(value.finishedAt),
      phase: asString(value.phase),
      error: asString(value.error),
      resumeVersion: resume,
    };
  } catch (error) {
    logger.warn("Could not read the recorded bring-up state", {
      source: "startup",
      service: "bringup",
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Record this process's bring-up outcome for whoever boots next.
 *
 * Never throws: this is a breadcrumb for the next task, and failing to leave
 * one must not turn a successful bring-up into a failed boot. Only ever
 * called with the lock held, so the read-modify-write is safe.
 */
export async function recordOwnBringUpRun(run: {
  status: "in-progress" | "succeeded" | "failed";
  startedAt: string;
  phase?: string | null;
  error?: string | null;
  resumeVersion?: number | null;
}): Promise<void> {
  const { bootId } = getBootIdentity();
  const value = {
    status: run.status,
    bootId,
    startedAt: run.startedAt,
    finishedAt: run.status === "in-progress" ? null : new Date().toISOString(),
    phase: run.phase ?? null,
    error: run.error ?? null,
    resumeVersion: run.resumeVersion ?? null,
  };
  try {
    const existing = await storage.variables.getByName(BRINGUP_STATE_VARIABLE);
    if (existing) {
      await storage.variables.update(existing.id, { value });
    } else {
      // `variables` rows are name/value only, so what this row MEANS lives
      // here: the most recent schema bring-up run — which booting task ran it,
      // when, and how it ended. Read by the next task that waits for the
      // bring-up lock. Diagnostic only; the schema itself is always re-read.
      await storage.variables.create({ name: BRINGUP_STATE_VARIABLE, value });
    }
  } catch (error) {
    logger.warn("Could not record the bring-up state for other booting tasks", {
      source: "startup",
      service: "bringup",
      status: run.status,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
