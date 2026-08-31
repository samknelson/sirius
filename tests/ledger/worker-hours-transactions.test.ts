import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { registerWorkerHoursRoutes } from "../../server/modules/worker-hours";

/**
 * Route regression coverage for GET /api/worker-hours/:id/transactions.
 *
 * The route merges several small reference lookups (current "hour" id,
 * legacy composite "hour" key, legacy "hours" type, and BAO
 * "hour_adjustment" correcting entries) and then applies the shared
 * in-memory filter / pagination / CSV paths. Storage is stubbed so the
 * test pins the merge + dedupe + shared-path behavior, not SQL.
 */

const HOURS_ID = "11111111-1111-1111-1111-111111111111";
const WORKER_ID = "w-1";
const EMPLOYER_ID = "e-1";
const COMPOSITE_ID = `${WORKER_ID}:${EMPLOYER_ID}:2026:3`;

function tx(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    date: "2026-03-15T00:00:00.000Z",
    statementYmd: "2026-03-01",
    amount: "100.00",
    entityType: "employer",
    entityName: "Acme Grocers",
    memo: `entry ${id}`,
    referenceType: "hour",
    referenceId: HOURS_ID,
    referenceName: "",
    eaAccountName: "Hourly EA",
    workerId: WORKER_ID,
    ...over,
  };
}

// One row per lookup, plus a duplicate: the base "hour" row is ALSO
// returned by the legacy composite lookup (overlapping reference scans).
const baseRow = tx("base-1", { memo: "BAO Hourly: base charge" });
const legacyCompositeRow = tx("legacy-composite-1", {
  referenceId: COMPOSITE_ID,
  date: "2026-03-10T00:00:00.000Z",
  memo: "legacy composite charge",
});
const legacyHoursTypeRow = tx("legacy-hours-1", {
  referenceType: "hours",
  date: "2026-03-05T00:00:00.000Z",
  memo: "legacy hours-type charge",
});
const adjustmentRow = tx("adj-1", {
  referenceType: "hour_adjustment",
  date: "2026-03-20T00:00:00.000Z",
  amount: "-25.00",
  memo: "BAO Hourly Adjustment: $100.00 -> $75.00",
});

const lookups: Record<string, Record<string, any[]>> = {
  hour: {
    [HOURS_ID]: [baseRow],
    [COMPOSITE_ID]: [legacyCompositeRow, baseRow], // duplicate on purpose
  },
  hours: { [HOURS_ID]: [legacyHoursTypeRow] },
  hour_adjustment: { [HOURS_ID]: [adjustmentRow] },
};

const seenLookups: Array<{ referenceType: string; referenceId: string }> = [];

const workerHoursStorageStub = {
  getWorkerHoursById: async (id: string) =>
    id === HOURS_ID
      ? { id, workerId: WORKER_ID, employerId: EMPLOYER_ID, year: 2026, month: 3 }
      : undefined,
} as any;

const ledgerStorageStub = {
  entries: {
    getTransactions: async (filter: { referenceType: string; referenceId: string }) => {
      seenLookups.push(filter);
      return lookups[filter.referenceType]?.[filter.referenceId] ?? [];
    },
  },
} as any;

let base = "";
let closeServer: (() => Promise<void>) | undefined;

async function get(path: string) {
  return fetch(`${base}${path}`);
}

beforeAll(async () => {
  const app = express();
  const passThrough: any = (_req: any, _res: any, next: any) => next();
  const requireAuth: any = passThrough;
  const requirePermission: any = () => passThrough;
  const requireAccess: any = () => passThrough;
  registerWorkerHoursRoutes(
    app,
    requireAuth,
    requirePermission,
    requireAccess,
    workerHoursStorageStub,
    ledgerStorageStub,
  );
  const server = await new Promise<any>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  base = `http://127.0.0.1:${server.address().port}`;
  closeServer = () => new Promise((resolve) => server.close(() => resolve()));
});

afterAll(async () => {
  await closeServer?.();
});

describe("GET /api/worker-hours/:id/transactions", () => {
  it("merges base, legacy composite, legacy hours-type, and hour_adjustment rows, deduped and date-sorted", async () => {
    seenLookups.length = 0;
    const res = await get(`/api/worker-hours/${HOURS_ID}/transactions`);
    expect(res.status).toBe(200);
    const body = await res.json();

    // The duplicate base row (returned by two lookups) appears once.
    expect(body.total).toBe(4);
    expect(body.data.map((t: any) => t.id)).toEqual([
      "adj-1", // 2026-03-20, newest first
      "base-1", // 2026-03-15
      "legacy-composite-1", // 2026-03-10
      "legacy-hours-1", // 2026-03-05
    ]);

    // All four reference lookups happened, against the right ids.
    expect(seenLookups).toEqual(
      expect.arrayContaining([
        { referenceType: "hour", referenceId: HOURS_ID },
        { referenceType: "hour", referenceId: COMPOSITE_ID },
        { referenceType: "hours", referenceId: HOURS_ID },
        { referenceType: "hour_adjustment", referenceId: HOURS_ID },
      ]),
    );

    // entityTypes options come from the whole merged scope.
    expect(body.entityTypes).toEqual(["employer"]);
  });

  it("keeps adjustment rows visible through the shared view filters", async () => {
    const res = await get(
      `/api/worker-hours/${HOURS_ID}/transactions?memo=adjustment`,
    );
    const body = await res.json();
    expect(body.total).toBe(1);
    expect(body.data[0].id).toBe("adj-1");
    expect(body.data[0].referenceType).toBe("hour_adjustment");
  });

  it("filters adjustments OUT when they do not match (amount range)", async () => {
    const res = await get(
      `/api/worker-hours/${HOURS_ID}/transactions?amountMin=0`,
    );
    const body = await res.json();
    // -25.00 adjustment excluded; the three positive charges remain.
    expect(body.total).toBe(3);
    expect(body.data.map((t: any) => t.id)).not.toContain("adj-1");
  });

  it("paginates the merged set with filtered totals", async () => {
    const page1 = await (await get(
      `/api/worker-hours/${HOURS_ID}/transactions?limit=2&offset=0`,
    )).json();
    const page2 = await (await get(
      `/api/worker-hours/${HOURS_ID}/transactions?limit=2&offset=2`,
    )).json();
    expect(page1.total).toBe(4);
    expect(page1.data.map((t: any) => t.id)).toEqual(["adj-1", "base-1"]);
    expect(page2.data.map((t: any) => t.id)).toEqual([
      "legacy-composite-1",
      "legacy-hours-1",
    ]);
  });

  it("includes adjustment rows in the CSV export", async () => {
    const res = await get(
      `/api/worker-hours/${HOURS_ID}/transactions?format=csv`,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    const csv = await res.text();
    const lines = csv.trim().split("\n");
    // Header + 4 deduped rows.
    expect(lines.length).toBe(5);
    expect(csv).toContain("hour_adjustment");
    expect(csv).toContain("-25.00");
  });

  it("returns an empty result for an unknown hours entry", async () => {
    const res = await get(`/api/worker-hours/nope/transactions`);
    const body = await res.json();
    expect(body).toEqual({ data: [], total: 0 });
  });
});
