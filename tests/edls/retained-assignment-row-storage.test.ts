import { PgDialect } from "drizzle-orm/pg-core";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getClient: vi.fn(),
}));

vi.mock("../../server/storage/transaction-context", () => ({
  getClient: mocks.getClient,
  runInTransaction: (callback: () => Promise<unknown>) => callback(),
}));

vi.mock("../../server/services/component-cache", () => ({
  isComponentEnabledSync: () => false,
}));

// The assignments factory only needs crew storage for unrelated aggregate
// reads and logging descriptions. Loading the real crew module imports the
// top-level storage registry, creating a cycle while this test imports the
// assignment module directly.
vi.mock("../../server/storage/edls/crews", () => ({
  createEdlsCrewsStorage: () => ({ get: vi.fn() }),
}));

const {
  createEdlsAssignmentsStorage,
  edlsAssignmentsLoggingConfig,
} = await import("../../server/storage/edls/assignments");

const dialect = new PgDialect();

function sqlText(query: unknown): string {
  return dialect.sqlToQuery(query as never).sql.toLowerCase();
}

function sqlParams(query: unknown): unknown[] {
  return dialect.sqlToQuery(query as never).params;
}

function resolveMetadataMode(
  method: { metadataMode?: unknown } | undefined,
  args: unknown[],
  result?: unknown,
): unknown {
  const resolver = method?.metadataMode;
  if (typeof resolver === "function") return resolver(args, result);
  return resolver;
}

function harness() {
  const executed: unknown[] = [];
  const updates: Array<{ set: Record<string, unknown>; where: unknown }> = [];
  let executeRows: Array<{ rows: unknown[] }> = [];
  let insertRows: unknown[] = [];
  let insertValues: Record<string, unknown> | undefined;
  let returnedRows: unknown[][] = [];
  let conflict: Record<string, any> | undefined;

  const client = {
    execute: vi.fn(async (query: unknown) => {
      executed.push(query);
      return executeRows.shift() ?? { rows: [] };
    }),
    insert: vi.fn(() => ({
      values: vi.fn((values: Record<string, unknown>) => {
        insertValues = values;
        return {
          onConflictDoUpdate: vi.fn((options: Record<string, any>) => {
            conflict = options;
            return {
              returning: vi.fn(async () => insertRows),
            };
          }),
        };
      }),
    })),
    update: vi.fn(() => ({
      set: vi.fn((set: Record<string, unknown>) => ({
        where: vi.fn((where: unknown) => {
          updates.push({ set, where });
          return {
            returning: vi.fn(async () => returnedRows.shift() ?? []),
          };
        }),
      })),
    })),
  };

  mocks.getClient.mockReturnValue(client);

  return {
    client,
    executed,
    updates,
    setExecuteRows(rows: Array<{ rows: unknown[] }>) {
      executeRows = rows;
    },
    setInsertRows(rows: unknown[]) {
      insertRows = rows;
    },
    getInsertValues() {
      return insertValues;
    },
    setReturnedRows(rows: unknown[][]) {
      returnedRows = rows;
    },
    getConflict() {
      return conflict;
    },
  };
}

const SHEET = { id: "sheet-1", ymd: "2026-04-18", status: "lock" };
const EXISTING_ROW = {
  id: "assignment-stable-id",
  ymd: "2026-04-18",
  workerId: "worker-1",
  crewId: "crew-1",
  generationId: "generation-old",
  data: { note: "old" },
  commId: "comm-old",
  accepted: true,
  inserted: false,
};

function validCreateQueries() {
  return [
    { rows: [SHEET] },
    { rows: [{ id: "crew-2", worker_count: 5 }] },
    { rows: [{ count: "0" }] },
  ];
}

afterEach(() => {
  mocks.getClient.mockReset();
});

