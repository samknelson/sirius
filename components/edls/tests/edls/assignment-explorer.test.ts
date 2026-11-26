import { describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { COMM_STATUSES, getCommStatusBucket } from "@shared/commStatus";
import { assignmentExplorerQuerySchema, assignmentNotification } from "../../shared/edls-assignment-explorer";
import { assignmentCsvLine } from "../../server/modules/edls/assignment-explorer-csv";

const mocks = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../../server/storage/transaction-context", () => ({
  getClient: () => ({ execute: mocks.execute }),
  runInTransaction: (fn: () => unknown) => fn(),
}));
import { assignmentExplorerStorage } from "../../server/storage/edls/assignment-explorer";

describe("EDLS current assignment classification and CSV safety", () => {
  it("classifies the current receipt using the shared delivery contract, never history", () => {
    for (const status of [...COMM_STATUSES, "provider-unknown", "", null]) {
      const bucket = getCommStatusBucket(status);
      expect(assignmentNotification("receipt", status)).toBe(bucket === "success" ? "sent" : bucket === "error" ? "failed" : "pending");
      expect(assignmentNotification(null, status)).toBe("none");
    }
  });

  it("rejects impossible dates, invalid filters, and unbounded pagination", () => {
    for (const query of [
      { ymd: "2026-02-29" }, { ymd: "2024-02-30" }, { ymd: "0000-01-01" },
      { page: 0 }, { page: "1.2" }, { pageSize: 101 }, { accepted: "true" }, { notified: ["sent", "failed"] },
    ]) expect(assignmentExplorerQuerySchema.safeParse({ ymd: "2024-02-29", ...query }).success).toBe(false);
    expect(assignmentExplorerQuerySchema.parse({ ymd: "2024-02-29" }).pageSize).toBe(50);
  });

  it("quotes embedded CSV delimiters and neutralizes spreadsheet execution", () => {
    expect(assignmentCsvLine(['a"b', "two\nlines", "a,b", null])).toBe('"a""b","two\nlines","a,b",\r\n');
    for (const value of ["=1+1", "+cmd", "-1", "@SUM(A1)", "  =1", "\t=1", "\r=1", "\nplain"]) {
      expect(assignmentCsvLine([value]).replace(/^"/, "")).toMatch(/^'/);
    }
  });

  it("shares day/scope/filter predicates across totals, detail, and uncapped cursor export", async () => {
    const statements: Array<{ sql: string; params: unknown[] }> = [];
    let fetches = 0;
    mocks.execute.mockImplementation(async query => {
      const compiled = new PgDialect().sqlToQuery(query);
      statements.push(compiled);
      if (compiled.sql.startsWith("FETCH")) return { rows: ++fetches === 1 ? [{ id: "row" }] : [] };
      return { rows: [{ total: 1 }] };
    });
    const query = assignmentExplorerQuerySchema.parse({ ymd: "2026-11-23", accepted: "unanswered", notified: "pending", population: "no", page: 2 });
    await assignmentExplorerStorage.listStatusAssignments(query);
    const received: unknown[] = [];
    await assignmentExplorerStorage.exportStatusAssignments(query, async rows => { received.push(...rows); });
    const count = statements.find(statement => statement.sql.startsWith("SELECT count"))!;
    const list = statements.find(statement => statement.sql.includes(" OFFSET "))!;
    const cursor = statements.find(statement => statement.sql.startsWith("DECLARE"))!;
    for (const statement of [count, list, cursor]) {
      expect(statement.sql).toContain("s.ymd = ");
      expect(statement.sql).toContain("s.status <> 'trash'");
      expect(statement.sql).toContain("JOIN edls_crews c ON c.id = a.crew_id");
      expect(statement.sql).toContain("LEFT JOIN comm ON comm.id = a.comm_id");
      expect(statement.sql).toContain("a.accepted IS NULL");
      expect(statement.params).toContain("pending");
      expect(statement.params).toContain(false);
      for (const status of COMM_STATUSES.filter(status => getCommStatusBucket(status) !== "pending")) {
        expect(statement.params).toContain(status);
      }
    }
    expect(cursor.sql).not.toMatch(/LIMIT|OFFSET/);
    expect(cursor.sql).toContain("c.id, a.id");
    expect(received).toEqual([{ id: "row" }]);
    expect(fetches).toBe(2);
  });
});
