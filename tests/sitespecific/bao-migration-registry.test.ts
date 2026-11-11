import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { getComponentMigrations } from "../../scripts/migrate/index";

const BAO_MIGRATIONS_DIR = resolve(__dirname, "../../scripts/migrate/components/sitespecific.bao");

describe("production component migration registry", () => {
  it("includes the complete Disability Credit migration sequence", () => {
    const migrations = getComponentMigrations("sitespecific.bao");

    const dcMigrations = migrations
      .filter((migration) => migration.version >= 11 && migration.version <= 13)
      .map(({ version, name }) => ({ version, name }));

    expect(dcMigrations).toEqual([
      { version: 11, name: "create_disability_credit" },
      { version: 12, name: "dc_case_workflow" },
      { version: 13, name: "dc_grant_events" },
    ]);
  });

  // The runner stamps the highest version it knows about, so a migration file
  // that exists on disk but is not imported from scripts/migrate/index.ts is
  // not "pending" — it is skipped forever on every database already past it.
  // (015 shipped that way: the file landed, the import did not.)
  it("registers every BAO migration file on disk", () => {
    const onDiskCount = readdirSync(BAO_MIGRATIONS_DIR)
      .filter((file) => /^\d+_.+\.ts$/.test(file)).length;
    const migrations = getComponentMigrations("sitespecific.bao");
    const registeredVersions = migrations.map((migration) => migration.version).sort((a, b) => a - b);

    expect(migrations).toHaveLength(onDiskCount);
    expect(registeredVersions.slice(0, 18)).toEqual(
      Array.from({ length: 18 }, (_, index) => index + 1),
    );
    expect(registeredVersions.slice(-4)).toEqual([1145, 1146, 1147, 1148]);
  });

  it("registers the case, communication, contribution, and enrollment migrations", () => {
    const tail = getComponentMigrations("sitespecific.bao")
      .filter((migration) => migration.version >= 15)
      .map(({ version, name }) => ({ version, name }));

    expect(tail).toEqual([
      { version: 15, name: "case_types_and_workflow_rules" },
      { version: 16, name: "benefit_appeal_tables" },
      { version: 17, name: "create_case_comms" },
      { version: 18, name: "create_case_documents" },
      { version: 1145, name: "case_status_lapse" },
      { version: 1146, name: "case_comm_notice_deadline" },
      { version: 1147, name: "create_ee_contribution_rates" },
      { version: 1148, name: "open_enrollment_windows" },
    ]);
  });
});
