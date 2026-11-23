import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ execute: vi.fn(), listOptions: vi.fn() }));
vi.mock("../../server/storage/transaction-context", () => ({
  getClient: () => ({ execute: mocks.execute }),
  runInTransaction: vi.fn(),
}));
vi.mock("../../server/storage/unified-options", () => ({
  createUnifiedOptionsStorage: () => ({ list: mocks.listOptions }),
}));
vi.mock("../../server/storage/edls/crews", () => ({
  createEdlsCrewsStorage: vi.fn(),
}));
vi.mock("../../server/services/component-cache", () => ({
  isComponentEnabledSync: () => false,
}));

const { createEdlsAssignmentsStorage } = await import("../../server/storage/edls/assignments");
const dialect = new PgDialect();

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listOptions.mockResolvedValue([]);
});

describe("sheet assignment worker IDs", () => {
  it("preserves the detailed read's membership joins without its enrichment or classification work", async () => {
    const statements: ReturnType<PgDialect["sqlToQuery"]>[] = [];
    // Input order deliberately differs from the detailed read's name sort.
    mocks.execute.mockImplementation(async (query: SQL) => {
      statements.push(dialect.sqlToQuery(query));
      return { rows: [
        { workerId: "inactive-assigned", workerRowId: "inactive-assigned", family: "Zulu" },
        { workerId: "active", workerRowId: "active", family: "Alpha" },
        { workerId: "inactive-assigned", workerRowId: "inactive-assigned", family: "Zulu" },
      ] };
    });
    const storage = createEdlsAssignmentsStorage();
    const lean = await storage.getWorkerIdsBySheetId("sheet");
    expect(lean).toEqual(["inactive-assigned", "active", "inactive-assigned"]);
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    expect(mocks.listOptions).not.toHaveBeenCalled();

    const detailed = await storage.getBySheetId("sheet");
    expect(new Set(lean)).toEqual(new Set(detailed.map(row => row.workerId)));
    expect(mocks.listOptions).toHaveBeenCalledExactlyOnceWith("classification");
    const [leanQuery, detailedQuery] = statements;
    for (const query of statements) {
      expect(query.params).toEqual(["sheet"]);
      for (const clause of [
        "FROM edls_assignments ea",
        "INNER JOIN edls_crews ec ON ea.crew_id = ec.id",
        "INNER JOIN workers w ON ea.worker_id = w.id",
        "INNER JOIN contacts c ON w.contact_id = c.id",
        "WHERE ec.sheet_id = $1",
      ]) expect(query.sql).toContain(clause);
    }
    expect(leanQuery.sql).toMatch(/SELECT ea\.worker_id as "workerId"\s+FROM/);
    expect(leanQuery.sql).not.toMatch(/LEFT JOIN|LATERAL|ORDER BY|worker_edls|ea\.data|c\.family/);
    expect(detailedQuery.sql).toContain("LEFT JOIN comm cm ON cm.id = ea.comm_id");
  });

  it("returns no IDs for an empty sheet without consulting classification options", async () => {
    mocks.execute.mockResolvedValue({ rows: [] });
    expect(await createEdlsAssignmentsStorage().getWorkerIdsBySheetId("empty-sheet")).toEqual([]);
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    expect(mocks.listOptions).not.toHaveBeenCalled();
  });
});
