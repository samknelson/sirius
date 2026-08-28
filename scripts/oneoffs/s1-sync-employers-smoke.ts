/**
 * Sync smoke — employer loaders (Task 293): T7/T24 employers + shop
 * contacts, employer policy history (shop JSON), employer hourly rates
 * (shop JSON).
 *
 * Proves full reconcile semantics against the dev DB:
 *   1. create — seed a staged shop (with ledger.policy + charge_plugins
 *      rate history JSON) and one shop contact; first loads build the
 *      employer, the contact + link, one policy-history row (+ denorm),
 *      and one rate row
 *   2. update — rename shop, retitle contact, append policy entry + move
 *      current, change a rate + add a second effective date; re-runs
 *      converge
 *   3. remove — drop the older policy entry and the older rate entry from
 *      the JSON; re-runs delete exactly the vanished rows (collection
 *      reconcile), denorm repaired
 *   4. sweep  — strip the whole ledger.policy block → owned history rows
 *      deleted + anchor mapping removed + denorm cleared; then delete the
 *      staged shop + contact entirely → employers/contacts are REPORT-ONLY
 *      (rows persist, deleted_in_s1 findings) while rate rows are swept
 *
 * DEV-ONLY. Fake nids 99901100–99901199. Requires: ≥2 mapped policies and
 * exactly one enabled bao-hourly charge config (the rates loader aborts
 * otherwise — reported as SETUP FAIL).
 *
 * Run: npx tsx scripts/oneoffs/s1-sync-employers-smoke.ts
 */
import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { db } from "../../server/storage/db";
import { sql } from "drizzle-orm";
import { ensureStagingSchema, upsertRecords } from "../s1-migration/lib/staging";
import { ensureIdMap } from "../s1-migration/lib/idmap";
import { getRawProcessEnv } from "../../server/config/env-registry";

const N = {
  sh1: 99901101, // staged shop
  sc1: 99901111, // staged shop contact
};
const NID_LO = 99901100;
const NID_HI = 99901199;
// First entry of the loader's HOURLY_UUIDS allow-list (see load-employer-rates.ts).
const HOURLY_UUID = "54a9b912-1658-4d97-934a-d31b277f33b5";

const T7_ALLOW_REJECTS: string[] = [];
const POL_ALLOW_REJECTS: string[] = [];
const RATE_ALLOW_REJECTS: string[] = [];

let failures = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log(`  ok: ${name}`);
  else {
    failures++;
    console.error(`  FAIL: ${name}${extra !== undefined ? ` — ${JSON.stringify(extra)}` : ""}`);
  }
}

function runLoader(script: string, args: string[] = [], timeoutMs = 900_000): { status: number; result: any } {
  const tmp = path.join(os.tmpdir(), `s1-smoke-${process.pid}-${Math.random().toString(36).slice(2)}.json`);
  const res = spawnSync("npx", ["tsx", `scripts/s1-migration/${script}`, ...args], {
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
    env: { ...getRawProcessEnv(), S1_RESULT_JSON_PATH: tmp },
  });
  let result: any = {};
  try {
    result = JSON.parse(fs.readFileSync(tmp, "utf8"));
  } catch {}
  try {
    fs.unlinkSync(tmp);
  } catch {}
  if ((res.status ?? -1) !== 0) {
    const tail = (res.stderr ?? "").split("\n").filter(Boolean).slice(-8).join("\n    ");
    console.error(`  [${script} exit ${res.status}] stderr tail:\n    ${tail}`);
  }
  return { status: res.status ?? -1, result };
}

const allowArgs = (rejects: string[], findings: string[] = []) => [
  ...(rejects.length > 0 ? ["--allow-rejects", rejects.join(",")] : []),
  ...(findings.length > 0 ? ["--allow-findings", findings.join(",")] : []),
];

// deleted_in_s1 allowed on every T7/T24 run (report-only sweeps re-emit; dev
// may carry dangling mappings from earlier exercises) — our nids asserted
// explicitly instead.
const runT7 = () => runLoader("load-employers.ts", allowArgs(T7_ALLOW_REJECTS, ["deleted_in_s1"]));
const runPolicies = () => runLoader("load-employer-policies.ts", allowArgs(POL_ALLOW_REJECTS), 600_000);
const runRates = (extra: string[] = []) => runLoader("load-employer-rates.ts", [...allowArgs(RATE_ALLOW_REJECTS), ...extra], 600_000);

