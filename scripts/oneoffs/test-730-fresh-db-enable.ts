/**
 * Task #730 fresh-database verification.
 *
 * Runs the EXACT create statements pushComponentSchema would emit for the
 * EDLS component against a scratch database (scratch_730) that has none of
 * the EDLS tables, in two ways:
 *   1. OLD manifest order (edls_crews before options_edls_tasks) — expected
 *      to FAIL with `relation "options_edls_tasks" does not exist`,
 *      reproducing the production incident.
 *   2. Dependency-sorted order (what the code now does) — expected to
 *      succeed and create all 5 tables.
 * Also verifies the partial-failure retry: after the old-order failure left
 * edls_sheets behind, the sorted run still completes (CREATE IF NOT EXISTS).
 *
 * Out-of-component FK targets (workers, users, employers, options_department,
 * dispatch_job_group, facilities) are stubbed with minimal tables, mirroring
 * a real deployment where those already exist.
 */
import pg from "pg";
import { getComponentById } from "../../shared/components";
import * as mainSchema from "../../shared/schema";
import * as edlsSchema from "../../shared/schema/edls/schema";
import {
  generateCreateStatements,
  sortTablesByDependencies,
} from "../../server/services/component-schema-push";

function getSym(obj: any, description: string): symbol | undefined {
  return Object.getOwnPropertySymbols(obj).find((s) => s.description === description);
}
function tableNameOf(table: any): string | null {
  const sym = getSym(table, "drizzle:Name");
  return sym ? (table[sym] as string) : null;
}
function findTable(mod: Record<string, unknown>, name: string): any {
  for (const v of Object.values(mod)) {
    if (v && typeof v === "object" && tableNameOf(v) === name) return v;
  }
  return null;
}

const STUBS = [
  `CREATE TABLE employers (id varchar PRIMARY KEY)`,
  `CREATE TABLE workers (id varchar PRIMARY KEY)`,
  `CREATE TABLE users (id varchar PRIMARY KEY)`,
  `CREATE TABLE options_department (id varchar PRIMARY KEY)`,
  `CREATE TABLE dispatch_job_group (id varchar PRIMARY KEY)`,
  `CREATE TABLE facilities (id varchar PRIMARY KEY)`,
];

let failures = 0;
function check(cond: boolean, msg: string) {
  if (cond) console.log(`  PASS: ${msg}`);
  else {
    failures++;
    console.error(`  FAIL: ${msg}`);
  }
}

async function run() {
  const base = new URL(process.env.DATABASE_URL!);
  base.pathname = "/scratch_730";
  const client = new pg.Client({ connectionString: base.toString() });
  await client.connect();

  const edls = getComponentById("edls")!;
  const tables = edls.schemaManifest!.tables;
  const resolved = tables.map((tableName) => ({
    tableName,
    tableSchema:
      findTable(edlsSchema as any, tableName) ?? findTable(mainSchema as any, tableName),
  }));

  const statementsFor = (list: typeof resolved) => {
    const emitted = new Set<string>();
    const out: { tableName: string; sql: string }[] = [];
    for (const { tableName, tableSchema } of list) {
      for (const stmt of generateCreateStatements(tableSchema, tableName, new Map(), emitted)) {
        out.push({ tableName, sql: stmt.sql });
      }
    }
    return out;
  };

  for (const s of STUBS) await client.query(s);

  // 1. Reproduce the production failure with the OLD order.
  const oldOrder = ["edls_sheets", "edls_crews", "edls_assignments", "options_edls_tasks", "worker_edls"]
    .map((n) => resolved.find((r) => r.tableName === n)!);
  let oldOrderError = "";
  for (const { sql } of statementsFor(oldOrder)) {
    try {
      await client.query(sql);
    } catch (e: any) {
      oldOrderError = e.message;
      break;
    }
  }
  check(
    /relation "options_edls_tasks" does not exist/.test(oldOrderError),
    `old manifest order reproduces prod failure: ${oldOrderError}`,
  );
  const after = await client.query(
    `select tablename from pg_tables where tablename like '%edls%' order by 1`,
  );
  console.log(`  (tables left behind by failed run: ${after.rows.map((r) => r.tablename).join(", ")})`);

  // 2. Sorted order succeeds — and this run starts from the partial state the
  //    failed run left behind (edls_sheets already exists), covering retry.
  const sorted = sortTablesByDependencies(resolved, "edls");
  console.log(`  sorted order: ${sorted.map((t) => t.tableName).join(", ")}`);
  for (const { tableName, sql } of statementsFor(sorted)) {
    try {
      await client.query(sql);
    } catch (e: any) {
      check(false, `sorted-order statement failed for ${tableName}: ${e.message}`);
    }
  }
  const final = await client.query(
    `select tablename from pg_tables where tablename like '%edls%' order by 1`,
  );
  const names = final.rows.map((r) => r.tablename);
  check(
    tables.every((t) => names.includes(t)),
    `all 5 EDLS tables exist after sorted run (got: ${names.join(", ")})`,
  );
  const fkCount = await client.query(
    `select count(*)::int as n from information_schema.table_constraints
     where constraint_type='FOREIGN KEY' and table_name in ('edls_sheets','edls_crews','edls_assignments','options_edls_tasks','worker_edls')`,
  );
  check(fkCount.rows[0].n >= 10, `foreign keys created (${fkCount.rows[0].n})`);

  await client.end();
  console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}

run();
