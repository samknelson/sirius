/**
 * Schema bring-up (Task #1301).
 *
 * The one contiguous phase that decides whether this process may run against
 * this database at all: classify the database, bootstrap it if it is empty
 * and allowed, apply core migrations, load the component cache, apply
 * per-component migrations, and enforce the drift gate. Everything it learns
 * goes into the bring-up report, which is printed exactly once — on success
 * and on failure alike — before the app serves traffic.
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
 */

// Side-effect import: registers every core, per-component and baseline
// migration with the runner. Without it the registry is empty and every
// version reported below would be a lie.
import "../../scripts/migrate";
import { getEnvironmentVariable } from "../config/env-registry";
import { logger } from "../logger";
import { bootStatus } from "./boot-status";
import {
  printBringUpReport,
  recordBringUpFailure,
  recordComponentMigrationStatus,
  recordCoreMigrationRun,
  recordCoreMigrationStatus,
  recordDatabaseBootstrapped,
  recordDatabaseState,
  recordDriftOutcome,
  recordMigrationResume,
  setBringUpMode,
} from "./bringup-report";
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

/** Record the core bookkeeping (read-only) into the report. */
async function recordCoreStatus(): Promise<number> {
  const status = await getMigrationStatus();
  recordCoreMigrationStatus({
    storedVersion: status.currentVersion,
    highestRegisteredVersion: getHighestCoreMigrationVersion(),
    highestBaselineVersion: getHighestBaselineVersion(),
    pending: status.pendingMigrations.map((m) => ({ version: m.version, name: m.name })),
  });
  return status.currentVersion;
}

async function recordComponentStatus(): Promise<void> {
  const status = await collectComponentMigrationStatus();
  recordComponentMigrationStatus(status.enabledCount, status.schemaManaging);
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

  const storedVersion = await recordCoreStatus();
  await loadComponentCache();
  await recordComponentStatus();
  await reportSchemaDriftOnly(storedVersion);
}

/**
 * Run the schema bring-up phase. Throws on any failure (after recording it
 * in the report), or `BringUpReportOnlyStop` when report-only mode is on.
 */
export async function runSchemaBringUp(): Promise<void> {
  const reportOnly = isReportOnlyMode();
  setBringUpMode(reportOnly ? "report-only" : "normal");
  let phase = "database-state";

  try {
    // A baseline above the ordinary sequence would be permanently skipped on
    // a bootstrapped database. Registry-only check; costs nothing.
    phase = "migration-registry";
    assertBaselinesBelowCore();

    phase = "database-state";
    const state = await classifyDatabaseState();
    recordDatabaseState(state.state, state.tableNames.length);

    if (reportOnly) {
      phase = "report-only";
      logger.warn("BRINGUP_REPORT_ONLY=1 — collecting the bring-up report; nothing will be written", {
        source: "startup",
        service: "bringup",
      });
      await collectReportOnly(state);
      bootStatus.blockedOn = "report-only";
      printBringUpReport();
      throw new BringUpReportOnlyStop();
    }

    phase = "empty-db-bootstrap";
    if (await ensureEmptyDatabaseBootstrap(state)) {
      recordDatabaseBootstrapped();
    }

    // One-shot recovery for a database stamped ahead of its schema. Explicit
    // only: never inferred, never defaulted, and it can only LOWER the stamp.
    phase = "migration-version-resume";
    const resumeRaw = getEnvironmentVariable("MIGRATIONS_RESUME_FROM_VERSION");
    if (resumeRaw !== undefined && resumeRaw !== "") {
      recordMigrationResume(await applyMigrationVersionResume(resumeRaw));
    }

    phase = "core-migrations";
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

    phase = "component-cache";
    await loadComponentCache();
    logger.info("Component cache initialized", { source: "startup" });

    // Pending per-component migrations for already-enabled components. This
    // already throws on error; the phase name makes the failure legible.
    phase = "component-migrations";
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

    phase = "drift-gate";
    await enforceStartupSchemaDrift();

    printBringUpReport();
  } catch (error) {
    if (error instanceof BringUpReportOnlyStop) throw error;

    const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
    recordBringUpFailure(phase, error instanceof Error ? error.message : String(error));
    bootStatus.blockedOn =
      phase === "core-migrations" ||
      phase === "component-migrations" ||
      phase === "migration-version-resume" ||
      phase === "migration-registry"
        ? "migrations"
        : phase === "drift-gate"
          ? "drift"
          : phase === "database-state" || phase === "empty-db-bootstrap"
            ? "database"
            : "other";
    logger.error("Schema bring-up failed", {
      source: "startup",
      service: "bringup",
      phase,
      error: message,
    });
    printBringUpReport();
    throw error;
  }
}
