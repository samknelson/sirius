/**
 * DEV-ONLY end-to-end rehearsal of the ONE-COMMAND SYNC (RUNBOOK §11) on a
 * THROWAWAY database — the task-296 "rehearsal validation": proves the
 * orchestrator converges the whole fleet BEYOND parity.
 *
 *   1. setup    — create throwaway DB on the local PG host (DATABASE_URL),
 *                 bootstrap-target --wipe, enable-cardcheck, seed-fund-config.
 *   2. lock     — hold advisory lock 727001 on the target; `sync` must refuse
 *                 to run concurrently (fast exit 1, nothing written).
 *   3. initial  — `sync --mode daily --profile dev` (full: stage from the dev
 *                 synthetic MariaDB → seeds → fleet → parity). Expect PASS,
 *                 zero findings, one persisted runs row.
 *   4. dryrun   — `sync --mode daily --dry-run --force-reconcile --skip-stage`:
 *                 flags must be forwarded + echoed (contract-checked), parity
 *                 skipped, NO runs row recorded.
 *   5. mutate   — fleet-smoke-mutate --apply (S1-side adds/edits/deletes across
 *                 people/config/beneficiaries/cardchecks/elections/months/money
 *                 incl. source deletions), then `sync --mode daily --skip-stage`:
 *                 expect PASS with updated/deleted movement, all three
 *                 report-only finding kinds surfaced for triage, parity PASS.
 *   6. modes    — `sync --mode final-freeze --skip-stage` must FAIL (exit 1,
 *                 findings gate) while fleet+parity gates PASS — the retained
 *                 deletions block the freeze until resolved. Then restore the
 *                 S1 side (fleet-smoke-mutate --restore) and re-run final-freeze:
 *                 expect PASS with zero findings (convergence after resolution).
 *   7. cleanup  — drop the throwaway DB (kept on failure for debugging).
 *
 * Usage:
 *   npx tsx scripts/s1-migration/dev/smoke-sync-fleet.ts [--phase all|setup|lock|initial|dryrun|mutate|modes|cleanup] [--keep-db]
 *
 * Requires: DATABASE_URL (local PG host), S1_DATABASE_URL (dev synthetic
 * MariaDB). The shared dev Neon DB (EXTERNAL_DATABASE_URL) is NEVER touched —
 * every child gets EXTERNAL_DATABASE_URL overridden to the throwaway DB.
 */
import { spawnSync } from "child_process";
import { getEnvironmentVariable, getRawProcessEnv } from "../lib/script-env";
import * as fs from "fs";
import * as path from "path";
import { Client } from "pg";

const DB_NAME = "s1_fleet_smoke";
const SNAPSHOT = "/tmp/s1-fleet-smoke-snapshot.json";
const RESULT_DIR = "/tmp/s1-fleet-smoke-results";
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../..");

const phaseIdx = process.argv.indexOf("--phase");
const PHASE = phaseIdx >= 0 ? String(process.argv[phaseIdx + 1] ?? "all") : "all";
const KEEP_DB = process.argv.includes("--keep-db");

  const baseUrl = getEnvironmentVariable("DATABASE_URL");
if (!baseUrl) {
  console.error("FAIL: DATABASE_URL required (local PG host for the throwaway DB)");
  process.exit(1);
}
const throwawayUrl = (() => {
  const u = new URL(baseUrl);
  u.pathname = `/${DB_NAME}`;
  return u.toString();
})();

const childEnv: NodeJS.ProcessEnv = {
      ...getRawProcessEnv(),
  EXTERNAL_DATABASE_URL: throwawayUrl,
  DATABASE_URL: throwawayUrl,
  S1_FLEET_SMOKE: "1",
};

const failures: string[] = [];
function expect(cond: boolean, msg: string) {
  if (cond) console.log(`  ✓ ${msg}`);
  else {
    console.error(`  ✗ ASSERT FAILED: ${msg}`);
    failures.push(msg);
  }
}

