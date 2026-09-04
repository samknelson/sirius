/**
 * Drift → migration correlation (`buildDriftRemediation`).
 *
 * This is the text a remote operator ACTS on: it decides whether they wait
 * for a redeploy, set `MIGRATIONS_RESUME_FROM_VERSION=<n>`, or ship a
 * baseline in the next image. A wrong classification, or a resume value one
 * step off, is wrong-but-plausible output — the boot still fails and nothing
 * in the type system or the lint rules disagrees. The arithmetic is the
 * whole point of the test: the value must be low enough that every drifted
 * item's migration re-runs, and high enough not to replay half the history
 * because one old migration mentions the same column name.
 *
 * Pure: no database, no server.
 */
import { describe, expect, it } from "vitest";
import {
  buildDriftRemediation,
  type AggregateDriftReport,
} from "../../server/services/schema-drift-check";

const MIGRATIONS = [
  { version: 1008, name: "add_trust_benefit_sirius_id", description: "Add sirius_id to trust benefits" },
  { version: 1053, name: "create_help", description: "Create the help table" },
  { version: 1056, name: "create_options_worker_ban_type", description: "Create options_worker_ban_type" },
  { version: 1059, name: "ledger_accounts_sirius_id", description: "Add sirius_id to ledger_accounts" },
];

function reportWith(overrides: Partial<AggregateDriftReport>): AggregateDriftReport {
  return {
    hasDrift: true,
    perTable: [],
    missingTables: [],
    extraTables: [],
    checkedComponents: [],
    coreTableCount: 96,
    ...overrides,
  };
}

describe("buildDriftRemediation", () => {
  it("reports pending migrations when the stored version is behind them", () => {
    const text = buildDriftRemediation(
      reportWith({ missingTables: ["help", "options_worker_ban_type"] }),
      { storedVersion: 1052, migrations: MIGRATIONS },
    ).join("\n");

    expect(text).toContain("A. PENDING MIGRATIONS COVER THESE ITEMS");
    expect(text).toContain("1053 (create_help)");
    expect(text).not.toContain("MIGRATIONS_RESUME_FROM_VERSION=");
    expect(text).not.toContain("NO REGISTERED MIGRATION COVERS");
  });

  it("names the resume version below the earliest covering migration when the stamp is ahead", () => {
    const text = buildDriftRemediation(
      reportWith({ missingTables: ["help", "options_worker_ban_type"] }),
      { storedVersion: 1060, migrations: MIGRATIONS },
    ).join("\n");

    expect(text).toContain("B. THE STORED VERSION IS AHEAD OF THE SCHEMA");
    // 1053 is the earliest migration covering a drifted item; resuming FROM
    // 1052 re-applies it and everything after it.
    expect(text).toContain("MIGRATIONS_RESUME_FROM_VERSION=1052");
  });

  it("ignores older incidental token matches when choosing the resume version", () => {
    // `sirius_id` is mentioned by 1008 as well as by 1059, which actually
    // adds the column to ledger_accounts. Resuming from 1007 would replay
    // fifty migrations to fix one column.
    const text = buildDriftRemediation(
      reportWith({
        perTable: [
          {
            tableName: "ledger_accounts",
            missingColumns: ["sirius_id"],
            extraColumns: [],
            typeMismatches: [],
            missingConstraints: [],
            missingIndexes: [],
          } as unknown as AggregateDriftReport["perTable"][number],
        ],
      }),
      { storedVersion: 1060, migrations: MIGRATIONS },
    ).join("\n");

    expect(text).toContain("MIGRATIONS_RESUME_FROM_VERSION=1058");
  });

  it("demands a baseline when no registered migration covers the drift", () => {
    const text = buildDriftRemediation(reportWith({ missingTables: ["widgets"] }), {
      storedVersion: 1060,
      migrations: MIGRATIONS,
    }).join("\n");

    expect(text).toContain("C. NO REGISTERED MIGRATION COVERS THESE ITEMS");
    expect(text).toContain("missing table widgets");
    expect(text).not.toContain("MIGRATIONS_RESUME_FROM_VERSION=");
  });

  it("always points at the read-only report mode, whatever the case", () => {
    const text = buildDriftRemediation(reportWith({ missingTables: ["help"] }), {
      storedVersion: 1052,
      migrations: MIGRATIONS,
    }).join("\n");

    expect(text).toContain("BRINGUP_REPORT_ONLY=1");
  });
});
