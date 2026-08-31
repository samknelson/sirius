/**
 * The Freeman EDLS migration fetches legacy rows into a staging table. What
 * makes that risky is not the copying — it is the legacy service's narrowness:
 * it cannot filter, cannot count, and cannot say whether more rows exist, so
 * "the page came back empty" is both how a table ends and how a failure looks.
 *
 * These tests pin the reading rules that follow from that: what ends a walk,
 * what a refusal must NOT be mistaken for, which rows belong to a sheet, and
 * the promise that a sweep which could not read everything stages nothing.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

interface StubPage {
  /** Rows the legacy service returns for this page. */
  rows?: Row[];
  /** Set to make this page a refusal instead. */
  refuse?: "http" | "inner" | "shapeless";
}

const h = {
  /** table -> the pages it answers with, in order. */
  pages: new Map<string, StubPage[]>(),
  /** Every raw-data request the code made, in order. */
  requests: [] as Array<{ table: string; order: string; limit: string; offset: string }>,
  storage: {
    freemanEdlsMigrateStaging: {
      upsertNodes: vi.fn(async (records: unknown[]) => records.length),
      deleteNidsNotIn: vi.fn(async () => 0),
      setFieldRows: vi.fn(async () => true),
      listNids: vi.fn(async () => [] as string[]),
      listAll: vi.fn(async () => [] as unknown[]),
      count: vi.fn(async () => 0),
      deleteAll: vi.fn(async () => 0),
      tableExists: vi.fn(async () => true),
    },
  },
};

vi.mock("../../server/storage", () => ({ storage: h.storage }));

/**
 * The write phases run inside one transaction so a failure partway through
 * rolls back. Here it is a pass-through that records that it wrapped the
 * writes, and can be made to fail.
 */
const inTransaction = vi.fn(async (fn: () => Promise<unknown>) => fn());
vi.mock("../../server/storage/transaction-context", () => ({
  runInTransaction: (fn: () => Promise<unknown>) => inTransaction(fn),
}));

vi.mock("../../server/modules/sitespecific/freeman/edls-migrate/client", () => ({
  freemanEdlsMigrateRequest: vi.fn(async (spec: { action: string; args: unknown[] }) => {
    const [table, order, limit, offset] = spec.args.map(String);
    h.requests.push({ table, order, limit, offset });

    const queue = h.pages.get(table) ?? [];
    const index = Number(offset) / Number(limit);
    const page = queue[index] ?? { rows: [] };

    if (page.refuse === "http") {
      return {
        success: false,
        outcome: "http_error",
        action: spec.action,
        error: "HTTP 500 Internal Server Error",
        timestamp: new Date().toISOString(),
        durationMs: 1,
      };
    }
    if (page.refuse === "inner") {
      return {
        success: true,
        outcome: "success",
        action: spec.action,
        data: { success: true, data: { success: false, records: [] } },
        timestamp: new Date().toISOString(),
        durationMs: 1,
      };
    }
    if (page.refuse === "shapeless") {
      return {
        success: true,
        outcome: "success",
        action: spec.action,
        data: { success: true, data: { success: true } },
        timestamp: new Date().toISOString(),
        durationMs: 1,
      };
    }
    return {
      success: true,
      outcome: "success",
      action: spec.action,
      data: {
        success: true,
        data: { success: true, table, order, limit, offset, records: page.rows ?? [] },
      },
      timestamp: new Date().toISOString(),
      durationMs: 1,
    };
  }),
}));

const { readLegacyTable, extractPageRows } = await import(
  "../../server/modules/sitespecific/freeman/edls-migrate/paging"
);
const {
  runFreemanEdlsNodeSweep,
  runFreemanEdlsFieldSweep,
  FREEMAN_EDLS_FIELD_TABLES,
} = await import("../../server/modules/sitespecific/freeman/edls-migrate/sweep");

function sheetNode(nid: string, extra: Row = {}): Row {
  return { nid, type: "sirius_edls_sheet", title: `Sheet ${nid}`, ...extra };
}