describe("EDLS retained assignment rows", () => {
  it("clears assignment fields in place and guards the clear by the expected crew", async () => {
    const db = harness();
    db.setReturnedRows([[{ id: EXISTING_ROW.id }]]);

    const cleared = await createEdlsAssignmentsStorage().delete(
      EXISTING_ROW.id, EXISTING_ROW.crewId, EXISTING_ROW.generationId,
    );

    expect(cleared).toBe(true);
    expect(db.client.update).toHaveBeenCalledTimes(1);
    expect(db.updates[0].set).toEqual({
      crewId: null,
      generationId: null,
      data: null,
      commId: null,
      accepted: null,
    });
    const where = sqlText(db.updates[0].where);
    expect(where).toContain("crew_id");
    expect(where).toContain("id");
    expect(sqlParams(db.updates[0].where)).toEqual([
      EXISTING_ROW.id, EXISTING_ROW.crewId, EXISTING_ROW.generationId,
    ]);
    expect(resolveMetadataMode(edlsAssignmentsLoggingConfig.methods.delete, [], true)).toBe("modified");
    expect(resolveMetadataMode(edlsAssignmentsLoggingConfig.methods.delete, [], false)).toBe("none");
  });

  it("refills the retained unique worker/date row without replacing identity and resets its old state", async () => {
    const db = harness();
    db.setExecuteRows(validCreateQueries());
    db.setInsertRows([{
      ...EXISTING_ROW,
      crewId: "crew-2",
      generationId: "generation-refilled",
      data: null,
      accepted: null,
      commId: null,
    }]);

    const refilled = await createEdlsAssignmentsStorage().create({
      workerId: EXISTING_ROW.workerId,
      ymd: EXISTING_ROW.ymd,
      crewId: "crew-2",
    }, SHEET.id);

    expect(refilled.id).toBe(EXISTING_ROW.id);
    expect(refilled.crewId).toBe("crew-2");
    expect(refilled.generationId).toBe("generation-refilled");
    expect(refilled.accepted).toBeNull();
    expect(refilled.commId).toBeNull();
    const conflict = db.getConflict()!;
    expect(conflict.target).toHaveLength(2);
    expect(conflict.set).toEqual({
      crewId: "crew-2",
      data: null,
      accepted: null,
      commId: null,
      generationId: expect.anything(),
    });
    expect(conflict.set).not.toHaveProperty("id");
    expect(sqlText(conflict.set.generationId)).toContain("gen_random_uuid()");
    expect(sqlText(db.getInsertValues()!.generationId)).toContain("gen_random_uuid()");
    expect(sqlText(conflict.setWhere)).toContain("crew_id\" is null");
    expect(resolveMetadataMode(edlsAssignmentsLoggingConfig.methods.create, [], refilled)).toBe("modified");
  });

  it("rejects an active worker/date conflict rather than overwriting the other crew's row", async () => {
    const db = harness();
    db.setExecuteRows(validCreateQueries());
    db.setInsertRows([]);

    await expect(createEdlsAssignmentsStorage().create({
      workerId: EXISTING_ROW.workerId,
      ymd: EXISTING_ROW.ymd,
      crewId: "crew-2",
    }, SHEET.id)).rejects.toMatchObject({
      name: "DomainValidationError",
      errors: [expect.objectContaining({ code: "ALREADY_ASSIGNED" })],
    });

    const conflict = db.getConflict()!;
    expect(sqlText(conflict.setWhere)).toContain("crew_id\" is null");
  });

  it("reports new rows as created, distinct from a retained row refill", async () => {
    const db = harness();
    db.setExecuteRows(validCreateQueries());
    const created = {
      id: "assignment-new-id",
      workerId: "worker-2",
      ymd: "2026-04-18",
      crewId: "crew-2",
      data: null,
      commId: null,
      accepted: null,
    };
    db.setInsertRows([{ ...created, inserted: true }]);

    const result = await createEdlsAssignmentsStorage().create({
      workerId: created.workerId,
      ymd: created.ymd,
      crewId: created.crewId,
    }, SHEET.id);

    expect(result.id).toBe(created.id);
    expect(resolveMetadataMode(edlsAssignmentsLoggingConfig.methods.create, [], result)).toBe("created");
  });

  it("refuses stale clear, edit, and message-receipt writes when the same crew row has a newer generation", async () => {
    const db = harness();
    db.setReturnedRows([[], [], []]);
    const storage = createEdlsAssignmentsStorage();

    await expect(storage.delete(EXISTING_ROW.id, "crew-1", "generation-from-stale-view")).resolves.toBe(false);
    await expect(storage.updateData(
      EXISTING_ROW.id,
      { note: "new" },
      "crew-1",
      "generation-from-stale-view",
    )).resolves.toBeUndefined();
    await expect(storage.setCommId(
      EXISTING_ROW.id,
      "comm-new",
      { note: "old" },
      "crew-1",
      "generation-from-stale-view",
    ))
      .resolves.toBe(false);

    expect(db.updates).toHaveLength(3);
    for (const { where } of db.updates) {
      const sql = sqlText(where);
      expect(sql).toContain("crew_id");
      expect(sql).toContain("id");
      expect(sqlParams(where)).toContain(EXISTING_ROW.id);
      expect(sqlParams(where)).toContain("crew-1");
      expect(sqlParams(where)).toContain("generation-from-stale-view");
    }
    expect(db.updates[0].set).toEqual({
      crewId: null,
      generationId: null,
      data: null,
      commId: null,
      accepted: null,
    });
  });

  it("does not record a worker answer from a stale or no-longer-answerable row", async () => {
    const db = harness();
    db.setExecuteRows([{ rows: [{ status: "request" }] }]);
    db.setReturnedRows([[]]);

    await expect(createEdlsAssignmentsStorage().setAccepted(
      EXISTING_ROW.id, true, EXISTING_ROW.generationId,
    )).resolves.toBe(false);

    expect(db.updates).toHaveLength(0);
    expect(sqlText(db.executed[0])).toContain("for update of s");

    db.setExecuteRows([{ rows: [{ status: "lock" }] }]);
    db.setReturnedRows([[]]);
    // The sheet still has an answerable status and the crew is unchanged, but
    // this token names the prior assignment lifetime, so the conditional
    // UPDATE must not accept the replacement assignment.
    await expect(createEdlsAssignmentsStorage().setAccepted(
      EXISTING_ROW.id, true, "generation-from-stale-view",
    )).resolves.toBe(false);

    const answerGuard = sqlText(db.updates[0].where);
    expect(answerGuard).toContain("accepted");
    expect(answerGuard).toContain("is null");
    expect(answerGuard).toContain("exists");
    expect(answerGuard).toContain("crew_id");
    expect(sqlParams(db.updates[0].where)).toContain(EXISTING_ROW.id);
    expect(sqlParams(db.updates[0].where)).toContain("generation-from-stale-view");
  });
});