async function rows<T>(q: ReturnType<typeof sql>): Promise<T[]> {
  return ((await db.execute(q)) as unknown as { rows: T[] }).rows;
}
async function mappingOf(entity: string, s1Id: number): Promise<{ s2Id: string; stub: boolean } | null> {
  const r = await rows<{ s2_id: string; stub: boolean }>(
    sql`SELECT s2_id, stub FROM s1_staging.id_map WHERE entity = ${entity} AND s1_id = ${s1Id}`,
  );
  return r.length > 0 ? { s2Id: r[0].s2_id, stub: r[0].stub } : null;
}

// ---------------------------------------------------------------------------
// staged fixtures
// ---------------------------------------------------------------------------
const now = Math.floor(Date.UTC(2026, 1, 1) / 1000);

interface ShopJson {
  ebh?: Array<{ policy: number; date: string }>;
  current?: number;
  rates?: Array<{ rate: string; date: string }>;
}
function shopJsonField(o: ShopJson): Record<string, unknown> {
  const j: any = {};
  if (o.ebh) {
    j.ledger = {
      policy: {
        ebh: o.ebh.map((e) => ({ policy: String(e.policy), date: e.date })),
        ...(o.current != null ? { nid: String(o.current) } : {}),
      },
    };
  }
  if (o.rates) {
    j.charge_plugins = {
      settings: {
        [HOURLY_UUID]: { rates: { history: o.rates.map((r, i) => ({ rate: r.rate, date: r.date, ts: 1700000000 + i })) } },
      },
    };
  }
  return { value: JSON.stringify(j) };
}

const shopRec = (title: string, json: ShopJson) => ({
  bundle: "grievance_shop",
  nid: N.sh1,
  vid: N.sh1,
  title,
  uid: 1,
  status: 1,
  created: now,
  changed: now,
  fields: { field_sirius_json: shopJsonField(json) },
});

const shopContactRec = (name: string, email: string) => ({
  bundle: "grievance_shop_contact",
  nid: N.sc1,
  vid: N.sc1,
  title: name,
  uid: 1,
  status: 1,
  created: now,
  changed: now,
  fields: {
    field_grievance_shops: { target_id: N.sh1 },
    field_grievance_co_name: { value: name },
    field_grievance_co_email: { value: email },
    field_grievance_co_phone: { value: "617-555-0201" },
  },
});

// ---------------------------------------------------------------------------
// cleanup (idempotent; run before seeding AND in finally)
// ---------------------------------------------------------------------------
async function cleanup() {
  const emp = await mappingOf("employer", N.sh1);
  const con = await mappingOf("contact", N.sc1);
  if (emp) {
    await db.execute(sql`DELETE FROM employer_policy_history WHERE employer_id = ${emp.s2Id}`);
    await db.execute(sql`DELETE FROM sitespecific_bao_employer_rates WHERE employer_id = ${emp.s2Id}`);
    await db.execute(sql`DELETE FROM employer_contacts WHERE employer_id = ${emp.s2Id}`);
    await db.execute(sql`DELETE FROM employers WHERE id = ${emp.s2Id}`);
  }
  if (con) {
    await db.execute(sql`DELETE FROM employer_contacts WHERE contact_id = ${con.s2Id}`);
    await db.execute(sql`DELETE FROM contact_phone WHERE contact_id = ${con.s2Id}`);
    await db.execute(sql`DELETE FROM contact_postal WHERE contact_id = ${con.s2Id}`);
    await db.execute(sql`DELETE FROM contacts WHERE id = ${con.s2Id}`);
  }
  await db.execute(
    sql`DELETE FROM s1_staging.records
        WHERE nid BETWEEN ${NID_LO} AND ${NID_HI}
          AND bundle IN ('grievance_shop','grievance_shop_contact')`,
  );
  await db.execute(
    sql`DELETE FROM s1_staging.id_map
        WHERE entity IN ('employer','contact','employer-policy','employer-rate')
          AND s1_id BETWEEN ${NID_LO} AND ${NID_HI}`,
  );
  // transient bao-hourly charge config seeded by this smoke (marker sirius_id;
  // cascade removes the plugin_configs_charge subsidiary row)
  await db.execute(sql`DELETE FROM plugin_configs WHERE sirius_id = ${SMOKE_CFG_SIRIUS_ID}`);
}

