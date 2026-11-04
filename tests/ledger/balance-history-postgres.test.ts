import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";

const context = vi.hoisted(() => ({ getClient: vi.fn() }));
vi.mock("../../server/storage/transaction-context", () => ({
  getClient: context.getClient, onAfterCommit: vi.fn(), runInTransaction: vi.fn(),
}));
vi.mock("../../server/services/event-bus", () => ({ eventBus: {}, EventType: {} }));
import { createLedgerEntryStorage } from "../../server/storage/ledger";

// Real SQL in a disposable cluster, never application data.
describe.skipIf(process.env.BALANCE_HISTORY_PG !== "1")("per-account historical balance evidence", () => {
  let root: string;
  let pool: pg.Pool;
  let started = false;
  const entries = createLedgerEntryStorage();
  beforeAll(async () => {
    root = mkdtempSync(path.join(tmpdir(), "balance-history-pg-"));
    execFileSync("initdb", ["-D", `${root}/data`, "-A", "trust", "-U", "postgres"], { stdio: "ignore" });
    execFileSync("pg_ctl", ["-D", `${root}/data`, "-l", `${root}/log`, "-o", `-k ${root} -h ''`, "-w", "start"], { stdio: "ignore" });
    started = true;
    pool = new pg.Pool({ host: root, user: "postgres", database: "postgres", statement_timeout: 3000 });
    context.getClient.mockReturnValue(drizzle(pool));
    await pool.query(`
      CREATE TABLE ledger_ea(id text PRIMARY KEY, entity_type text, entity_id text, account_id text);
      CREATE TABLE ledger(id text PRIMARY KEY, ea_id text, amount numeric, date timestamp,
        statement_ymd date, charge_plugin text, reference_type text);
      INSERT INTO ledger_ea VALUES
        ('a','worker','worker','usd'), ('b','worker','worker','credit'),
        ('c','worker','worker','eur'), ('h','worker','worker','hours'),
        ('other','worker','someone-else','usd'), ('employer','employer','worker','usd');
    `);
  });
  afterAll(async () => {
    await pool?.end();
    if (started) execFileSync("pg_ctl", ["-D", `${root}/data`, "-m", "immediate", "-w", "stop"], { stdio: "ignore" });
    if (root) rmSync(root, { recursive: true, force: true });
  });
  beforeEach(async () => { await pool.query("TRUNCATE ledger"); });
  async function post(ea: string, amounts: string[]) {
    for (const [i, amount] of amounts.entries()) {
      await pool.query(`INSERT INTO ledger VALUES ($1,$2,$3,'2026-01-01','2026-01-01',
        'sitespecific-bao-ee-contribution',null)`, [`${ea}-${i}`, ea, amount]);
    }
  }
  const read = () => entries.hasNonzeroBalanceHistory("worker", "worker", ["usd", "credit", "eur"]);
  it("confirms empty and zero-only history, ignoring other workers/types and hours", async () => {
    expect(await read()).toBe(false);
    await post("a", ["0.00", "-0.00"]);
    await post("h", ["100"]);
    await post("other", ["100"]);
    await post("employer", ["100"]);
    expect(await read()).toBe(false);
    expect(await entries.hasNonzeroBalanceHistory("worker", "worker", [])).toBe(false);
  });
  it.each([["12.00", "-12.00"], ["-12.00", "12.00"], ["9007199254740992.01", "-9007199254740992.01"]])(
    "retains same-month settled debit/credit with exact numeric arithmetic (%s)", async (first, second) => {
      await post("a", [first, second]);
      expect(await read()).toBe(true);
      const monthly = await entries.getMonthlyAccountHistoryByEntityAndAccount("worker", "worker", ["usd"], []);
      expect(monthly).toEqual([expect.objectContaining({ hadNonzeroBalance: true, balanceDelta: "0.00" })]);
    },
  );
  it("does not cancel evidence across accounts or currencies", async () => {
    await post("a", ["12"]);
    await post("b", ["-6"]);
    await post("c", ["-6"]);
    expect(await read()).toBe(true);
  });
  it("rejects failed and unreadable reads rather than answering false", async () => {
    context.getClient.mockReturnValueOnce({ execute: async () => ({ rows: [] }) });
    await expect(read()).rejects.toThrow("evidence is unavailable");
    context.getClient.mockReturnValueOnce({ execute: async () => { throw new Error("read failed"); } });
    await expect(read()).rejects.toThrow("read failed");
  });
});
