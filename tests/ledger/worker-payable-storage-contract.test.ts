import { drizzle } from "drizzle-orm/pg-proxy";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getClient: vi.fn() }));

vi.mock("../../server/storage/transaction-context", () => ({
  getClient: mocks.getClient,
  onAfterCommit: vi.fn(),
}));
vi.mock("../../server/services/event-bus", () => ({
  eventBus: { emit: vi.fn() },
  EventType: {},
}));

const { createLedgerEaStorage, createLedgerEntryStorage } = await import(
  "../../server/storage/ledger"
);

type FixtureEa = {
  id: string;
  accountId: string;
  entityType: string;
  entityId: string;
  data: null;
};

type FixtureEntry = { eaId: string; amount: string };

const fixture = {
  eas: [
    {
      id: "ea-dp",
      accountId: "account-dp",
      entityType: "worker",
      entityId: "worker-1",
      data: null,
    },
    {
      id: "ea-empty",
      accountId: "account-empty",
      entityType: "worker",
      entityId: "worker-1",
      data: null,
    },
    {
      id: "ea-unrelated-account",
      accountId: "account-health",
      entityType: "worker",
      entityId: "worker-1",
      data: null,
    },
    {
      id: "ea-other-worker",
      accountId: "account-dp",
      entityType: "worker",
      entityId: "worker-2",
      data: null,
    },
    {
      id: "ea-other-type",
      accountId: "account-dp",
      entityType: "employer",
      entityId: "worker-1",
      data: null,
    },
  ] satisfies FixtureEa[],
  entries: [
    { eaId: "ea-dp", amount: "75.00" },
    { eaId: "ea-dp", amount: "-10.00" },
    { eaId: "ea-dp", amount: "20.00" },
    { eaId: "ea-unrelated-account", amount: "999.00" },
    { eaId: "ea-other-worker", amount: "700.00" },
    { eaId: "ea-other-type", amount: "900.00" },
  ] satisfies FixtureEntry[],
};

type CapturedQuery = {
  sql: string;
  params: unknown[];
  method: "all" | "execute";
};

function compact(sql: string): string {
  return sql.replace(/\s+/g, " ").trim();
}

function hasColumnPredicate(sql: string, column: string): boolean {
  return new RegExp(`"ledger_ea"\\."${column}" (?:=|in \\()`).test(sql);
}

function eaBalance(eaId: string): string | null {
  const entries = fixture.entries.filter((entry) => entry.eaId === eaId);
  if (entries.length === 0) return null;
  return entries
    .reduce((total, entry) => total + Number(entry.amount), 0)
    .toFixed(2);
}

/**
 * Executes the small set of generated SELECTs used by this contract against
 * fixture rows. Crucially, a fixture filter is only applied when its SQL
 * predicate is present, so removing a storage WHERE condition changes the
 * returned rows rather than receiving a canned successful response.
 */