// The rates loader hard-requires exactly ONE enabled bao-hourly charge config
// (its account is the rate target). Charge configs are fund config and dev may
// lack one — seed a transient config against the real "Employer Contributions"
// ledger account. Raw SQL on purpose: the running dev app caches plugin
// configs in memory and sees nothing (no invalidation event), while the loader
// reads storage in a fresh process and does. Cleaned up in cleanup()/finally.
const SMOKE_CFG_SIRIUS_ID = "smoke.s1-sync-employers.bao-hourly";
async function ensureHourlyChargeConfig() {
  const existing = await rows<{ id: string }>(
    sql`SELECT id FROM plugin_configs WHERE plugin_kind = 'charge' AND plugin_id = 'bao-hourly' AND enabled = true`,
  );
  if (existing.length === 1) {
    console.log("  using existing enabled bao-hourly charge config");
    return;
  }
  if (existing.length > 1) {
    console.error("SETUP FAIL: multiple enabled bao-hourly charge configs in dev — resolve duplicates first.");
    process.exit(1);
  }
  const acct = await rows<{ id: string }>(
    sql`SELECT id FROM ledger_accounts WHERE name = 'Employer Contributions' AND is_active = true`,
  );
  if (acct.length !== 1) {
    console.error("SETUP FAIL: expected exactly one active 'Employer Contributions' ledger account in dev.");
    process.exit(1);
  }
  const cfg = await rows<{ id: string }>(
    sql`INSERT INTO plugin_configs (plugin_kind, plugin_id, enabled, name, sirius_id)
        VALUES ('charge', 'bao-hourly', true, 'S1 SYNC SMOKE bao-hourly (transient)', ${SMOKE_CFG_SIRIUS_ID})
        RETURNING id`,
  );
  await db.execute(
    sql`INSERT INTO plugin_configs_charge (id, scope, account) VALUES (${cfg[0].id}, 'global', ${acct[0].id})`,
  );
  console.log("  seeded transient bao-hourly charge config (removed in cleanup)");
}

