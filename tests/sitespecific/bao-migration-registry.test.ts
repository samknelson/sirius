import { describe, expect, it } from "vitest";
import { getComponentMigrations } from "../../scripts/migrate/index";

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
});