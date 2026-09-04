/**
 * Component schema bring-up for BAO DB suites.
 *
 * Vitest runs test files in parallel forks. The suites used to call the
 * component migrations' `up()` directly in `beforeAll`, and that is not safe
 * to do concurrently:
 *
 *   - two forks re-applying the same `CREATE ... IF NOT EXISTS` DDL deadlock
 *     on catalog locks (`40P01 deadlock detected`), failing one suite's setup;
 *   - the later migrations re-issue heavy DDL (`DROP/ADD CONSTRAINT`, table
 *     `UPDATE`s) on EVERY run, so even serialized re-application takes
 *     ACCESS EXCLUSIVE locks on the DC tables while another suite is already
 *     writing rows into them — deadlocks again, mid-test this time.
 *
 * So bring-up goes through the application's own runner: it consults the
 * component's recorded schema state and issues NO DDL when the database is
 * already current, which is the steady state of every shared test database.
 * Only a database on which the component was never enabled (no schema-state
 * variable) falls back to the raw migration list, and that fallback is
 * guarded by the lead table's existence so it runs at most once per database.
 * Everything runs under one session advisory lock (held by the DATABASE, so
 * it serializes across forks), bounded so a stuck holder fails loudly.
 *
 * Never call a component migration's `up()` directly from a suite.
 */
import { storage } from "../../../server/storage";
import { tableExists } from "../../../server/storage/utils";
import { runComponentMigrations, type Migration } from "../../../server/services/migration-runner";
import caseManagementMigration from "../../../scripts/migrate/components/sitespecific.bao/010_create_case_management";
import dcMigration from "../../../scripts/migrate/components/sitespecific.bao/011_create_disability_credit";
import dcWorkflowMigration from "../../../scripts/migrate/components/sitespecific.bao/012_dc_case_workflow";
import dcGrantMigration from "../../../scripts/migrate/components/sitespecific.bao/013_dc_grant_events";
import dcExtensionsMigration from "../../../scripts/migrate/components/sitespecific.bao/014_dc_extensions_and_notes_retirement";
import caseTypesMigration from "../../../scripts/migrate/components/sitespecific.bao/015_case_types_and_workflow_rules";
import appealTablesMigration from "../../../scripts/migrate/components/sitespecific.bao/016_benefit_appeal_tables";

const COMPONENT_ID = "sitespecific.bao";

/** One lock for every BAO bring-up; unrelated table sets still serialize, which is harmless. */
const LOCK_NAME = "tests:sitespecific.bao:schema-bringup";

/** Generous: a contending suite's whole bring-up runs while we wait. */
const LOCK_TIMEOUT_MS = 120_000;

const NO_STATE_MARKER = "no component_schema_state variable exists yet";

interface BaoSchemaSet {
  /** Raw migrations for a never-enabled database, in order. */
  migrations: readonly Migration[];
  /** Created by the first migration of the set; present = the set was already brought up here. */
  leadTable: string;
}

/** The BAO case-management tables (010) plus their case-type and Benefit Appeal amendments (015–016). */
const CASE_SCHEMA: BaoSchemaSet = {
  migrations: [caseManagementMigration, caseTypesMigration, appealTablesMigration],
  leadTable: "sitespecific_bao_cases",
};

/** The Disability Credit tables and their later amendments (011–014). */
const DC_SCHEMA: BaoSchemaSet = {
  migrations: [dcMigration, dcWorkflowMigration, dcGrantMigration, dcExtensionsMigration],
  leadTable: "sitespecific_bao_dc_cases",
};

async function withBringupLock<T>(fn: () => Promise<T>): Promise<T> {
  const handle = await storage.advisoryLock.tryAcquireSession(LOCK_NAME, {
    timeoutMs: LOCK_TIMEOUT_MS,
    pollIntervalMs: 250,
  });
  if (!handle) {
    throw new Error(
      `BAO schema bring-up lock "${LOCK_NAME}" still held after ${LOCK_TIMEOUT_MS}ms — another suite is stuck in its migrations`,
    );
  }
  try {
    return await fn();
  } finally {
    await handle.release();
  }
}

async function ensureBaoSchema(set: BaoSchemaSet): Promise<void> {
  await withBringupLock(async () => {
    // Register the component's COMPLETE migration list before consulting the
    // runner: it stamps the highest version it knows about, so a partial
    // registration would mark unseen migrations as applied.
    await import("../../../scripts/migrate/index");
    const result = await runComponentMigrations(COMPONENT_ID);
    if (result.errors.length === 0) return;
    if (!result.errors.some((e) => e.includes(NO_STATE_MARKER))) {
      throw new Error(`BAO component migrations failed:\n${result.errors.join("\n")}`);
    }
    // Never enabled on this database: provision the focused tables rather
    // than silently dropping coverage — once. A present lead table means an
    // earlier bring-up (this run or a previous one) already applied the set.
    if (await tableExists(set.leadTable)) return;
    for (const migration of set.migrations) {
      await migration.up();
    }
  });
}

export async function ensureBaoCaseSchema(): Promise<void> {
  await ensureBaoSchema(CASE_SCHEMA);
}

export async function ensureBaoDcSchema(): Promise<void> {
  await ensureBaoSchema(DC_SCHEMA);
}
