#!/usr/bin/env npx tsx
/**
 * Regression test for core migration 1013
 * (scripts/migrate/core/1013_charge_plugin_account_name_states.ts).
 *
 * The migration upgrades the LEGACY charge_plugin_configs table. On fresh
 * schema-only databases (e.g. Neon branches created from schema alone) that
 * table never existed — the unified plugin-config path (1015/1016) is used
 * instead — so 1013 must detect the absent table and skip entirely instead
 * of failing the whole migration run.
 *
 * This test stubs db.execute (no real database is touched) and runs the
 * registered 1013 up() through both branches:
 *
 *   1. table ABSENT  → exactly one information_schema.tables probe, zero
 *                      writes (no ALTER/UPDATE/CREATE), clean return.
 *   2. table PRESENT → the full legacy upgrade path runs: add name+account
 *                      columns, both account backfills, account FK, unique
 *                      constraint swap (drop 3-col, add 4-col), and the
 *                      charge_plugin_states table.
 *
 * Run: npx tsx scripts/oneoffs/smoke-test-migration-1013-guard.ts
 */
// Import storage/database FIRST so the (circular) module graph initializes in
// app boot order (see smoke-test-election.ts).
import "../../server/storage/database";
import { db } from "../../server/db";
import { PgDialect } from "drizzle-orm/pg-core";
import { getMigrations } from "../../server/services/migration-runner";
import "../migrate/core/1013_charge_plugin_account_name_states";

const dialect = new PgDialect();

let failures = 0;
function check(label: string, ok: boolean, detail?: unknown) {
  if (ok) {
    console.log(`  PASS  ${label}`);
  } else {
    failures++;
    console.error(`  FAIL  ${label}`, detail !== undefined ? detail : "");
  }
}

const migration = getMigrations().find((m) => m.version === 1013);
if (!migration) {
  console.error("FAIL: migration 1013 is not registered");
  process.exit(1);
}
check("migration 1013 registered", migration.name === "charge_plugin_account_name_states");

interface Scenario {
  tableExists: boolean;
  /** column name -> exists */
  columns: Record<string, boolean>;
  /** constraint name -> exists */
  constraints: Record<string, boolean>;
}

let scenario: Scenario;
let executed: { text: string; params: unknown[] }[] = [];

// Stub db.execute: answer the existence probes from the scenario, record
// every statement, and no-op all writes.
(db as any).execute = async (query: any) => {
  const { sql: text, params } = dialect.sqlToQuery(query);
  executed.push({ text, params });

  if (text.includes("information_schema.tables")) {
    return { rows: [{ exists: scenario.tableExists }] };
  }
  if (text.includes("information_schema.columns")) {
    const column = String(params[1]);
    return { rows: [{ exists: scenario.columns[column] === true }] };
  }
  if (text.includes("pg_constraint")) {
    const name = String(params[0]);
    return { rows: [{ exists: scenario.constraints[name] === true }] };
  }
  return { rows: [] };
};

function writes(): { text: string; params: unknown[] }[] {
  return executed.filter((q) => /^\s*(ALTER|UPDATE|CREATE|DROP|INSERT|DELETE)/i.test(q.text));
}

// ---------------------------------------------------------------------------
// Branch 1: charge_plugin_configs ABSENT (schema-only database) → skip.
// ---------------------------------------------------------------------------
console.log("Branch 1: legacy table absent → guard skips the upgrade");
scenario = { tableExists: false, columns: {}, constraints: {} };
executed = [];
await migration.up();
check("exactly one statement executed (the table probe)", executed.length === 1, executed.map((q) => q.text));
check(
  "the single statement is the information_schema.tables probe for charge_plugin_configs",
  executed.length === 1 &&
    executed[0].text.includes("information_schema.tables") &&
    executed[0].params.includes("charge_plugin_configs"),
  executed[0],
);
check("no writes (ALTER/UPDATE/CREATE/DROP) were issued", writes().length === 0, writes());

// ---------------------------------------------------------------------------
// Branch 2: charge_plugin_configs PRESENT → full legacy upgrade path.
// ---------------------------------------------------------------------------
console.log("Branch 2: legacy table present → full upgrade path runs");
scenario = {
  tableExists: true,
  // Pre-1013 legacy table: neither new column exists yet.
  columns: { name: false, account: false },
  constraints: {
    // FK and new 4-column unique don't exist yet; old 3-column unique does.
    charge_plugin_configs_account_ledger_accounts_id_fk: false,
    charge_plugin_configs_plugin_id_scope_employer_id_unique: true,
    charge_plugin_configs_plugin_id_scope_employer_id_account_unique: false,
  },
};
executed = [];
await migration.up();

const texts = executed.map((q) => q.text);
const has = (re: RegExp) => texts.some((t) => re.test(t));

check("adds name column", has(/ALTER TABLE charge_plugin_configs ADD COLUMN name text/i));
check("adds account column", has(/ALTER TABLE charge_plugin_configs ADD COLUMN account varchar/i));
check(
  "backfills single-account plugin accounts from settings.accountId",
  has(/UPDATE charge_plugin_configs[\s\S]*settings->>'accountId'/i),
);
check(
  "backfills pension SLA account from the system variable",
  executed.some(
    (q) =>
      /UPDATE charge_plugin_configs/i.test(q.text) &&
      q.params.includes("gbhet_pension_sla_account_id"),
  ),
);
check(
  "adds the account FK constraint",
  has(/ADD CONSTRAINT "?charge_plugin_configs_account_ledger_accounts_id_fk"?[\s\S]*FOREIGN KEY \(account\) REFERENCES ledger_accounts\(id\)/i),
);
check(
  "drops the old 3-column unique constraint",
  has(/DROP CONSTRAINT "?charge_plugin_configs_plugin_id_scope_employer_id_unique"?/i),
);
check(
  "adds the new 4-column unique constraint (includes account)",
  has(/ADD CONSTRAINT "?charge_plugin_configs_plugin_id_scope_employer_id_account_unique"?[\s\S]*UNIQUE \(plugin_id, scope, employer_id, account\)/i),
);
check(
  "creates charge_plugin_states master-enable table",
  has(/CREATE TABLE IF NOT EXISTS charge_plugin_states/i),
);
check("upgrade path issues writes (guard did not skip)", writes().length >= 7, writes().length);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
