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
  it("registers every BAO migration file on disk, contiguously from 1", () => {
    const onDisk = readdirSync(BAO_MIGRATIONS_DIR)
      .map((file) => /^(\d{3})_.+\.ts$/.exec(file)?.[1])
      .filter((v): v is string => v !== undefined)
      .map(Number)
      .sort((a, b) => a - b);
    const registered = getComponentMigrations("sitespecific.bao")
      .map((migration) => migration.version)
      .sort((a, b) => a - b);

    expect(registered).toEqual(onDisk);
    expect(registered).toEqual(onDisk.map((_, i) => i + 1));
  });

  it("registers the case-type and Benefit Appeal migrations after the DC sequence", () => {
    const tail = getComponentMigrations("sitespecific.bao")
      .filter((migration) => migration.version >= 15)
      .map(({ version, name }) => ({ version, name }));

    expect(tail).toEqual([
      { version: 15, name: "case_types_and_workflow_rules" },
      { version: 16, name: "benefit_appeal_tables" },
      { version: 17, name: "create_case_comms" },
    ]);
  });
});