function fieldRow(nid: string, extra: Row = {}): Row {
  return {
    entity_type: "node",
    bundle: "sirius_edls_sheet",
    deleted: "0",
    entity_id: nid,
    revision_id: nid,
    language: "und",
    delta: "0",
    ...extra,
  };
}

beforeEach(() => {
  h.pages.clear();
  h.requests.length = 0;
  vi.clearAllMocks();
  inTransaction.mockImplementation(async (fn: () => Promise<unknown>) => fn());
  h.storage.freemanEdlsMigrateStaging.upsertNodes.mockImplementation(
    async (records: unknown[]) => records.length,
  );
  h.storage.freemanEdlsMigrateStaging.setFieldRows.mockResolvedValue(true);
  h.storage.freemanEdlsMigrateStaging.listNids.mockResolvedValue([]);
  h.storage.freemanEdlsMigrateStaging.deleteNidsNotIn.mockResolvedValue(0);
});

describe("reading a legacy table", () => {
  it("keeps paging while pages are full and stops on the first short one", async () => {
    h.pages.set("t", [
      { rows: [{ id: "1" }, { id: "2" }] },
      { rows: [{ id: "3" }, { id: "4" }] },
      { rows: [{ id: "5" }] },
    ]);

    const seen: Row[] = [];
    const read = await readLegacyTable({
      table: "t",
      orderColumn: "id",
      pageSize: 2,
      onRows: (rows) => {
        seen.push(...rows);
      },
    });

    expect(read.complete).toBe(true);
    expect(read.stoppedBecause).toBe("complete");
    expect(read.pages).toBe(3);
    expect(read.rowsRead).toBe(5);
    expect(seen).toHaveLength(5);
    expect(h.requests.map((r) => r.offset)).toEqual(["0", "2", "4"]);
  });

  it("reports a refusal as a refusal, never as the end of the table", async () => {
    h.pages.set("t", [{ rows: [{ id: "1" }, { id: "2" }] }, { refuse: "http" }]);

    const read = await readLegacyTable({
      table: "t",
      orderColumn: "id",
      pageSize: 2,
      onRows: () => {},
    });

    expect(read.complete).toBe(false);
    expect(read.stoppedBecause).toBe("refused");
    expect(read.error).toContain("500");
    // It stopped at the failure rather than walking on.
    expect(h.requests).toHaveLength(2);
  });

  it("stops at the page cap and says the table was bigger than expected", async () => {
    h.pages.set("t", Array.from({ length: 10 }, () => ({ rows: [{ id: "x" }, { id: "y" }] })));

    const read = await readLegacyTable({
      table: "t",
      orderColumn: "id",
      pageSize: 2,
      maxPages: 3,
      onRows: () => {},
    });

    expect(read.complete).toBe(false);
    expect(read.stoppedBecause).toBe("page_cap");
    expect(read.pages).toBe(3);
  });

  it("treats a 200 whose envelope failed, or carries no rows, as a refusal", async () => {
    const innerFailure = extractPageRows({
      success: true,
      outcome: "success",
      action: "a",
      data: { success: true, data: { success: false, records: [] } },
      timestamp: "",
      durationMs: 0,
    } as never);
    expect(innerFailure.ok).toBe(false);

    const shapeless = extractPageRows({
      success: true,
      outcome: "success",
      action: "a",
      data: { success: true, data: { success: true } },
      timestamp: "",
      durationMs: 0,
    } as never);
    expect(shapeless.ok).toBe(false);
    expect(shapeless.rows).toEqual([]);

    const noVerdict = extractPageRows({
      success: true,
      outcome: "success",
      action: "a",
      data: { success: true, data: { records: [{ nid: "1" }] } },
      timestamp: "",
      durationMs: 0,
    } as never);
    // No stated verdict is not a stated success.
    expect(noVerdict.ok).toBe(false);
  });

  it("refuses a page carrying something that is not a row", () => {
    const page = extractPageRows({
      success: true,
      outcome: "success",
      action: "a",
      data: { success: true, data: { success: true, records: [{ nid: "1" }, "Access denied"] } },
      timestamp: "",
      durationMs: 0,
    } as never);

    // Dropping the bad member would shorten the page, and a short page is how
    // the walk learns the table ended — the whole read would truncate.
    expect(page.ok).toBe(false);
    expect(page.rows).toEqual([]);
  });

  it("does not end the walk early because a full page held an unreadable row", async () => {
    h.pages.set("t", [
      { rows: [{ id: "1" }, { id: "2" }] },
      { rows: [{ id: "3" }, "nonsense" as unknown as Row] },
      { rows: [{ id: "5" }] },
    ]);

    const read = await readLegacyTable({
      table: "t",
      orderColumn: "id",
      pageSize: 2,
      onRows: () => {},
    });

    expect(read.complete).toBe(false);
    expect(read.stoppedBecause).toBe("refused");
  });
});

