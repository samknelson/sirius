/**
 * Schema bring-up (Task #1301, serialized across processes in Task #1350).
 *
 * The one contiguous phase that decides whether this process may run against
 * this database at all: take the bring-up lock, classify the database,
 * bootstrap it if it is empty and allowed, apply core migrations, load the
 * component cache, apply per-component migrations, and enforce the drift
 * gate. Everything it learns goes into the bring-up report, which is printed
 * exactly once — on success and on failure alike — before the app serves
 * traffic.
 *
 * WHY IT IS ITS OWN PHASE. The operator of the deployment this was written
 * for has no shell on the target. Their entire diagnostic surface is the
 * deploy log and a browser, and every repair has to be an environment
 * variable plus a redeploy. That forces three properties that used to be
 * missing:
 *
 *   - a failed migration is FATAL. It used to be logged and stepped over, so
 *     the first thing that actually refused to boot was the drift gate, and
 *     the operator saw a table diff instead of "migration 1053 failed
 *     because X". The app must never reach the drift gate half-migrated.
 *   - the bookkeeping is REPORTED. "Migrations never attempted", "migrations
 *     attempted and failed", and "migrations_version stamped ahead of the
 *     schema" used to produce byte-identical output.
 *   - the whole thing can run READ-ONLY (`BRINGUP_REPORT_ONLY=1`), so an
 *     unknown target can be inspected without being mutated.
 *
 * WHY IT IS EXCLUSIVE. The same image runs as two ECS services against one
 * database and a rollout restarts both at once, so two processes reach this
 * phase simultaneously. It therefore runs under a database-held advisory
 * lock: exactly one task classifies, bootstraps and migrates while the others
 * wait, and a waiter then RE-READS the database instead of repeating what was
 * just applied. Every step — including the wait for the lock — has a
 * deadline, because a boot that cannot make progress must fail visibly rather
 * than sit in "initializing" behind a load balancer that still routes to it.
 */

// Side-effect import: registers every core, per-component and baseline
// migration with the runner. Without it the registry is empty and every
// version reported below would be a lie.
import "../../scripts/migrate";
import { getEnvironmentVariable } from "../config/env-registry";
import { logger } from "../logger";
import type { AdvisoryLockHandle } from "../storage/advisory-lock";
import { bootStatus, type BringUpConcurrency } from "./boot-status";
import { BootStepTimeoutError, withBootDeadline } from "./boot-deadline";
import {
  printBringUpReport,
  recordBringUpConcurrency,
  recordBringUpConcurrencyNote,
  recordBringUpFailure,
  recordComponentMigrationStatus,
  recordCoreMigrationRun,
  recordCoreMigrationStatus,
  recordDatabaseBootstrapped,
  recordDatabaseState,
  recordDriftOutcome,
  recordMigrationResume,
  setBringUpMode,
  type BringUpPeerRun,
} from "./bringup-report";
import {
  acquireBringUpLock,
  BringUpLockTimeoutError,
  BringUpPeerFailedError,
  getBringUpStepTimeoutMs,
  readRecordedBringUpRun,
  recordOwnBringUpRun,
} from "./bringup-lock";
import {
  classifyDatabaseState,
  ensureEmptyDatabaseBootstrap,
  type DatabaseStateInfo,
} from "./empty-db-bootstrap";
import {
  applyMigrationVersionResume,
  assertBaselinesBelowCore,
  collectComponentMigrationStatus,
  CoreMigrationFailedError,
  getHighestBaselineVersion,
  getHighestCoreMigrationVersion,
  getMigrationStatus,
  runMigrations,
  runPendingComponentMigrationsAtStartup,
} from "./migration-runner";
import { enforceStartupSchemaDrift, reportSchemaDriftOnly } from "./schema-drift-check";
import { loadComponentCache } from "./component-cache";

/**
 * Thrown to stop the boot after a report-only run. Not a failure: the
 * process did exactly what it was asked to do. The entry points recognize it
 * and keep serving the report instead of the app.
 */
export class BringUpReportOnlyStop extends Error {
  constructor() {
    super(
      "BRINGUP_REPORT_ONLY=1 — bring-up report produced, boot stopped before any write. " +
        "Unset the variable to start normally.",
    );
    this.name = "BringUpReportOnlyStop";
  }
}

export function isReportOnlyMode(): boolean {
  return getEnvironmentVariable("BRINGUP_REPORT_ONLY") === "1";
}

/**
 * How long the bring-up may spend leaving its own breadcrumb. Short and
 * separate from the step deadline: the write is a diagnostic for the NEXT
 * task, and it runs on the failure path too, where the database is often
 * exactly what is broken.
 */
const STATE_WRITE_TIMEOUT_MS = 15_000;

