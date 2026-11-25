// Protects the central notification boundary without a database or sender.
// Real transaction-context is used: only its database transport is faked.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/pg-proxy";
import { getTableColumns } from "drizzle-orm";
import { cardchecks } from "@shared/schema";

const state = vi.hoisted(() => ({
  client: undefined as any,
  row: undefined as any,
  queries: [] as string[],
  failWrite: false,
  emit: vi.fn(),
  transactions: 0,
}));
vi.mock("../../server/storage/db", () => ({
  pool: {},
  db: {
    async transaction(fn: (client: unknown) => Promise<unknown>) {
      state.transactions++;
      const before = structuredClone(state.row);
      try { return await fn(state.client); }
      catch (error) { state.row = before; throw error; }
    },
  },
}));
vi.mock("../../server/services/event-bus", () => ({
  eventBus: { emit: state.emit },
  EventType: { CARDCHECK_STATUS_CHANGE_AFTER: "cardcheck.status-change.after" },
}));
import { createCardcheckStorage, setCardcheckStorageDeps } from "../../server/storage/cardchecks";
import { isInTransaction, runInTransaction } from "../../server/storage/transaction-context";

const storage = createCardcheckStorage();
const columns = Object.entries(getTableColumns(cardchecks));
function values() {
  return columns.map(([key]) => {
    const value = state.row[key] ?? null;
    // pg's timestamp-without-time-zone wire value carries no timezone suffix.
    return key === "signedDate" && typeof value === "string" ? value.replace(/Z$/, "") : value;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  state.row = { id: "card", workerId: "worker", cardcheckDefinitionId: "definition", status: "pending",
    signedDate: null, rate: null, data: { secret: "not a token" }, esigId: null, bargainingUnitId: null, externalId: null };
  state.queries = [];
  state.failWrite = false;
  state.transactions = 0;
  state.emit.mockImplementation(() => {
    expect(isInTransaction()).toBe(false);
    return Promise.resolve();
  });
  const client = drizzle(async (query, params) => {
    state.queries.push(query);
    if (query.startsWith("update")) {
      if (state.failWrite) throw new Error("write failed");
      for (const [, column] of columns) {
        const match = query.match(new RegExp(`"${column.name}" = \\$(\\d+)`));
        if (!match || column.name === "id") continue;
        const key = columns.find(([, col]) => col === column)![0];
        state.row[key] = params[Number(match[1]) - 1];
      }
      return { rows: [values()] };
    }
    if (query.includes('"cardcheck_definitions"')) return { rows: [["Definition at write"]] };
    // Signed uniqueness validation, not the locked primary-key read.
    if (params.includes("signed")) return { rows: [] };
    return { rows: state.row ? [values()] : [] };
  });
  state.client = client;
});

describe("cardcheck storage after-commit notifications", () => {
  it("locks the old row, emits exactly one immutable safe snapshot after commit", async () => {
    await runInTransaction(async () => {
      await storage.updateCardcheck("card", { status: "revoked" });
      expect(state.emit).not.toHaveBeenCalled();
    });
    expect(state.transactions).toBe(1);
    expect(state.queries[0]).toMatch(/for update$/);
    expect(state.emit).toHaveBeenCalledExactlyOnceWith("cardcheck.status-change.after", {
      cardcheckId: "card", workerId: "worker", cardcheckDefinitionId: "definition",
      previousStatus: "pending", newStatus: "revoked",
      cardcheck: { id: "card", workerId: "worker", type: "Definition at write", status: "revoked", signedDate: null },
    });
    const payload = state.emit.mock.calls[0][1];
    expect(Object.isFrozen(payload)).toBe(true);
    expect(Object.isFrozen(payload.cardcheck)).toBe(true);
  });

  it("skips same-status edits, ordinary edits and missing/deleted rows", async () => {
    await storage.updateCardcheck("card", { status: "pending" });
    await storage.updateCardcheck("card", { rate: 5 });
    state.row = undefined;
    expect(await storage.updateCardcheck("missing", { status: "revoked" })).toBeUndefined();
    expect(state.emit).not.toHaveBeenCalled();
  });

  it("suppresses failed writes and changes rolled back by an outer importer transaction", async () => {
    state.failWrite = true;
    await expect(storage.updateCardcheck("card", { status: "revoked" })).rejects.toThrow("write failed");
    state.failWrite = false;
    await expect(runInTransaction(async () => {
      await storage.updateCardcheck("card", { status: "revoked" });
      throw new Error("import failed");
    })).rejects.toThrow("import failed");
    expect(state.row.status).toBe("pending");
    expect(state.emit).not.toHaveBeenCalled();
  });

  it("keeps snapshots distinct for later writes to the same row", async () => {
    await runInTransaction(async () => {
      await storage.updateCardcheck("card", { status: "signed" });
      await storage.updateCardcheck("card", { status: "revoked" });
    });
    expect(state.emit.mock.calls.map(call => [call[1].previousStatus, call[1].newStatus, call[1].cardcheck.status]))
      .toEqual([["pending", "signed", "signed"], ["signed", "revoked", "revoked"]]);
  });

  it("signing calls the shared update boundary and never schedules a separate sender", async () => {
    setCardcheckStorageDeps({
      getFileById: vi.fn(), updateFile: vi.fn(),
      createEsig: vi.fn().mockResolvedValue({ id: "signature" }),
    });
    const result = await storage.signCardcheck({ cardcheckId: "card", userId: "account",
      docRender: "Document", docType: "cardcheck", esigData: "signature", signatureType: "online" });
    expect(result.cardcheck.status).toBe("signed");
    expect(state.emit).toHaveBeenCalledOnce();
    expect(state.emit.mock.calls[0][1]).toMatchObject({ previousStatus: "pending", newStatus: "signed" });
    expect(JSON.stringify(state.emit.mock.calls[0][1])).not.toMatch(/Document|signature|not a token/);
  });
});