describe("the sheet-list sweep", () => {
  it("stages only the nodes that are EDLS sheets", async () => {
    h.pages.set("node", [
      {
        rows: [
          sheetNode("100"),
          { nid: "101", type: "grievance_basic_page", title: "Not a sheet" },
          sheetNode("102"),
        ],
      },
    ]);

    const report = await runFreemanEdlsNodeSweep();

    expect(report.complete).toBe(true);
    expect(report.nodesRead).toBe(3);
    expect(report.sheetsFound).toBe(2);
    const staged = h.storage.freemanEdlsMigrateStaging.upsertNodes.mock.calls[0][0] as unknown as Array<{
      nid: string;
      type: string;
      node: Row;
    }>;
    expect(staged.map((s) => s.nid)).toEqual(["100", "102"]);
    // The node row is kept whole: mapping it is the next stage's decision.
    expect(staged[0].node).toMatchObject({ nid: "100", title: "Sheet 100" });
  });

  it("stages nothing when the node table could not be read in full", async () => {
    h.pages.set("node", [{ refuse: "http" }]);

    const report = await runFreemanEdlsNodeSweep();

    expect(report.complete).toBe(false);
    expect(report.sheetsStaged).toBe(0);
    expect(h.storage.freemanEdlsMigrateStaging.upsertNodes).not.toHaveBeenCalled();
  });

  it("drops staged rows the legacy system no longer calls sheets", async () => {
    // A node that was a sheet last sweep has been retyped since.
    h.pages.set("node", [
      { rows: [sheetNode("100"), { nid: "200", type: "grievance_basic_page" }] },
    ]);
    h.storage.freemanEdlsMigrateStaging.deleteNidsNotIn.mockResolvedValueOnce(1);

    const report = await runFreemanEdlsNodeSweep();

    expect(report.complete).toBe(true);
    expect(report.sheetsRemoved).toBe(1);
    // The whole node table was read, so this IS the set of sheets.
    expect(h.storage.freemanEdlsMigrateStaging.deleteNidsNotIn).toHaveBeenCalledWith(["100"]);
    // And the removal shares the write's transaction.
    expect(inTransaction).toHaveBeenCalledTimes(1);
  });

  it("does not prune when the node table could not be read in full", async () => {
    h.pages.set("node", [{ refuse: "http" }]);

    await runFreemanEdlsNodeSweep();

    expect(h.storage.freemanEdlsMigrateStaging.deleteNidsNotIn).not.toHaveBeenCalled();
  });

  it("writes inside one transaction, so a failed write stages nothing", async () => {
    h.pages.set("node", [{ rows: [sheetNode("100")] }]);
    h.storage.freemanEdlsMigrateStaging.upsertNodes.mockRejectedValueOnce(
      new Error("connection lost"),
    );

    await expect(runFreemanEdlsNodeSweep()).rejects.toThrow("connection lost");
    expect(inTransaction).toHaveBeenCalledTimes(1);
  });
});