function fixtureClient(queries: CapturedQuery[]) {
  return drizzle(async (rawSql, params, method) => {
    const sql = compact(rawSql);
    queries.push({ sql, params: [...params], method });

    if (
      sql.includes('from "ledger_ea"') &&
      sql.includes('COALESCE(SUM("ledger"."amount"), 0)')
    ) {
      let eas = [...fixture.eas];
      if (hasColumnPredicate(sql, "entity_type")) {
        eas = eas.filter((ea) => ea.entityType === params[0]);
      }
      if (hasColumnPredicate(sql, "entity_id")) {
        eas = eas.filter((ea) => ea.entityId === params[1]);
      }
      const joined = sql.includes(
        'left join "ledger" on "ledger"."ea_id" = "ledger_ea"."id"',
      );
      return {
        rows: eas.map((ea) => [
          ea.id,
          ea.accountId,
          ea.entityType,
          ea.entityId,
          ea.data,
          joined ? eaBalance(ea.id) ?? "0.00" : "0.00",
        ]),
      };
    }

    if (sql.includes('from "ledger"') && !sql.includes('from "ledger_ea"')) {
      const entries = sql.includes('"ledger"."ea_id" = $1')
        ? fixture.entries.filter((entry) => entry.eaId === params[0])
        : fixture.entries;
      const total = entries.length
        ? entries.reduce((sum, entry) => sum + Number(entry.amount), 0).toFixed(2)
        : null;
      return { rows: [[total]] };
    }

    if (
      sql.includes('from "ledger_ea"') &&
      sql.includes('sum("ledger"."amount")')
    ) {
      let eas = [...fixture.eas];
      if (hasColumnPredicate(sql, "entity_type")) {
        eas = eas.filter((ea) => ea.entityType === params[0]);
      }
      if (hasColumnPredicate(sql, "entity_id")) {
        eas = eas.filter((ea) => (params.slice(1, 2) as string[]).includes(ea.entityId));
      }
      if (hasColumnPredicate(sql, "account_id")) {
        eas = eas.filter((ea) =>
          (params.slice(2) as string[]).includes(ea.accountId),
        );
      }

      const joined = sql.includes(
        'left join "ledger" on "ledger"."ea_id" = "ledger_ea"."id"',
      );
      const groups = new Map<string, { ea: FixtureEa; total: number; hasEntry: boolean }>();
      for (const ea of eas) {
        const key = `${ea.entityId}:${ea.accountId}`;
        const group = groups.get(key) ?? { ea, total: 0, hasEntry: false };
        if (joined) {
          for (const entry of fixture.entries.filter((row) => row.eaId === ea.id)) {
            group.total += Number(entry.amount);
            group.hasEntry = true;
          }
        }
        groups.set(key, group);
      }
      return {
        rows: [...groups.values()].map(({ ea, total, hasEntry }) => [
          ea.entityId,
          ea.accountId,
          hasEntry ? total.toFixed(2) : null,
        ]),
      };
    }

    throw new Error(`Unexpected generated SQL: ${sql}`);
  });
}

describe("worker payable ledger storage contract", () => {
  beforeEach(() => {
    mocks.getClient.mockReset();
  });

  it("executes scoped generated SQL for list, selected EA, and account balances", async () => {
    const queries: CapturedQuery[] = [];
    mocks.getClient.mockReturnValue(fixtureClient(queries));

    const eaStorage = createLedgerEaStorage();
    const entryStorage = createLedgerEntryStorage();

    const listRows = await eaStorage.getByEntityWithBalance("worker", "worker-1");
    const selectedBalance = await eaStorage.getBalance("ea-dp");
    const dpRows = await entryStorage.getBalancesByEntityAndAccount(
      "worker",
      ["worker-1"],
      ["account-dp", "account-empty"],
    );

    expect(listRows).toEqual([
      {
        ...fixture.eas[0],
        balance: "85.00",
      },
      {
        ...fixture.eas[1],
        balance: "0.00",
      },
      {
        ...fixture.eas[2],
        balance: "999.00",
      },
    ]);
    expect(selectedBalance).toBe("85.00");
    expect(dpRows).toEqual([
      { entityId: "worker-1", accountId: "account-dp", total: "85.00" },
      { entityId: "worker-1", accountId: "account-empty", total: "0.00" },
    ]);

    expect(queries).toHaveLength(3);
    expect(queries.map(({ params }) => params)).toEqual([
      ["worker", "worker-1"],
      ["ea-dp"],
      ["worker", "worker-1", "account-dp", "account-empty"],
    ]);

    const [listQuery, selectedQuery, accountQuery] = queries.map(({ sql }) => sql);
    expect(listQuery).toContain(
      'left join "ledger" on "ledger"."ea_id" = "ledger_ea"."id"',
    );
    expect(listQuery).toContain(
      'where ("ledger_ea"."entity_type" = $1 and "ledger_ea"."entity_id" = $2)',
    );
    expect(listQuery).toContain('group by "ledger_ea"."id"');

    expect(selectedQuery).toContain('from "ledger"');
    expect(selectedQuery).toContain('where "ledger"."ea_id" = $1');

    expect(accountQuery).toContain(
      'left join "ledger" on "ledger"."ea_id" = "ledger_ea"."id"',
    );
    expect(accountQuery).toContain(
      'where ("ledger_ea"."entity_type" = $1 and "ledger_ea"."entity_id" in ($2) and "ledger_ea"."account_id" in ($3, $4))',
    );
    expect(accountQuery).toContain(
      'group by "ledger_ea"."entity_id", "ledger_ea"."account_id"',
    );
  });
});