function run(
  script: string,
  args: string[],
  opts: { resultFile?: string } = {},
): { exit: number; report: any } {
  const env = { ...childEnv, ...(opts.resultFile ? { S1_RESULT_JSON_PATH: opts.resultFile } : {}) };
  if (opts.resultFile) fs.rmSync(opts.resultFile, { force: true });
  console.log(`\n▶ npx tsx ${script} ${args.join(" ")}`);
  const res = spawnSync("npx", ["tsx", script, ...args], { stdio: "inherit", env, cwd: ROOT });
  const exit = res.status ?? 1;
  let report: any = null;
  if (opts.resultFile && fs.existsSync(opts.resultFile)) {
    try {
      report = JSON.parse(fs.readFileSync(opts.resultFile, "utf8"));
    } catch {
      /* asserted by callers */
    }
  }
  return { exit, report };
}

async function adminQuery(q: string): Promise<void> {
  const c = new Client({ connectionString: baseUrl });
  await c.connect();
  try {
    await c.query(q);
  } finally {
    await c.end();
  }
}

async function targetQuery<T>(q: string): Promise<T[]> {
  const c = new Client({ connectionString: throwawayUrl });
  await c.connect();
  try {
    return (await c.query(q)).rows as T[];
  } finally {
    await c.end();
  }
}

async function syncRunsCount(): Promise<number> {
  const r = await targetQuery<{ n: string }>(
    `SELECT count(*) AS n FROM s1_staging.runs WHERE report->>'command' = 'sync'`,
  );
  return Number(r[0].n);
}

const SYNC = "scripts/s1-migration/sync.ts";
const MUTATE = "scripts/s1-migration/dev/fleet-smoke-mutate.ts";

async function phaseSetup() {
  console.log("\n═══ PHASE setup ═══");
  try {
    await adminQuery(`DROP DATABASE IF EXISTS "${DB_NAME}" WITH (FORCE)`);
  } catch {
    await adminQuery(`DROP DATABASE IF EXISTS "${DB_NAME}"`);
  }
  await adminQuery(`CREATE DATABASE "${DB_NAME}"`);
  console.log(`created throwaway DB ${DB_NAME}`);
  let r = run("scripts/s1-migration/bootstrap-target.ts", ["--wipe"]);
  if (r.exit !== 0) throw new Error(`bootstrap-target failed (exit ${r.exit})`);
  r = run("scripts/s1-migration/dev/enable-cardcheck.ts", []);
  if (r.exit !== 0) throw new Error(`enable-cardcheck failed (exit ${r.exit})`);
  r = run("scripts/s1-migration/dev/seed-fund-config.ts", []);
  if (r.exit !== 0) throw new Error(`seed-fund-config failed (exit ${r.exit})`);
}

async function phaseLock() {
  console.log("\n═══ PHASE lock (concurrent-run refusal) ═══");
  const holder = new Client({ connectionString: throwawayUrl });
  await holder.connect();
  await holder.query("SELECT pg_advisory_lock(727001)");
  try {
    const r = run(SYNC, ["--mode", "daily", "--profile", "dev", "--skip-stage"]);
    expect(r.exit !== 0, "sync refuses to run while the migration advisory lock is held elsewhere");
  } finally {
    await holder.query("SELECT pg_advisory_unlock(727001)");
    await holder.end();
  }
}

