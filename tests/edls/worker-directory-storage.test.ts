import { PgDialect } from "drizzle-orm/pg-core";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getClient: vi.fn(),
}));

vi.mock("../../server/storage/transaction-context", () => ({
  getClient: mocks.getClient,
}));

const { createEdlsWorkerDirectoryStorage } = await import(
  "../../server/storage/edls/worker-directory"
);

describe("EDLS worker directory storage", () => {
  afterEach(() => {
    mocks.getClient.mockReset();
  });

  it("pages workers and resolves prior, current, and next statuses through the shared assignment query", async () => {
    const statements: string[] = [];
    const responses = [
      { rows: [{ count: 3 }] },
      {
        rows: [{
          id: "worker-2",
          siriusId: 102,
          displayName: "Beta Worker",
          given: "Beta",
          family: "Worker",
          active: false,
          memberStatusId: null,
          memberStatusCode: null,
          memberStatusName: null,
          memberStatusSequence: null,
          ratingValue: null,
          ids: { ein: "102" },
        }],
      },
      {
        rows: [
          {
            id: "worker-1",
            priorStatus: null,
            currentStatus: "draft",
            nextStatus: "request",
          },
          {
            id: "worker-2",
            priorStatus: "lock",
            currentStatus: "reserved",
            nextStatus: "draft",
          },
          {
            id: "worker-3",
            priorStatus: "trash",
            currentStatus: null,
            nextStatus: null,
          },
        ],
      },
      { rows: [{ id: "ein", name: "EIN" }] },
    ];
    const execute = vi.fn(async (query) => {
      statements.push(new PgDialect().sqlToQuery(query as never).sql);
      return responses.shift()!;
    });
    mocks.getClient.mockReturnValue({ execute });

    const result = await createEdlsWorkerDirectoryStorage().list({
      page: 2,
      pageSize: 1,
      referenceYmd: "2026-09-20",
      currentAssignment: "include",
      nextAssignment: "exclude",
    });

    expect(result).toEqual({
      rows: [expect.objectContaining({
        id: "worker-2",
        active: false,
        priorStatus: "lock",
        currentStatus: "reserved",
        nextStatus: "draft",
        ids: { ein: "102" },
      })],
      total: 3,
      page: 2,
      pageSize: 1,
      totalPages: 3,
      idTypes: [{ id: "ein", name: "EIN" }],
    });
    expect(execute).toHaveBeenCalledTimes(4);
    const pageSql = statements[1].toLowerCase();
    const assignmentsSql = statements[2].toLowerCase();
    const filterSql = statements[0].toLowerCase();
    expect(pageSql).toMatch(/limit \$\d+ offset \$\d+/);
    expect(filterSql.match(/filter_ea\.crew_id is not null/g)).toHaveLength(2);
    expect(pageSql.match(/filter_ea\.crew_id is not null/g)).toHaveLength(2);
    expect(assignmentsSql).toContain("assignment_statuses as materialized");
    expect(assignmentsSql.match(/edls_assignments/g)).toHaveLength(1);
    expect(assignmentsSql.match(/filter \(where ea\.ymd/g)).toHaveLength(3);
    expect(assignmentsSql).not.toContain("join lateral");
    expect(assignmentsSql).not.toContain("where we.active = true");
  });
});