/**
 * Failure-injection tests for the S1-migration wipe-and-retry guarantees
 * (bootstrap-target.ts --wipe). Runs against a THROWAWAY database it creates
 * on the dev Postgres host (from DATABASE_URL) and drops afterwards — the
 * shared dev DB and any EXTERNAL_DATABASE_URL target are never touched.
 *
 * Proves (RUNBOOK §9 hardening):
 *   1. A wipe aborted mid-transaction (thrown error AND hard SIGKILL, both
 *      after truncate and just before commit) leaves the target UNCHANGED —
 *      admin + migrated data + id_map all intact (atomic rollback).
 *   2. `--wipe --keep-staging` clears s1_staging.id_map + runs, so a retry of
 *      seed-trust-config + a loader (load-options) RECREATES every row —
 *      no stale id_map mapping ever makes a loader skip a truncated row.
 *   3. Two concurrent bootstrap/seed runs are refused by the advisory lock
 *      (key 727001): both bootstrap-target and seed-trust-config exit 1
 *      while another session holds the lock.
 *
 * Usage: npx tsx scripts/oneoffs/s1-wipe-retry-tests.ts
 *        (optional: --keep-db to leave the throwaway DB for inspection)
 */
import { spawnSync } from "child_process";
import pg from "pg";
import {
  getEnvironmentVariable,
  getRawProcessEnv,
} from "../../server/config/env-registry";

const KEEP_DB = process.argv.includes("--keep-db");
const BOOTSTRAP = "scripts/s1-migration/bootstrap-target.ts";
const SEED_TRUST = "scripts/s1-migration/seed-trust-config.ts";
const LOAD_OPTIONS = "scripts/s1-migration/load-options.ts";
const ADMIN_EMAIL = "mmcdermott@cgtconsultinginc.com";
const LOCK_KEY = 727001;

// ---------------------------------------------------------------------------
// throwaway DB plumbing
// ---------------------------------------------------------------------------
const baseUrl = getEnvironmentVariable("DATABASE_URL");
if (!baseUrl) {
  console.error("FAIL: DATABASE_URL must point at the dev Postgres host (CREATEDB role).");
  process.exit(1);
}
const dbName = `s1_wipe_test_${Date.now()}`;
const throwawayUrl = (() => {
  const u = new URL(baseUrl);
  u.pathname = `/${dbName}`;
  return u.toString();
})();

function adminClient(): pg.Client {
  return new pg.Client({ connectionString: baseUrl });
}
function testClient(): pg.Client {
  return new pg.Client({ connectionString: throwawayUrl });
}