describe("the sheet-field sweep", () => {
  beforeEach(() => {
    h.storage.freemanEdlsMigrateStaging.listNids.mockResolvedValue(["100", "200"]);
    for (const { table } of FREEMAN_EDLS_FIELD_TABLES) {
      h.pages.set(table, [{ rows: [] }]);
    }
  });

  it("refuses to run before anything is staged", async () => {
    h.storage.freemanEdlsMigrateStaging.listNids.mockResolvedValue([]);

    const report = await runFreemanEdlsFieldSweep();

    expect(report.complete).toBe(false);
    expect(report.error).toMatch(/node sweep/i);
    expect(h.requests).toHaveLength(0);
    expect(h.storage.freemanEdlsMigrateStaging.setFieldRows).not.toHaveBeenCalled();
  });

  it("keeps only the rows belonging to a staged sheet, and keeps every delta", async () => {
    const statusTable = FREEMAN_EDLS_FIELD_TABLES[0].table;
    h.pages.set(statusTable, [
      {
        rows: [
          fieldRow("100", { field_sirius_edls_sheet_status_value: "draft" }),
          // Another entity type shares this field table.
          fieldRow("100", { entity_type: "user", bundle: "user" }),
          // A deleted field row lingers in the table.
          fieldRow("100", { deleted: "1" }),
          // A node that is not a staged sheet.
          fieldRow("999"),
          // A second value of a multi-valued field.
          fieldRow("100", { delta: "1", field_sirius_edls_sheet_status_value: "lock" }),
        ],
      },
    ]);

    const report = await runFreemanEdlsFieldSweep();

    expect(report.complete).toBe(true);
    const perStatus = report.perTable.find((t) => t.table === statusTable)!;
    expect(perStatus.rowsRead).toBe(5);
    expect(perStatus.rowsKept).toBe(2);

    const calls = h.storage.freemanEdlsMigrateStaging.setFieldRows.mock.calls as unknown as Array<
      [string, Record<string, Row[]>]
    >;
    const forSheet = calls.find(([nid]) => nid === "100")![1];
    expect(forSheet[statusTable]).toHaveLength(2);
    expect(forSheet[statusTable].map((r) => r.delta)).toEqual(["0", "1"]);
  });

  it("writes an empty field set for a staged sheet no field table mentioned", async () => {
    const statusTable = FREEMAN_EDLS_FIELD_TABLES[0].table;
    h.pages.set(statusTable, [{ rows: [fieldRow("100")] }]);

    await runFreemanEdlsFieldSweep();

    const calls = h.storage.freemanEdlsMigrateStaging.setFieldRows.mock.calls as unknown as Array<
      [string, Record<string, Row[]>]
    >;
    expect(calls.map(([nid]) => nid).sort()).toEqual(["100", "200"]);
    // Written, not skipped: it clears whatever an earlier sweep left there.
    expect(calls.find(([nid]) => nid === "200")![1]).toEqual({});
  });

  it("writes nothing at all when one field table could not be read", async () => {
    const refusedTable = FREEMAN_EDLS_FIELD_TABLES[2].table;
    h.pages.set(FREEMAN_EDLS_FIELD_TABLES[0].table, [{ rows: [fieldRow("100")] }]);
    h.pages.set(refusedTable, [{ refuse: "inner" }]);

    const report = await runFreemanEdlsFieldSweep();

    expect(report.complete).toBe(false);
    expect(report.error).toContain(refusedTable);
    expect(h.storage.freemanEdlsMigrateStaging.setFieldRows).not.toHaveBeenCalled();
    // It gave up at the refusal instead of reading the remaining tables.
    const tablesTried = new Set(h.requests.map((r) => r.table));
    expect(tablesTried.has(FREEMAN_EDLS_FIELD_TABLES[3].table)).toBe(false);
  });

  it("writes every sheet's field rows inside one transaction", async () => {
    await runFreemanEdlsFieldSweep();

    expect(inTransaction).toHaveBeenCalledTimes(1);
    expect(h.storage.freemanEdlsMigrateStaging.setFieldRows).toHaveBeenCalledTimes(2);
  });

  it("reads every field table by the node id column", async () => {
    await runFreemanEdlsFieldSweep();

    const tablesTried = h.requests.map((r) => r.table);
    for (const { table } of FREEMAN_EDLS_FIELD_TABLES) {
      expect(tablesTried).toContain(table);
    }
    expect(new Set(h.requests.map((r) => r.order))).toEqual(new Set(["entity_id"]));
  });
});