async function phaseInitial() {
  console.log("\n═══ PHASE initial (full sync: stage → fleet → parity) ═══");
  const rf = path.join(RESULT_DIR, "initial.json");
  const r = run(SYNC, ["--mode", "daily", "--profile", "dev"], { resultFile: rf });
  expect(r.exit === 0, "initial daily sync exits 0");
  expect(r.report?.result === "PASS", "initial report result=PASS");
  expect(r.report?.gates?.stage === "pass", "stage gate pass (count-verified)");
  expect(r.report?.gates?.fleet === "pass", "fleet gate pass (all loaders: envelope+rejects+verify)");
  expect(r.report?.gates?.parity === "pass", "parity gate pass (balance 0¢ + ruled months)");
  expect(
    r.report?.writeFence?.status === "acquired" &&
      r.report?.writeFence?.heldThroughAggregateRecord === true,
    "wet sync report records app fence acquisition through aggregate recording",
  );
  expect((r.report?.fleetTotals?.created ?? 0) > 0, "fleet created rows on initial load");
  {
    // Dev-structural baseline: synthetic staging has no keep-tag terms, so
    // packet-tags always reports its config-RULED sweep-skip finding — and
    // nothing else may appear on a clean initial load.
    const fk0: Record<string, number> = r.report?.findingsByKind ?? { missing: 1 };
    expect(
      Object.keys(fk0).length === 1 && fk0.sweep_skipped_no_keep_tag_terms === 1,
      `initial-load findings = exactly the dev-structural sweep-skip (got ${JSON.stringify(fk0)})`,
    );
  }
  expect((await syncRunsCount()) === 1, "exactly one sync runs row persisted");
}

async function phaseDryrun() {
  console.log("\n═══ PHASE dryrun (--dry-run --force-reconcile forwarding) ═══");
  const before = await syncRunsCount();
  const rf = path.join(RESULT_DIR, "dryrun.json");
  const r = run(SYNC, ["--mode", "daily", "--profile", "dev", "--skip-stage", "--dry-run", "--force-reconcile"], {
    resultFile: rf,
  });
  expect(r.exit === 0, "dry-run+force sync exits 0");
  expect(r.report?.result === "PASS", "dry-run report result=PASS");
  expect(r.report?.dryRun === true, "report records dryRun=true");
  expect(r.report?.forceReconcile === true, "report PROMINENTLY records forceReconcile=true");
  expect(r.report?.parity?.status === "skipped", "parity skipped on dry-run");
  expect(
    r.report?.writeFence?.status === "skipped" && r.report?.writeFence?.reason === "dry-run",
    "dry-run does NOT acquire the app write fence",
  );
  expect(
    (r.report?.fleet ?? []).every((s: any) => s.forceReconcile === true || s.forceReconcile === false),
    "per-step forceReconcile echoed",
  );
  expect((await syncRunsCount()) === before, "dry-run records NO runs row");
}

async function phaseMutate() {
  console.log("\n═══ PHASE mutate (S1 drift → daily sync converges + surfaces findings) ═══");
  let r = run(MUTATE, ["--apply", "--snapshot-file", SNAPSHOT]);
  if (r.exit !== 0) throw new Error(`fleet-smoke-mutate --apply failed (exit ${r.exit})`);
  const rf = path.join(RESULT_DIR, "mutate-sync.json");
  r = run(SYNC, ["--mode", "daily", "--profile", "dev", "--skip-stage"], { resultFile: rf });
  expect(r.exit === 0, "post-mutation daily sync exits 0 (findings are report-only in daily mode)");
  expect(r.report?.result === "PASS", "post-mutation daily report result=PASS");
  expect((r.report?.fleetTotals?.updated ?? 0) >= 3, `fleet updated>=3 (got ${r.report?.fleetTotals?.updated})`);
  expect((r.report?.fleetTotals?.deleted ?? 0) >= 2, `fleet deleted>=2 (got ${r.report?.fleetTotals?.deleted})`);
  const fk = r.report?.findingsByKind ?? {};
  expect((fk.deleted_in_s1 ?? 0) >= 1, `deleted_in_s1 finding surfaced (got ${fk.deleted_in_s1})`);
  expect((fk.source_worker_missing ?? 0) >= 1, `source_worker_missing finding surfaced (got ${fk.source_worker_missing})`);
  expect((fk.pending_retention ?? 0) >= 1, `pending_retention finding surfaced (got ${fk.pending_retention})`);
  expect(r.report?.gates?.parity === "pass", "parity still PASS after convergence (money edits/deletes tracked)");
}