async function main() {
  await ensureStagingSchema();
  await ensureIdMap();
  await cleanup();

  // ---- real dev prerequisites ---------------------------------------------
  const polMaps = await rows<{ s1_id: string; s2_id: string }>(
    sql`SELECT m.s1_id, m.s2_id FROM s1_staging.id_map m JOIN policies p ON p.id = m.s2_id
        WHERE m.entity = 'policy' AND NOT m.stub ORDER BY m.s1_id LIMIT 2`,
  );
  if (polMaps.length < 2) {
    console.error("SETUP FAIL: need ≥2 mapped policies in the dev DB (run load-policies first).");
    process.exit(1);
  }
  const [p1Nid, p2Nid] = polMaps.map((m) => Number(m.s1_id));
  const [p1Id, p2Id] = polMaps.map((m) => m.s2_id);

  await ensureHourlyChargeConfig();

  try {
    // =========================================================== phase 1: create
    console.log("phase 1: seed + first loads (create paths)");
    await upsertRecords([
      shopRec("Sync Test Shop 999011", { ebh: [{ policy: p1Nid, date: "2024-01-01" }], current: p1Nid, rates: [{ rate: "6.50", date: "2025-07-01" }] }),
      shopContactRec("Jane Rep", "jane-rep-999@example.com"),
    ]);

    let t7 = runT7();
    check("t7t24 run 1 exits 0", t7.status === 0, t7.result?.rejectGate ?? t7.result?.blockingFindings);
    const emp = await mappingOf("employer", N.sh1);
    const con = await mappingOf("contact", N.sc1);
    check("employer + contact mapped", !!emp && !!con && !emp.stub && !con.stub);
    if (!emp || !con) throw new Error("cannot continue without phase-1 mappings");

    const emp1 = (await rows<any>(sql`SELECT name, sirius_id, denorm_policy_id FROM employers WHERE id = ${emp.s2Id}`))[0];
    check("employer created from shop", emp1?.name === "Sync Test Shop 999011" && emp1?.sirius_id === String(N.sh1), emp1);
    const con1 = (await rows<any>(sql`SELECT display_name, email FROM contacts WHERE id = ${con.s2Id}`))[0];
    check("shop contact created", con1?.display_name === "Jane Rep" && con1?.email === "jane-rep-999@example.com", con1?.display_name);
    const link1 = await rows<any>(sql`SELECT id FROM employer_contacts WHERE employer_id = ${emp.s2Id} AND contact_id = ${con.s2Id}`);
    check("employer↔contact link created", link1.length === 1);
    const phone1 = await rows<any>(sql`SELECT phone_number FROM contact_phone WHERE contact_id = ${con.s2Id}`);
    check("contact phone created", phone1.some((p) => p.phone_number === "+16175550201"), phone1);

    const pol = runPolicies();
    check("policies run 1 exits 0", pol.status === 0, pol.result?.rejectGate);
    const eph1 = await rows<any>(sql`SELECT date, policy_id, data FROM employer_policy_history WHERE employer_id = ${emp.s2Id} ORDER BY date`);
    check("policy history row created", eph1.length === 1 && String(eph1[0].date).startsWith("2024-01-01") && eph1[0].policy_id === p1Id, eph1);
    check("policy history migration-owned", eph1[0]?.data?.source === "s1-migration", eph1[0]?.data);
    const den1 = (await rows<any>(sql`SELECT denorm_policy_id FROM employers WHERE id = ${emp.s2Id}`))[0];
    check("denorm policy = P1", den1?.denorm_policy_id === p1Id, den1);
    check("employer-policy anchor mapped", !!(await mappingOf("employer-policy", N.sh1)));

    const rates1run = runRates();
    if (rates1run.status !== 0 && !rates1run.result?.loader) {
      console.error("SETUP FAIL: rates loader aborted before producing a result — is exactly one enabled bao-hourly charge config present in dev?");
      process.exit(1);
    }
    check("rates run 1 exits 0", rates1run.status === 0, rates1run.result?.rejectGate);
    const rates1 = await rows<any>(sql`SELECT rate, effective_ymd, data FROM sitespecific_bao_employer_rates WHERE employer_id = ${emp.s2Id} ORDER BY effective_ymd`);
    check("rate row created (6.50 @ 2025-07-01)", rates1.length === 1 && Number(rates1[0].rate) === 6.5 && String(rates1[0].effective_ymd).startsWith("2025-07-01"), rates1);
    check("employer-rate anchor mapped", !!(await mappingOf("employer-rate", N.sh1)));

    // =========================================================== phase 2: update
    console.log("phase 2: staged edits converge on re-run");
    await upsertRecords([
      shopRec("Sync Test Shop Renamed", {
        ebh: [
          { policy: p1Nid, date: "2024-01-01" },
          { policy: p2Nid, date: "2025-06-01" },
        ],
        current: p2Nid,
        rates: [
          { rate: "7.25", date: "2025-07-01" },
          { rate: "8.00", date: "2026-01-01" },
        ],
      }),
      shopContactRec("Janet Rep", "janet-rep-999@example.com"),
    ]);

    t7 = runT7();
    check("t7t24 run 2 exits 0 with updates", t7.status === 0 && (t7.result?.summary?.updated ?? 0) >= 1, t7.result?.summary);
    const emp2 = (await rows<any>(sql`SELECT name FROM employers WHERE id = ${emp.s2Id}`))[0];
    check("employer renamed", emp2?.name === "Sync Test Shop Renamed", emp2?.name);
    const con2 = (await rows<any>(sql`SELECT display_name, email FROM contacts WHERE id = ${con.s2Id}`))[0];
    check("contact retitled + email updated", con2?.display_name === "Janet Rep" && con2?.email === "janet-rep-999@example.com", con2?.display_name);

    const pol2 = runPolicies();
    check("policies run 2 exits 0 with updates", pol2.status === 0 && (pol2.result?.summary?.updated ?? 0) >= 1, pol2.result?.summary);
    const eph2 = await rows<any>(sql`SELECT date, policy_id FROM employer_policy_history WHERE employer_id = ${emp.s2Id} ORDER BY date`);
    check("policy history has both entries", eph2.length === 2 && eph2[1].policy_id === p2Id && String(eph2[1].date).startsWith("2025-06-01"), eph2);
    const den2 = (await rows<any>(sql`SELECT denorm_policy_id FROM employers WHERE id = ${emp.s2Id}`))[0];
    check("denorm policy moved to P2", den2?.denorm_policy_id === p2Id, den2);

    const rates2run = runRates();
    check("rates run 2 exits 0", rates2run.status === 0, rates2run.result?.rejectGate);
    const rates2 = await rows<any>(sql`SELECT rate, effective_ymd FROM sitespecific_bao_employer_rates WHERE employer_id = ${emp.s2Id} ORDER BY effective_ymd`);
    check(
      "rate updated + new effective date added",
      rates2.length === 2 && Number(rates2[0].rate) === 7.25 && String(rates2[1].effective_ymd).startsWith("2026-01-01") && Number(rates2[1].rate) === 8,
      rates2,
    );

    // =========================================================== phase 3: collection removal
    console.log("phase 3: entries removed from shop JSON disappear from S2");
    await upsertRecords([
      shopRec("Sync Test Shop Renamed", {
        ebh: [{ policy: p2Nid, date: "2025-06-01" }],
        current: p2Nid,
        rates: [{ rate: "8.00", date: "2026-01-01" }],
      }),
      shopContactRec("Janet Rep", "janet-rep-999@example.com"),
    ]);

    const pol3 = runPolicies();
    check("policies run 3 exits 0", pol3.status === 0, pol3.result?.rejectGate);
    const eph3 = await rows<any>(sql`SELECT date, policy_id FROM employer_policy_history WHERE employer_id = ${emp.s2Id} ORDER BY date`);
    check("vanished policy entry deleted", eph3.length === 1 && eph3[0].policy_id === p2Id, eph3);
    const den3 = (await rows<any>(sql`SELECT denorm_policy_id FROM employers WHERE id = ${emp.s2Id}`))[0];
    check("denorm still P2", den3?.denorm_policy_id === p2Id, den3);

    const rates3run = runRates();
    check("rates run 3 exits 0", rates3run.status === 0, rates3run.result?.rejectGate);
    const rates3 = await rows<any>(sql`SELECT rate, effective_ymd FROM sitespecific_bao_employer_rates WHERE employer_id = ${emp.s2Id}`);
    check("vanished rate row deleted", rates3.length === 1 && String(rates3[0].effective_ymd).startsWith("2026-01-01"), rates3);

    // =========================================================== phase 4: sweeps
    console.log("phase 4a: ledger.policy block stripped → owned history swept");
    await upsertRecords([
      shopRec("Sync Test Shop Renamed", { rates: [{ rate: "8.00", date: "2026-01-01" }] }), // no policy block
    ]);
    const pol4 = runPolicies();
    check("policies sweep run exits 0", pol4.status === 0, pol4.result?.rejectGate);
    check("policies sweep counted a deletion", (pol4.result?.summary?.deleted ?? 0) >= 1, pol4.result?.summary);
    const eph4 = await rows<any>(sql`SELECT id FROM employer_policy_history WHERE employer_id = ${emp.s2Id}`);
    check("owned history rows gone", eph4.length === 0);
    check("employer-policy anchor removed", (await mappingOf("employer-policy", N.sh1)) === null);
    const den4 = (await rows<any>(sql`SELECT denorm_policy_id FROM employers WHERE id = ${emp.s2Id}`))[0];
    check("denorm cleared", den4?.denorm_policy_id == null, den4);

    console.log("phase 4b: staged shop + contact deleted → report-only people, rates swept");
    await db.execute(sql`DELETE FROM s1_staging.records WHERE bundle = 'grievance_shop' AND nid = ${N.sh1}`);
    await db.execute(sql`DELETE FROM s1_staging.records WHERE bundle = 'grievance_shop_contact' AND nid = ${N.sc1}`);

    const t7d = runT7();
    check("t7t24 report-only run exits 0", t7d.status === 0, t7d.result?.blockingFindings);
    check("employer row persists", (await rows<any>(sql`SELECT id FROM employers WHERE id = ${emp.s2Id}`)).length === 1);
    check("contact row persists", (await rows<any>(sql`SELECT id FROM contacts WHERE id = ${con.s2Id}`)).length === 1);
    const findings: any[] = t7d.result?.findings ?? [];
    check(
      "deleted_in_s1 findings for shop + contact",
      findings.some((f) => f.kind === "deleted_in_s1" && f.entity === "employer" && f.s1Id === N.sh1) &&
        findings.some((f) => f.kind === "deleted_in_s1" && f.entity === "contact" && f.s1Id === N.sc1),
      findings.filter((f) => f.kind === "deleted_in_s1").map((f) => `${f.entity}:${f.s1Id}`).slice(0, 20),
    );

    const rates4run = runRates();
    check("rates sweep run exits 0", rates4run.status === 0, rates4run.result?.rejectGate);
    const rates4 = await rows<any>(sql`SELECT id FROM sitespecific_bao_employer_rates WHERE employer_id = ${emp.s2Id}`);
    check("owned rate rows swept after shop deletion", rates4.length === 0);
    check("employer-rate anchor removed", (await mappingOf("employer-rate", N.sh1)) === null);
  } finally {
    console.log("cleanup: removing seeded rows + S2 artifacts");
    await cleanup();
  }

  console.log(failures === 0 ? "\nEMPLOYERS SYNC SMOKE PASS" : `\nEMPLOYERS SYNC SMOKE FAIL (${failures} failures)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("SMOKE CRASH:", e);
  process.exit(1);
});