/** Record the core bookkeeping (read-only) into the report. */
async function recordCoreStatus(): Promise<Awaited<ReturnType<typeof getMigrationStatus>>> {
  const status = await getMigrationStatus();
  recordCoreMigrationStatus({
    storedVersion: status.currentVersion,
    highestRegisteredVersion: getHighestCoreMigrationVersion(),
    highestBaselineVersion: getHighestBaselineVersion(),
    pending: status.pendingMigrations.map((m) => ({ version: m.version, name: m.name })),
  });
  return status;
}

async function recordComponentStatus(): Promise<number> {
  const status = await collectComponentMigrationStatus();
  recordComponentMigrationStatus(status.enabledCount, status.schemaManaging);
  return status.schemaManaging.reduce((total, c) => total + c.pending.length, 0);
}

/**
 * Report-only path: read everything, write nothing. No bootstrap, no
 * migration, no variable write — not even the drift gate's `bootStatus`
 * failure, since nothing failed.
 */
async function collectReportOnly(state: DatabaseStateInfo): Promise<void> {
  if (state.state !== "initialized") {
    recordDriftOutcome("not-run", [
      "not run: the database has no `variables` table, so there is no migration",
      "bookkeeping to read and no enabled-component set to check against.",
      state.state === "empty"
        ? "The database is EMPTY. A normal boot would refuse to start unless ALLOW_EMPTY_DB_BOOTSTRAP=1 is set."
        : "The database has tables but was not initialized by this app — check that DB_NAME/DB_HOST point where you think.",
    ]);
    return;
  }

  const status = await recordCoreStatus();
  await loadComponentCache();
  await recordComponentStatus();
  await reportSchemaDriftOnly(status.currentVersion);
}

/** Set the concurrency outcome in both places that report it. */
function setConcurrency(
  outcome: BringUpConcurrency,
  details?: { waitedMs?: number | null; peer?: BringUpPeerRun | null },
): void {
  bootStatus.bringUpConcurrency = outcome;
  recordBringUpConcurrency(outcome, details);
}

/**
 * Leave the breadcrumb without letting it become the reason a boot fails or
 * hangs. Bounded and swallowing by design.
 */
