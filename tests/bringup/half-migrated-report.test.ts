/**
 * The bring-up report on a HALF-MIGRATED database.
 *
 * When migration 1053 succeeds and 1054 throws, `migrations_version` is left
 * at 1053. The report is the shell-less operator's only view of that number,
 * and it is the number they base a `MIGRATIONS_RESUME_FROM_VERSION` value on.
 * If the report still showed the pre-run version it would describe an
 * already-applied migration as pending — wrong-but-plausible output that
 * nothing else catches, because the boot fails either way and the failure
 * text looks identical.
 *
 * Runs against a faked migration runner: no database, no server.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  storedVersion: 1052,
  migrations: [
    { version: 1053, name: "create_help" },
    { version: 1054, name: "create_notes" },
  ],
  componentStatusReads: 0,
}));

vi.mock("../../scripts/migrate", () => ({}));

vi.mock("../../server/logger", () => ({
  logger: { info() {}, warn() {}, error() {}, debug() {} },
}));

vi.mock("../../server/services/empty-db-bootstrap", () => ({
  classifyDatabaseState: async () => ({ state: "initialized", tableNames: ["variables"] }),
  ensureEmptyDatabaseBootstrap: async () => false,
}));

vi.mock("../../server/services/component-cache", () => ({
  loadComponentCache: async () => {},
}));

vi.mock("../../server/services/schema-drift-check", () => ({
  enforceStartupSchemaDrift: async () => {},
  reportSchemaDriftOnly: async () => {},
}));

vi.mock("../../server/services/migration-runner", () => {
  class CoreMigrationFailedError extends Error {
    constructor(
      readonly failed: { version: number; name: string; error: string },
      readonly remaining: unknown[],
    ) {
      super(
        `Core migration ${failed.version} (${failed.name}) FAILED and stopped the boot.\n\n  error: ${failed.error}`,
      );
      this.name = "CoreMigrationFailedError";
    }
  }
  return {
    CoreMigrationFailedError,
    assertBaselinesBelowCore: () => {},
    getHighestCoreMigrationVersion: () => 1054,
    getHighestBaselineVersion: () => 900,
    applyMigrationVersionResume: async () => ({
      requestedVersion: 0,
      previousVersion: 0,
      applied: false,
    }),
    getMigrationStatus: async () => ({
      currentVersion: state.storedVersion,
      totalMigrations: state.migrations.length,
      pendingMigrations: state.migrations.filter((m) => m.version > state.storedVersion),
    }),
    runMigrations: async () => {
      // 1053 applies and stamps; 1054 throws.
      state.storedVersion = 1053;
      const failed = {
        version: 1054,
        name: "create_notes",
        error: 'relation "note_types" does not exist',
      };
      return { ran: 1, skipped: 0, errors: [failed.error], failed, remaining: [] };
    },
    runPendingComponentMigrationsAtStartup: async () => {},
    collectComponentMigrationStatus: async () => {
      state.componentStatusReads += 1;
      return { enabledCount: 0, schemaManaging: [] };
    },
  };
});

let text = "";

describe("bring-up report after a partially applied core migration run", () => {
  beforeAll(async () => {
    const { runSchemaBringUp } = await import("../../server/services/bringup");
    const { formatBringUpReport } = await import("../../server/services/bringup-report");
    await expect(runSchemaBringUp()).rejects.toThrow(/create_notes/);
    text = formatBringUpReport();
  });

  it("reports the version the database actually landed on", () => {
    expect(text).toContain("stored version:            1053");
  });

  it("lists only what is still pending, not what already applied", () => {
    expect(text).toContain("1054  create_notes");
    expect(text).not.toContain("1053  create_help");
    expect(text).toContain("applied this boot:         1");
  });

  it("names the failing migration and its error, and never reaches the drift gate", () => {
    expect(text).toContain("BRING-UP FAILED");
    expect(text).toContain("phase: core-migrations");
    expect(text).toContain("1054 (create_notes)");
    expect(text).toContain('relation "note_types" does not exist');
    expect(text).toContain("status: not-run");
  });
});