async function phaseModes() {
  console.log("\n═══ PHASE modes (final-freeze blocks on retained deletions until resolved) ═══");
  const rf1 = path.join(RESULT_DIR, "final-freeze-blocked.json");
  let r = run(SYNC, ["--mode", "final-freeze", "--profile", "dev", "--skip-stage"], { resultFile: rf1 });
  expect(r.exit !== 0, "final-freeze sync exits non-zero while report-only findings are unresolved");
  expect(r.report?.result === "FAIL", "final-freeze report result=FAIL");
  expect(r.report?.gates?.findingsMode === "fail", "findings gate=fail in final-freeze mode");
  expect(r.report?.gates?.fleet === "pass", "fleet gate itself passes (loaders converged) — findings alone block");
  expect(r.report?.gates?.parity === "pass", "parity passes — parity PASS cannot override the findings gate");
  expect(r.report?.writeFence?.status === "acquired", "failed wet sync acquired the app write fence");
  expect((r.report?.finalFreezeBlocked ?? []).length > 0, "finalFreezeBlocked lists the blocking steps");

  r = run(MUTATE, ["--restore", "--snapshot-file", SNAPSHOT]);
  if (r.exit !== 0) throw new Error(`fleet-smoke-mutate --restore failed (exit ${r.exit})`);

  const rf2 = path.join(RESULT_DIR, "final-freeze-pass.json");
  r = run(SYNC, ["--mode", "final-freeze", "--profile", "dev", "--skip-stage"], { resultFile: rf2 });
  expect(r.exit === 0, "final-freeze sync exits 0 after the S1 side is restored (resolved)");
  expect(r.report?.result === "PASS", "final-freeze report result=PASS after resolution");
  expect(r.report?.writeFence?.status === "acquired", "second wet sync acquires after failed run cleanup");
  {
    const fk2: Record<string, number> = r.report?.findingsByKind ?? { missing: 1 };
    expect(
      Object.keys(fk2).length === 1 && fk2.sweep_skipped_no_keep_tag_terms === 1,
      `post-restore findings = only the dev-structural sweep-skip (got ${JSON.stringify(fk2)})`,
    );
  }
  expect(r.report?.gates?.parity === "pass", "parity PASS after restore");
}

async function phaseCleanup() {
  console.log("\n═══ PHASE cleanup ═══");
  try {
    await adminQuery(`DROP DATABASE IF EXISTS "${DB_NAME}" WITH (FORCE)`);
  } catch {
    await adminQuery(`DROP DATABASE IF EXISTS "${DB_NAME}"`);
  }
  console.log(`dropped ${DB_NAME}`);
}

async function main() {
  fs.mkdirSync(RESULT_DIR, { recursive: true });
  const phases: Record<string, () => Promise<void>> = {
    setup: phaseSetup,
    lock: phaseLock,
    initial: phaseInitial,
    dryrun: phaseDryrun,
    mutate: phaseMutate,
    modes: phaseModes,
    cleanup: phaseCleanup,
  };
  const order = PHASE === "all" ? ["setup", "lock", "initial", "dryrun", "mutate", "modes", "cleanup"] : [PHASE];
  for (const p of order) {
    const fn = phases[p];
    if (!fn) {
      console.error(`unknown phase "${p}" (known: ${Object.keys(phases).join(", ")}, all)`);
      process.exit(1);
    }
    if (p === "cleanup" && (failures.length > 0 || KEEP_DB)) {
      console.log(`\n[keeping ${DB_NAME} for debugging — drop with --phase cleanup]`);
      continue;
    }
    await fn();
  }
  console.log(`\n════════ FLEET SMOKE ${failures.length === 0 ? "PASS" : `FAIL (${failures.length} assertion(s))`} ════════`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  console.error(`\n[throwaway DB ${DB_NAME} kept for debugging — drop with --phase cleanup]`);
  process.exit(1);
});
