import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { getTableName } from "drizzle-orm";
import { getComponentById } from "../../shared/components";
import { openEnrollmentWindows } from "../../shared/schema";
import { getComponentMigrations } from "../../server/services/migration-runner";

const mocks = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../server/db", () => ({ db: { execute: mocks.execute } }));

import baoMigration from "../../scripts/migrate/components/sitespecific.bao/1148_open_enrollment_windows";
import retiredTrustMigration from "../../scripts/migrate/components/trust.elections/002_create_open_enrollment_windows";

describe("Open Enrollment window schema ownership", () => {
  beforeEach(() => mocks.execute.mockReset());

  it("assigns the unchanged table to BAO and not Trust Elections", () => {
    const baoTables = getComponentById("sitespecific.bao")?.schemaManifest?.tables ?? [];
    const electionTables = getComponentById("trust.elections")?.schemaManifest?.tables ?? [];

    expect(getTableName(openEnrollmentWindows)).toBe("open_enrollment_windows");
    expect(baoTables).toContain("open_enrollment_windows");
    expect(electionTables).not.toContain("open_enrollment_windows");
    expect(getComponentMigrations("sitespecific.bao").at(-1)).toMatchObject({
      version: 1148,
      name: "open_enrollment_windows",
    });
  });

  it("does not write to an existing table or its rows when adopting it", async () => {
    mocks.execute.mockResolvedValue({ rows: [{ exists: true }] });

    await baoMigration.up();

    expect(mocks.execute).toHaveBeenCalledTimes(1);
    const query = new PgDialect().sqlToQuery(mocks.execute.mock.calls[0][0]).sql;
    expect(query).toContain("information_schema.tables");
    expect(query).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|DROP|TRUNCATE)\b/i);
  });

  it("creates the BAO table only when no prior table exists", async () => {
    mocks.execute
      .mockResolvedValueOnce({ rows: [{ exists: false }] })
      .mockResolvedValueOnce({ rows: [] });

    await baoMigration.up();

    expect(mocks.execute).toHaveBeenCalledTimes(2);
    const query = new PgDialect().sqlToQuery(mocks.execute.mock.calls[1][0]).sql;
    expect(query).toContain("CREATE TABLE open_enrollment_windows");
    expect(query).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|DROP|TRUNCATE)\b/i);
  });

  it("keeps the Trust Elections migration registered as a harmless no-op", async () => {
    await retiredTrustMigration.up();
    expect(mocks.execute).not.toHaveBeenCalled();
  });
});