// ---------------------------------------------------------------------------
// harness
// ---------------------------------------------------------------------------
let passed = 0;
let failed = 0;
function check(label: string, ok: boolean, detail?: string) {
  if (ok) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failed++;
    console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

interface RunResult {
  status: number | null;
  signal: NodeJS.Signals | null;
  /** spawn-level failure (incl. ETIMEDOUT) — NEVER counts as a pass. */
  spawnError: string | null;
  out: string;
}
function run(script: string, args: string[] = [], env: Record<string, string> = {}): RunResult {
  const res = spawnSync("npx", ["tsx", script, ...args], {
    env: {
      ...getRawProcessEnv(),
      EXTERNAL_DATABASE_URL: throwawayUrl,
      DATABASE_URL: throwawayUrl,
      ...env,
    },
    encoding: "utf8",
    timeout: 10 * 60 * 1000,
  });
  return {
    status: res.status,
    signal: res.signal,
    spawnError: res.error ? String(res.error) : null,
    out: `${res.stdout ?? ""}\n${res.stderr ?? ""}`,
  };
}

async function q<T = Record<string, unknown>>(c: pg.Client, text: string, params?: unknown[]): Promise<T[]> {
  return (await c.query(text, params)).rows as T[];
}
async function count(c: pg.Client, sqlFrom: string): Promise<number> {
  const rows = await q<{ n: string }>(c, `SELECT count(*)::int AS n FROM ${sqlFrom}`);
  return Number(rows[0]?.n ?? 0);
}

/**
 * Deterministic post-kill barrier: a SIGKILLed child's pool connections may
 * outlive the process briefly. Poll pg_stat_activity until OUR session is the
 * only backend on the throwaway DB — only then is "rollback happened" a
 * conclusive observation. Fails loud on timeout instead of asserting anyway.
 */
async function waitForNoOtherBackends(c: pg.Client, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const rows = await q<{ n: number }>(
      c,
      `SELECT count(*)::int AS n FROM pg_stat_activity
        WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [dbName],
    );
    if (Number(rows[0]?.n ?? 0) === 0) return;
    if (Date.now() > deadline) {
      throw new Error(`child backend sessions still present on ${dbName} after ${timeoutMs}ms`);
    }
    await new Promise((r) => setTimeout(r, 250));
  }
}

// ---------------------------------------------------------------------------
// staged fixture (fake S1 nodes/terms — titles only, no PII)
// ---------------------------------------------------------------------------
const FAKE_PROVIDERS = [
  { nid: 9101, title: "Test Carrier Alpha" },
  { nid: 9102, title: "Test Carrier Beta" },
];
const FAKE_BENEFITS = [
  { nid: 9201, title: "Test Benefit Medical" },
  { nid: 9202, title: "Test Benefit Dental" },
  { nid: 9203, title: "Test Benefit Vision" },
];
const FAKE_TERMS = [
  { tid: 9301, vocabulary: "sirius_payment_type", name: "Test Payment Check", weight: 1 },
  { tid: 9302, vocabulary: "sirius_payment_type", name: "Test Payment ACH", weight: 2 },
];

async function seedStaging(c: pg.Client) {
  await c.query(`CREATE SCHEMA IF NOT EXISTS s1_staging`);
  await c.query(`CREATE TABLE IF NOT EXISTS s1_staging.records (
    bundle text NOT NULL, nid bigint NOT NULL, vid bigint, title text, uid bigint,
    status integer, created bigint, changed bigint,
    fields jsonb NOT NULL DEFAULT '{}'::jsonb,
    extracted_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (bundle, nid))`);
  await c.query(`CREATE TABLE IF NOT EXISTS s1_staging.terms (
    tid bigint PRIMARY KEY, vocabulary text NOT NULL, name text NOT NULL,
    description text, weight integer NOT NULL DEFAULT 0,
    fields jsonb NOT NULL DEFAULT '{}'::jsonb,
    extracted_at timestamptz NOT NULL DEFAULT now())`);
  await c.query(`CREATE TABLE IF NOT EXISTS s1_staging.runs (
    id serial PRIMARY KEY, started_at timestamptz NOT NULL,
    finished_at timestamptz NOT NULL DEFAULT now(),
    args jsonb NOT NULL DEFAULT '{}'::jsonb, report jsonb NOT NULL DEFAULT '{}'::jsonb)`);
  for (const p of FAKE_PROVIDERS) {
    await c.query(
      `INSERT INTO s1_staging.records (bundle, nid, title, status) VALUES ('sirius_trust_provider', $1, $2, 1)
       ON CONFLICT (bundle, nid) DO NOTHING`,
      [p.nid, p.title],
    );
  }
  for (const b of FAKE_BENEFITS) {
    await c.query(
      `INSERT INTO s1_staging.records (bundle, nid, title, status) VALUES ('sirius_trust_benefit', $1, $2, 1)
       ON CONFLICT (bundle, nid) DO NOTHING`,
      [b.nid, b.title],
    );
  }
  for (const t of FAKE_TERMS) {
    await c.query(
      `INSERT INTO s1_staging.terms (tid, vocabulary, name, weight) VALUES ($1, $2, $3, $4)
       ON CONFLICT (tid) DO NOTHING`,
      [t.tid, t.vocabulary, t.name, t.weight],
    );
  }
}

interface Snapshot {
  benefits: number;
  providers: number;
  paymentTypes: number;
  idMap: number;
  runs: number;
  stagedRecords: number;
  stagedTerms: number;
  adminUsers: number;
  adminRoles: number;
}
/**
 * Snapshot counts FIXTURE rows only (by sirius_id / fixture names), never
 * whole-table counts: bootstrap's post-wipe seed steps legitimately populate
 * baseline rows in some tables, and the proof must distinguish rows the
 * MIGRATION created from bootstrap baseline data.
 */
async function snapshot(c: pg.Client): Promise<Snapshot> {
  const adminUsers = await count(c, `users WHERE lower(email) = lower('${ADMIN_EMAIL}')`);
  const adminRoles = await count(
    c,
    `user_roles ur JOIN users u ON u.id = ur.user_id WHERE lower(u.email) = lower('${ADMIN_EMAIL}')`,
  );
  const inList = (vals: string[]) => vals.map((v) => `'${v}'`).join(", ");
  return {
    benefits: await count(
      c,
      `trust_benefits WHERE sirius_id IN (${inList(FAKE_BENEFITS.map((b) => String(b.nid)))})`,
    ),
    providers: await count(
      c,
      `trust_providers WHERE name IN (${inList(FAKE_PROVIDERS.map((p) => p.title))})`,
    ),
    paymentTypes: await count(
      c,
      `options_ledger_payment_type WHERE name IN (${inList(FAKE_TERMS.map((t) => t.name))})`,
    ),
    idMap: await count(c, "s1_staging.id_map"),
    runs: await count(c, "s1_staging.runs"),
    stagedRecords: await count(c, "s1_staging.records"),
    stagedTerms: await count(c, "s1_staging.terms"),
    adminUsers,
    adminRoles,
  };
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
async function main() {
  const admin = adminClient();
  await admin.connect();
  await admin.query(`CREATE DATABASE "${dbName}"`);
  console.log(`throwaway target created: ${dbName}`);

  try {
    // --- setup: full bootstrap on the fresh empty target ---
    console.log("\n== setup: fresh bootstrap ==");
    const boot0 = run(BOOTSTRAP);
    check("fresh bootstrap exits 0", boot0.status === 0, boot0.out.slice(-800));
    if (boot0.status !== 0) throw new Error("cannot continue without a bootstrapped target");

    const c = testClient();
    await c.connect();
    try {
      // --- setup: staged fixture + first seed/load pass (the "migrated data") ---
      await seedStaging(c);
      const seed0 = run(SEED_TRUST);
      check("seed-trust-config (first pass) exits 0", seed0.status === 0, seed0.out.slice(-800));
      const opt0 = run(LOAD_OPTIONS);
      check("load-options (first pass) exits 0", opt0.status === 0, opt0.out.slice(-800));

      const before = await snapshot(c);
      check(`benefits created == staged (${FAKE_BENEFITS.length})`, before.benefits === FAKE_BENEFITS.length, JSON.stringify(before));
      check(`providers created == staged (${FAKE_PROVIDERS.length})`, before.providers === FAKE_PROVIDERS.length);
      check(`payment-type options created == staged terms (${FAKE_TERMS.length})`, before.paymentTypes === FAKE_TERMS.length);
      const expectedMappings = FAKE_BENEFITS.length + FAKE_PROVIDERS.length + FAKE_TERMS.length;
      check(`id_map holds ${expectedMappings} mappings`, before.idMap === expectedMappings, `got ${before.idMap}`);
      check("admin user present", before.adminUsers === 1 && before.adminRoles >= 1);

      // --- 1. aborted wipe leaves the target unchanged (4 fault variants) ---
      console.log("\n== test 1: wipe aborted mid-transaction → target unchanged ==");
      for (const fault of ["after_truncate", "before_commit", "after_truncate:kill", "before_commit:kill"]) {
        const res = run(BOOTSTRAP, ["--wipe", "--keep-staging"], { S1_BOOTSTRAP_TEST_FAULT: fault });
        // A spawn-level error (incl. harness timeout) is a test FAILURE, never
        // a passing "child died" observation.
        const died = res.spawnError == null && (res.status !== 0 || res.signal != null);
        check(
          `[${fault}] bootstrap does NOT exit 0`,
          died,
          `status=${res.status} signal=${res.signal} spawnError=${res.spawnError}`,
        );
        // Barrier: only assert rollback once the child's backends are gone.
        await waitForNoOtherBackends(c);
        const after = await snapshot(c);
        check(
          `[${fault}] target unchanged (data + admin + id_map intact)`,
          JSON.stringify(after) === JSON.stringify(before),
          `before=${JSON.stringify(before)} after=${JSON.stringify(after)}`,
        );
      }

      // --- 2. clean --wipe --keep-staging then retry recreates everything ---
      console.log("\n== test 2: --wipe --keep-staging retry recreates all rows ==");
      const wipe = run(BOOTSTRAP, ["--wipe", "--keep-staging"]);
      check("clean wipe exits 0", wipe.status === 0, wipe.out.slice(-800));
      const wiped = await snapshot(c);
      check("wipe: migrated rows gone", wiped.benefits === 0 && wiped.providers === 0 && wiped.paymentTypes === 0, JSON.stringify(wiped));
      check("wipe: staged records/terms SURVIVE", wiped.stagedRecords === before.stagedRecords && wiped.stagedTerms === before.stagedTerms);
      check("wipe: id_map CLEARED (no stale skips possible)", wiped.idMap === 0, `got ${wiped.idMap}`);
      check("wipe: runs CLEARED", wiped.runs === 0, `got ${wiped.runs}`);
      check("wipe: admin preserved", wiped.adminUsers === 1 && wiped.adminRoles >= 1);

      const seed1 = run(SEED_TRUST);
      check("seed-trust-config (retry) exits 0", seed1.status === 0, seed1.out.slice(-800));
      // created == staged on both sides — the smoking gun for "no stale skips":
      // any surviving id_map row would surface as viaIdMap > 0 / created < staged.
      check(
        `retry seed report: created == staged, viaIdMap == 0`,
        /"viaIdMap":\s*0[\s\S]*"created":\s*2[\s\S]*"viaIdMap":\s*0[\s\S]*"created":\s*3/.test(seed1.out),
        seed1.out.slice(-1200),
      );
      const opt1 = run(LOAD_OPTIONS);
      check("load-options (retry) exits 0", opt1.status === 0, opt1.out.slice(-800));

      const after = await snapshot(c);
      check("retry recreated ALL rows (counts match first pass)",
        after.benefits === before.benefits &&
        after.providers === before.providers &&
        after.paymentTypes === before.paymentTypes &&
        after.idMap === before.idMap,
        `before=${JSON.stringify(before)} after=${JSON.stringify(after)}`,
      );
      const dupNames = await q<{ name: string }>(
        c,
        `SELECT name FROM trust_benefits GROUP BY name HAVING count(*) > 1`,
      );
      check("no duplicate benefits from the retry", dupNames.length === 0, JSON.stringify(dupNames));

      // --- 3. advisory lock refuses concurrent runs ---
      console.log("\n== test 3: advisory lock (727001) refuses concurrent runs ==");
      const holder = testClient();
      await holder.connect();
      await holder.query(`SELECT pg_advisory_lock(${LOCK_KEY})`);
      try {
        const b = run(BOOTSTRAP, ["--wipe", "--keep-staging"]);
        check("bootstrap refused while lock held (exit 1)", b.status === 1, `status=${b.status}`);
        check("bootstrap refusal names the advisory lock", /advisory lock/i.test(b.out), b.out.slice(-400));
        const s = run(SEED_TRUST);
        check("seed-trust-config refused while lock held (exit 1)", s.status === 1, `status=${s.status}`);
        check("seed refusal names the advisory lock", /advisory lock/i.test(s.out), s.out.slice(-400));
        const untouched = await snapshot(c);
        check("refused runs changed nothing", JSON.stringify(untouched) === JSON.stringify(after));
      } finally {
        await holder.query(`SELECT pg_advisory_unlock(${LOCK_KEY})`);
        await holder.end();
      }
    } finally {
      await c.end();
    }
  } finally {
    if (KEEP_DB) {
      console.log(`\n--keep-db: throwaway DB left in place: ${dbName}`);
    } else {
      await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
      console.log(`\nthrowaway DB dropped: ${dbName}`);
    }
    await admin.end();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error("FATAL:", e);
  try {
    const admin = adminClient();
    await admin.connect();
    if (!KEEP_DB) await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    await admin.end();
  } catch {
    /* best effort */
  }
  process.exit(1);
});