async function recordRunSafely(run: Parameters<typeof recordOwnBringUpRun>[0]): Promise<void> {
  try {
    await withBootDeadline(
      "bringup-state-write",
      STATE_WRITE_TIMEOUT_MS,
      "the `variables` write recording this bring-up run",
      () => recordOwnBringUpRun(run),
    );
  } catch (error) {
    logger.warn("Could not record the bring-up run for other booting tasks", {
      source: "startup",
      service: "bringup",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** What the failed phase was ultimately blocked on, for /health. */
function blockedOnFor(phase: string, error: unknown): typeof bootStatus.blockedOn {
  if (error instanceof BringUpLockTimeoutError) return "bringup-lock";
  if (error instanceof BringUpPeerFailedError) return "peer-bringup";
  switch (phase) {
    case "core-migrations":
    case "component-migrations":
    case "migration-version-resume":
    case "migration-registry":
      return "migrations";
    case "drift-gate":
      return "drift";
    case "database-state":
    case "empty-db-bootstrap":
    // Failing to even TAKE the lock is a connection problem, not contention:
    // contention is the timeout above.
    case "bringup-lock":
      return "database";
    default:
      return "other";
  }
}

/**
 * Run the schema bring-up phase. Throws on any failure (after recording it
 * in the report), or `BringUpReportOnlyStop` when report-only mode is on.
 */
export async function runSchemaBringUp(): Promise<void> {
  const reportOnly = isReportOnlyMode();
  setBringUpMode(reportOnly ? "report-only" : "normal");
  const stepTimeoutMs = getBringUpStepTimeoutMs();
  const startedAt = new Date().toISOString();
  const lockAttemptStartedAt = Date.now();
  let phase = "database-state";
  let lock: AdvisoryLockHandle | null = null;
  let recordedInProgress = false;
  /** A step gave up waiting; its work may still be running. See the finally. */
  let timedOut = false;

  /** Run one bring-up step under the step deadline. */
  const step = <T>(name: string, waitingOn: string, fn: () => Promise<T>): Promise<T> => {
    phase = name;
    return withBootDeadline(name, stepTimeoutMs, waitingOn, fn);
  };

  try {
    // A baseline above the ordinary sequence would be permanently skipped on
    // a bootstrapped database. Registry-only check; costs nothing.
    phase = "migration-registry";
    assertBaselinesBelowCore();

    if (!reportOnly) {
      // Serialize with the other task(s) booting against this database. The
      // wait is bounded inside acquireBringUpLock; a database we cannot even
      // reach throws instead, and is reported as a database problem.
      phase = "bringup-lock";
      lock = await acquireBringUpLock();
      setConcurrency(lock.contended ? "waited-and-proceeded" : "sole", {
        waitedMs: lock.waitedMs,
      });
      if (lock.contended) {
        logger.info("Acquired the schema bring-up lock after waiting for another task", {
          source: "startup",
          service: "bringup",
          waitedMs: lock.waitedMs,
        });
      }
    }

    const state = await step("database-state", "the database classification query", () =>
      classifyDatabaseState(),
    );
    recordDatabaseState(state.state, state.tableNames.length);

    if (reportOnly) {
      phase = "report-only";
      setConcurrency("unlocked-report-only");
      recordBringUpConcurrencyNote(
        "report-only writes nothing, so it does not serialize against other booting tasks",
      );
      logger.warn("BRINGUP_REPORT_ONLY=1 — collecting the bring-up report; nothing will be written", {
        source: "startup",
        service: "bringup",
      });
      await collectReportOnly(state);
      bootStatus.blockedOn = "report-only";
      printBringUpReport();
      throw new BringUpReportOnlyStop();
    }

    // What the task ahead of us did, if there was one. Only meaningful once
    // there is a `variables` table to have recorded it in, and only about a
    // run that finished while WE were waiting — an older failure may well be
    // the very thing this deploy is shipping the fix for.
    let peerJustSucceeded = false;
    let peerResumeVersion: number | null = null;
    if (lock?.contended && state.state === "initialized") {
      phase = "peer-bringup";
      const recorded = await withBootDeadline(
        "peer-bringup",
        STATE_WRITE_TIMEOUT_MS,
        "the recorded bring-up state of the task ahead of this one",
        () => readRecordedBringUpRun(),
      );
      const finishedDuringOurWait =
        recorded?.finishedAt != null &&
        Number.isFinite(Date.parse(recorded.finishedAt)) &&
        Date.parse(recorded.finishedAt) >= lockAttemptStartedAt;

      if (recorded && finishedDuringOurWait) {
        const { resumeVersion, ...peer } = recorded;
        if (recorded.status === "failed") {
          setConcurrency("peer-failed", { waitedMs: lock.waitedMs, peer });
          throw new BringUpPeerFailedError(peer);
        }
        // Still "waited-and-proceeded" for now: whether this task ends up
        // with nothing to do is decided by re-reading the schema below, not
        // by the peer's own claim of success.
        setConcurrency("waited-and-proceeded", { waitedMs: lock.waitedMs, peer });
        peerJustSucceeded = recorded.status === "succeeded";
        peerResumeVersion = resumeVersion;
      } else if (recorded?.status === "in-progress") {
        // We hold the lock, so whoever recorded this is gone. Say so — a
        // half-finished run is exactly what the operator needs to know about.
        recordBringUpConcurrencyNote(
          `the previous holder (boot ${recorded.bootId}, started ${recorded.startedAt}) ` +
            "left no outcome — it died mid-bring-up; this task re-reads and continues",
        );
      }
    }

    // Claim the run for whoever boots next — but only when there is a
    // `variables` table to claim it in. On an empty database the bootstrap
    // below creates one; until then there is nowhere to write, and the
    // succeeded/failed record after it covers that case.
    if (state.state === "initialized") {
      await recordRunSafely({ status: "in-progress", startedAt });
      recordedInProgress = true;
    }

    await step("empty-db-bootstrap", "the empty-database bootstrap DDL", async () => {
      if (await ensureEmptyDatabaseBootstrap(state)) {
        recordDatabaseBootstrapped();
      }
    });

    // One-shot recovery for a database stamped ahead of its schema. Explicit
    // only: never inferred, never defaulted, and it can only LOWER the stamp.
    phase = "migration-version-resume";
    const resumeRaw = getEnvironmentVariable("MIGRATIONS_RESUME_FROM_VERSION");
    let resumeApplied: number | null = null;
    if (resumeRaw !== undefined && resumeRaw !== "") {
      const requested = Number(resumeRaw);
      if (peerJustSucceeded && peerResumeVersion !== null && peerResumeVersion === requested) {
        // Both tasks carry the same one-shot variable. The task ahead already
        // performed it; re-stamping would replay the same migrations a second
        // time for no reason.
        recordBringUpConcurrencyNote(
          `MIGRATIONS_RESUME_FROM_VERSION=${resumeRaw} was already applied by the task ahead; not repeated`,
        );
      } else {
        recordMigrationResume(await applyMigrationVersionResume(resumeRaw));
        resumeApplied = Number.isFinite(requested) ? requested : null;
      }
    }

    const migrationRun = await step("core-migrations", "the core migration runner", async () => {
      await recordCoreStatus();
      const migrationResult = await runMigrations();
      recordCoreMigrationRun(migrationResult.ran);
      if (migrationResult.ran > 0) {
        logger.info("Database migrations completed", {
          source: "startup",
          ran: migrationResult.ran,
          skipped: migrationResult.skipped,
        });
      }
      // Re-read BEFORE branching on failure. A partial run leaves the stamp on
      // the last migration that succeeded, and that number is exactly what the
      // operator reasons about — reporting the pre-run version on a
      // half-migrated database would describe already-applied migrations as
      // pending and invite a wrong recovery value.
      await recordCoreStatus();
      if (migrationResult.failed) {
        // FATAL. Continuing would hand a half-migrated database to the drift
        // gate, whose table diff hides the migration error that caused it.
        throw new CoreMigrationFailedError(migrationResult.failed, migrationResult.remaining);
      }
      return migrationResult;
    });

    await step("component-cache", "the component cache load", async () => {
      await loadComponentCache();
      logger.info("Component cache initialized", { source: "startup" });
    });

    // Pending per-component migrations for already-enabled components. This
    // already throws on error; the phase name makes the failure legible.
    const componentPendingBefore = await step(
      "component-migrations",
      "the per-component migration runner",
      async () => {
        const pending = await recordComponentStatus();
        try {
          await runPendingComponentMigrationsAtStartup();
        } finally {
          // Record where the per-component stamps actually landed, failure or
          // not: a component that failed halfway is the same diagnosis problem
          // as a half-migrated core, and this is the operator's only view of it.
          await recordComponentStatus().catch((err: unknown) => {
            logger.warn("Could not read per-component migration status for the bring-up report", {
              source: "startup",
              service: "bringup",
              error: err instanceof Error ? err.message : String(err),
            });
          });
        }
        return pending;
      },
    );

    await step("drift-gate", "the schema drift gate", () => enforceStartupSchemaDrift());

    // The waiter that found nothing left to do is a DIFFERENT outcome from
    // the one that still had migrations of its own, and a rollout should be
    // able to tell them apart without reading migration counts.
    if (peerJustSucceeded && migrationRun.ran === 0 && componentPendingBefore === 0) {
      setConcurrency("deferred-to-peer", { waitedMs: lock?.waitedMs ?? null });
      recordBringUpConcurrencyNote(
        "verified the schema was already current — nothing was re-applied",
      );
    }

    await recordRunSafely({ status: "succeeded", startedAt, resumeVersion: resumeApplied });
    printBringUpReport();
  } catch (error) {
    if (error instanceof BringUpReportOnlyStop) throw error;

    if (error instanceof BringUpLockTimeoutError) {
      setConcurrency("lock-timeout", { waitedMs: error.waitedMs });
    }

    // A step gave up waiting. Its work is in an unknown state — see the
    // finally, which keeps the lock for exactly this reason. Say so in the
    // report, which is printed below, so the operator reads the consequence
    // (no other task can migrate) next to the timeout that caused it.
    if (error instanceof BootStepTimeoutError) {
      timedOut = true;
      if (lock) {
        recordBringUpConcurrencyNote(
          "the bring-up lock is deliberately NOT released: the timed-out step may still " +
            "be running, so no other task may start migrating until this process exits",
        );
      }
    }

    const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
    const shortMessage = error instanceof Error ? error.message : String(error);
    recordBringUpFailure(phase, shortMessage);
    bootStatus.blockedOn = blockedOnFor(phase, error);

    // Tell the next task what happened here — but only if we ever claimed the
    // run. Overwriting somebody else's record with a failure we had while
    // waiting for THEM would frame their successful run as broken.
    if (recordedInProgress) {
      await recordRunSafely({
        status: "failed",
        startedAt,
        phase,
        error: shortMessage,
      });
    }

    logger.error("Schema bring-up failed", {
      source: "startup",
      service: "bringup",
      phase,
      timedOut: error instanceof BootStepTimeoutError,
      error: message,
    });
    printBringUpReport();
    throw error;
  } finally {
    // Hand the lock back so the next task gets its turn — UNLESS a step blew
    // its deadline. A deadline stops the WAIT, not the work: the migration or
    // DDL we gave up on may still be executing. Releasing the lock then would
    // invite the waiting task to start the same migrations alongside a run
    // that never actually stopped, which is the exact race this lock exists
    // to prevent. Keep it. The only moment the abandoned work is provably
    // over is when this process dies — and at that moment the server drops
    // the session lock with the connection, so nothing stays wedged beyond
    // the life of the task that is already reporting itself as failed.
    if (lock && !timedOut) {
      await lock.release().catch((error: unknown) => {
        logger.warn("Could not release the schema bring-up lock", {
          source: "startup",
          service: "bringup",
          error: error instanceof Error ? error.message : String(error),
        });
      });
    } else if (lock) {
      logger.error(
        "Holding the schema bring-up lock after a step timed out — the abandoned " +
          "work may still be running, so no other task may migrate this database " +
          "until this process is replaced",
        { source: "startup", service: "bringup", phase },
      );
    }
  }
}
