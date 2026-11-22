/** Execute the actual stage CLI with a synthetic source adapter, never live S1. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { runInThisContext } from "node:vm";
import ts from "typescript";
import pg from "pg";
import { getEnvironmentVariable } from "../lib/script-env";

const url = new URL(getEnvironmentVariable("EXTERNAL_DATABASE_URL")!);
if (url.hostname !== "127.0.0.1" || url.pathname !== "/s1_file_target") throw new Error("fixture_target_refused");
const target = new pg.Client({ connectionString: url.toString() });
url.pathname = "/s1_file_source";
const source = new pg.Pool({ connectionString: url.toString() });
await target.connect();
try {
  assert.equal((await target.query("SELECT current_database() AS n")).rows[0].n, "s1_file_target");
  assert.equal((await source.query("SELECT current_database() AS n")).rows[0].n, "s1_file_source");
  const snapshot = async () => JSON.stringify({
    rows: (await target.query("SELECT * FROM s1_staging.raw_file_managed ORDER BY fid")).rows,
    proof: (await target.query("SELECT * FROM s1_staging.file_inventory_evidence")).rows,
  });
  const before = await snapshot();
  let counts = 0;
  const adapter = {
    query: async (statement: string, params?: unknown[]) => {
      if (!statement.includes("file_managed")) return [/COUNT\(\*\)/i.test(statement) ? [{ n: 0 }] : []];
      let i = 0;
      const result = await source.query(statement.replace(/\?/g, () => `$${++i}`), params);
      if (statement.includes("COUNT(*)") && ++counts % 2 === 0) result.rows[0].n = 999;
      return [result.rows];
    },
    end: () => source.end(),
  };
  const entry = new URL("../stage.ts", import.meta.url);
  const require = createRequire(entry);
  const text = await readFile(entry, "utf8");
  // Retain the CLI's catch, result writing and exit-code path; await its completion.
  assert.equal(text.split("main().catch(").length, 2);
  const compiled = ts.transpileModule(text.replace("main().catch(", "const completion = main().catch("),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  process.argv = [process.argv[0], fileURLToPath(entry), "--mode", "daily", "--raw-only", "--skip-terms"];
  const execute = runInThisContext(`(function(require,exports,module){${compiled}\nreturn completion;})`);
  await execute((id: string) => id === "./lib/s1" ? {
    createS1Pool: () => adapter,
    listNodeBundles: async () => [],
    buildFieldCatalog: async () => ({ catalog: new Map(), source: "synthetic" }),
  } : require(id), {}, { exports: {} });
  assert.equal(process.exitCode ?? 0, 0);
  assert.equal(counts, 6);
  assert.equal(await snapshot(), before);
  const report = (await target.query("SELECT report FROM s1_staging.runs ORDER BY id DESC LIMIT 1")).rows[0].report;
  assert.equal(report.mismatches, 0);
  assert.equal(report.rawUserTables.find((r: { table: string }) => r.table === "file_managed").status, "skipped_changing");
  assert.ok(report.rawUserTables.filter((r: { table: string }) => r.table !== "file_managed").every((r: { staged: number }) => r.staged === 0));
  console.log("synthetic stage exited zero; changing inventory retained and files admission blocked");
} finally { await target.end(); }
