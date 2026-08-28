/**
 * Dev-only smoke for the money-loader sync conversion (Task 295 — RUNBOOK
 * §10): t19-payments / t18-ledger reconcile under S1-wins (update changed,
 * sweep deleted), t20-hours stale-key cleanup via the s1_staging.hours_keys
 * sidecar, and a 0-drift verify-balance-parity run at the end.
 *
 * Phase order mirrors the production sync order (Task 414): PAYMENTS, then
 * HOURS, then LEDGER — payment references resolve against a converged t19
 * id_map, and pay-period references resolve against the t20-maintained
 * id_map `payperiod` crosswalk (nid → worker_hours.id). Then CASCADE,
 * REPAIR (one-time repair-hour-links.ts idempotence), and PARITY.
 *
 * Dev-regen fallout this smoke deliberately heals on first run (see
 * memory: s1-regen-idmap-staleness): id_map `payment` rows carry RETIRED
 * nids while staged records carry the new numbering — run1 creates the 30
 * staged payments fresh and the sweep deletes the 30 retired-nid rows
 * (cascading their referencing ledger rows; the ledger phase then rebuilds
 * every staged-Cleared AR row).
 *
 * NEVER restages dev. All staged edits go through upsertRecords /
 * upsertRawLedger with saved-row restores in finally blocks; hash backfill =
 * re-upsert of rows read back from staging.
 *
 * The `cascade` phase (after payments+ledger have converged) covers the
 * cross-loader hole: deleting an S1 payment cascades its referencing AR
 * ledger rows via payments.delete — t19's sweep must drop those rows'
 * `ledger-ar` mappings so the NEXT standard t18 run recreates the
 * still-staged AR rows instead of fast-skipping them as unchanged.
 *
 * Usage: npx tsx scripts/s1-migration/dev/smoke-money-sync.ts \
 *          [--phase payments|hours|ledger|cascade|repair|rerun|parity]
 */
import { spawnSync } from "node:child_process";
import { readFileSync, unlinkSync, existsSync } from "node:fs";
import { db } from "../../../server/storage/db";
import { sql } from "drizzle-orm";
import {
  ensureStagingSchema,
  ensureRawLedgerTable,
  loadRawLedger,
  upsertRawLedger,
  upsertRecords,
  ensureHoursKeysTable,
  type RawLedgerRow,
  type StagedRecord,
} from "../lib/staging";
import { ensureIdMap, getMappings } from "../lib/idmap";
import type { LoaderResult } from "../lib/sync";
import {
  areChargePluginsSuppressed,
  areNotificationsSuppressed,
  requestContext,
  withChargePluginsSuppressed,
  withNotificationsSuppressed,
} from "../../../server/middleware/request-context";
import {
  getAllEnabledChargePlugins,
  hasRunnableChargePlugins,
} from "../../../server/plugins/ledger/charge";
import { baoHourlyChargePlugin } from "../../../server/plugins/ledger/charge/plugins/sitespecific-bao-hourly";

const PHASE = (() => {
  const i = process.argv.indexOf("--phase");
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : "all";
})();

let failures = 0;
const check = (name: string, ok: boolean, detail?: string) => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
const rowsOf = (r: unknown) => (r as { rows: Array<Record<string, any>> }).rows;

interface MoneySnapshot {
  ordinaryLedger: Map<string, { count: number; cents: number; ids: string }>;
  ledgerEa: Map<string, { count: number; ids: string }>;
  importedLedger: { count: number; cents: number };
  payments: { count: number; cents: number };
  hours: { count: number; hours: number };
}

async function moneySnapshot(): Promise<MoneySnapshot> {
  const ordinaryLedger = new Map<string, { count: number; cents: number; ids: string }>();
  for (const r of rowsOf(await db.execute(sql`
    SELECT charge_plugin, coalesce(charge_plugin_config_id, 'none') AS config_id,
           coalesce(reference_type, 'none') AS reference_type,
           coalesce(data->>'source', data->>'pluginId', 'none') AS provenance,
           count(*)::int AS n, coalesce(sum(round(amount * 100)), 0)::bigint AS cents,
           string_agg(id, ',' ORDER BY id) AS ids
      FROM ledger WHERE charge_plugin <> 's1-import'
     GROUP BY charge_plugin, charge_plugin_config_id, reference_type,
              coalesce(data->>'source', data->>'pluginId', 'none')
  `))) {
    ordinaryLedger.set(
      `${r.charge_plugin}|${r.config_id}|${r.reference_type}|${r.provenance}`,
      { count: Number(r.n), cents: Number(r.cents), ids: String(r.ids) },
    );
  }
  const ledgerEa = new Map<string, { count: number; ids: string }>();
  for (const r of rowsOf(await db.execute(sql`
    SELECT account_id, entity_type, count(*)::int AS n,
           string_agg(id, ',' ORDER BY id) AS ids
      FROM ledger_ea GROUP BY account_id, entity_type
  `))) {
    ledgerEa.set(
      `${r.account_id}|${r.entity_type}`,
      { count: Number(r.n), ids: String(r.ids) },
    );
  }
  const imported = rowsOf(await db.execute(sql`
    SELECT count(*)::int AS n, coalesce(sum(round(amount * 100)), 0)::bigint AS cents
      FROM ledger WHERE charge_plugin = 's1-import'
  `))[0];
  const payments = rowsOf(await db.execute(sql`
    SELECT count(*)::int AS n, coalesce(sum(round(amount * 100)), 0)::bigint AS cents FROM ledger_payments
  `))[0];
  const hours = rowsOf(await db.execute(sql`
    SELECT count(*)::int AS n, coalesce(sum(hours), 0)::float8 AS hours FROM worker_hours
  `))[0];
  return {
    ordinaryLedger,
    ledgerEa,
    importedLedger: { count: Number(imported.n), cents: Number(imported.cents) },
    payments: { count: Number(payments.n), cents: Number(payments.cents) },
    hours: { count: Number(hours.n), hours: Number(hours.hours) },
  };
}

function changes<T>(
  before: Map<string, T>,
  after: Map<string, T>,
  equal: (a: T | undefined, b: T | undefined) => boolean,
  render: (key: string, before: T | undefined, after: T | undefined) => string,
): string[] {
  const out: string[] = [];
  for (const key of new Set([...before.keys(), ...after.keys()])) {
    const prior = before.get(key);
    const current = after.get(key);
    if (!equal(prior, current)) out.push(render(key, prior, current));
  }
  return out;
}

function assertNoOrdinaryBilling(loader: string, before: MoneySnapshot, after: MoneySnapshot): void {
  const entries = changes(
    before.ordinaryLedger,
    after.ordinaryLedger,
    (a, b) => a?.count === b?.count && a?.cents === b?.cents && a?.ids === b?.ids,
    (key, prior, current) =>
      `${key} rows ${prior?.count ?? 0}→${current?.count ?? 0}, cents ${prior?.cents ?? 0}→${current?.cents ?? 0}`,
  );
  const eas = changes(
    before.ledgerEa,
    after.ledgerEa,
    (a, b) => a?.count === b?.count && a?.ids === b?.ids,
    (key, prior, current) => `ledger_ea ${key} rows ${prior?.count ?? 0}→${current?.count ?? 0}`,
  );
  check(
    `billing guard: ${loader} created no ordinary charge state`,
    entries.length === 0 && eas.length === 0,
    [...entries, ...eas].slice(0, 8).join("; "),
  );
}

// ---------------------------------------------------------------------------
// Loader spawn harness (loaders call process.exit) — envelope via
// S1_RESULT_JSON_PATH, same pattern as smoke-sync-foundation.
// ---------------------------------------------------------------------------
let runSeq = 0;
async function runLoader(script: string, args: string[], extraEnv?: Record<string, string>): Promise<{ code: number; result: LoaderResult | null; stdout: string; stderr: string }> {
  // The parent smoke owns the snapshot because each loader is a child process.
  // Every run, including edit/sweep cases, must leave ordinary billing untouched.
  const before = await moneySnapshot();
  const resultPath = `/tmp/t295-smoke-result-${process.pid}-${++runSeq}.json`;
  const t0 = Date.now();
  const proc = spawnSync("npx", ["tsx", `scripts/s1-migration/${script}`, ...args], {
    cwd: process.cwd(),
    env: { ...process.env, ...(extraEnv ?? {}), S1_RESULT_JSON_PATH: resultPath },
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  let result: LoaderResult | null = null;
  if (existsSync(resultPath)) {
    try {
      result = JSON.parse(readFileSync(resultPath, "utf8")) as LoaderResult;
    } catch { /* leave null */ }
    try { unlinkSync(resultPath); } catch { /* ignore */ }
  }
  console.log(`  · ${script} ${args.join(" ")} → exit ${proc.status} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  if (result == null) {
    console.log(`  · NO RESULT ENVELOPE — stdout tail:\n${(proc.stdout ?? "").slice(-2000)}\n  · stderr tail:\n${(proc.stderr ?? "").slice(-2000)}`);
  } else if (proc.status !== 0) {
    console.log(`  · stderr tail:\n${(proc.stderr ?? "").slice(-800)}`);
  }
  const after = await moneySnapshot();
  assertNoOrdinaryBilling(script, before, after);
  return { code: proc.status ?? -1, result, stdout: proc.stdout ?? "", stderr: proc.stderr ?? "" };
}

// ---------------------------------------------------------------------------
// Staged-row save/restore helpers (never restage dev)
// ---------------------------------------------------------------------------
async function readRecord(bundle: string, nid: number): Promise<StagedRecord> {
  const r = rowsOf(await db.execute(sql`
    SELECT bundle, nid, vid, title, uid, status, created, changed, fields
      FROM s1_staging.records WHERE bundle = ${bundle} AND nid = ${nid}
  `))[0];
  if (!r) throw new Error(`record ${bundle}/${nid} not staged`);
  return {
    bundle: String(r.bundle),
    nid: Number(r.nid),
    vid: r.vid == null ? null : Number(r.vid),
    title: r.title == null ? null : String(r.title),
    uid: r.uid == null ? null : Number(r.uid),
    status: r.status == null ? null : Number(r.status),
    created: r.created == null ? null : Number(r.created),
    changed: r.changed == null ? null : Number(r.changed),
    fields: (typeof r.fields === "string" ? JSON.parse(r.fields) : r.fields ?? {}) as Record<string, unknown>,
  };
}

async function readArRow(ledgerId: number): Promise<RawLedgerRow> {
  const row = (await loadRawLedger()).find((r) => r.ledgerId === ledgerId);
  if (!row) throw new Error(`AR row ${ledgerId} not staged`);
  return row;
}

async function s2LedgerByKey(key: string): Promise<{ id: string; amount: string; memo: string | null } | null> {
  const r = rowsOf(await db.execute(sql`
    SELECT id, amount::text AS amount, memo FROM ledger
     WHERE charge_plugin = 's1-import' AND charge_plugin_key = ${key}
  `))[0];
  return r ? { id: String(r.id), amount: String(r.amount), memo: r.memo == null ? null : String(r.memo) } : null;
}

async function s2PaymentByNid(nid: number): Promise<{ id: string; status: string; allocated: boolean; amount: string; dateCleared: string | null } | null> {
  const r = rowsOf(await db.execute(sql`
    SELECT p.id, p.status, p.allocated, p.amount::text AS amount, p.date_cleared
      FROM ledger_payments p JOIN s1_staging.id_map m ON m.s2_id = p.id
     WHERE m.entity = 'payment' AND m.s1_id = ${nid}
  `))[0];
  return r
    ? { id: String(r.id), status: String(r.status), allocated: Boolean(r.allocated), amount: String(r.amount), dateCleared: r.date_cleared == null ? null : String(r.date_cleared) }
    : null;
}

// ---------------------------------------------------------------------------
// Phase: payments (t19) — runs FIRST (production order: t19 before t18)
// ---------------------------------------------------------------------------
const T19 = "load-payments.ts";
const T18 = "load-ledger.ts";
const T18_FLAGS = ["--allow-rejects", "non_cleared_status"]; // dev staging holds 2 non-Cleared AR rows (prod is 100% Cleared)

interface BillingFixture {
  configId: string;
  rateId: string;
  fixtureEaId: string | null;
}

async function removeBillingFixture(fixture: BillingFixture): Promise<void> {
  // If the guard did its job and caught a lost suppression wrapper, remove the
  // resulting fixture-owned base/adjustment rows before removing their config.
  // The assertion failure remains recorded; teardown keeps the scratch/dev DB
  // reusable after the intentional regression signal.
  await db.execute(sql`
    DELETE FROM ledger WHERE charge_plugin_config_id = ${fixture.configId}
  `);
  await db.execute(sql`DELETE FROM plugin_configs WHERE id = ${fixture.configId}`);
  await db.execute(sql`DELETE FROM sitespecific_bao_employer_rates WHERE id = ${fixture.rateId}`);
  if (fixture.fixtureEaId) {
    await db.execute(sql`
      DELETE FROM ledger_ea
       WHERE id = ${fixture.fixtureEaId}
         AND NOT EXISTS (SELECT 1 FROM ledger WHERE ea_id = ${fixture.fixtureEaId})
         AND NOT EXISTS (SELECT 1 FROM ledger_payments WHERE ledger_ea_id = ${fixture.fixtureEaId})
    `);
  }
}

/**
 * Install a real, employer-scoped BAO hourly config and non-zero rate for one
 * staged hours row. Calling the plugin directly proves the fixture would
 * produce a transaction if the loader lost its suppression wrapper; the
 * returned transaction is deliberately not persisted.
 */
async function installBillingFixture(): Promise<BillingFixture> {
  console.log("== setup: runnable charge fixture ==");
  const enabledBao = (await getAllEnabledChargePlugins()).some((p) => p.metadata.id === "bao-hourly");
  check("fixture: sitespecific.bao charge plugin is component-enabled", enabledBao);
  if (!enabledBao) throw new Error("bao-hourly is not component-enabled; cannot prove loader suppression");

  const groups = await payperiodGroups();
  let target: {
    hoursId: string;
    workerId: string;
    employerId: string;
    year: number;
    month: number;
    hours: number;
    employmentStatusId: string;
  } | null = null;
  for (const g of groups) {
    const wm = (await getMappings("worker", [g.workerNid])).get(g.workerNid);
    const em = (await getMappings("employer", [g.employerNid])).get(g.employerNid);
    if (!wm || !em) continue;
    const h = rowsOf(await db.execute(sql`
      SELECT id, hours, employment_status_id
        FROM worker_hours
       WHERE worker_id = ${wm.s2Id} AND employer_id = ${em.s2Id}
         AND year = ${g.year} AND month = ${g.month} AND day = 1
         AND hours <> 0
       LIMIT 1
    `))[0];
    if (!h) continue;
    target = {
      hoursId: String(h.id),
      workerId: wm.s2Id,
      employerId: em.s2Id,
      year: g.year,
      month: g.month,
      hours: Number(h.hours),
      employmentStatusId: String(h.employment_status_id),
    };
    break;
  }
  check("fixture: found a staged non-zero hours row", target != null);
  if (!target) throw new Error("no staged non-zero mapped hours row available for billing fixture");

  const effectiveYmd = `${target.year}-${String(target.month).padStart(2, "0")}-01`;
  const account = rowsOf(await db.execute(sql`
    SELECT a.id
      FROM ledger_accounts a
     WHERE NOT EXISTS (
       SELECT 1 FROM sitespecific_bao_employer_rates r
        WHERE r.employer_id = ${target.employerId}
          AND r.account_id = a.id
          AND r.effective_ymd = ${effectiveYmd}
     )
     ORDER BY a.id LIMIT 1
  `))[0];
  check("fixture: found an account with a free effective-date rate slot", account != null);
  if (!account) throw new Error("no ledger account available for isolated BAO rate fixture");
  const accountId = String(account.id);

  let configId: string | null = null;
  let rateId: string | null = null;
  let fixtureEaId: string | null = null;
  try {
    const config = rowsOf(await db.execute(sql`
      INSERT INTO plugin_configs
        (plugin_kind, plugin_id, enabled, name, ordering, is_singleton, data)
      VALUES
        ('charge', 'bao-hourly', true, '__money sync suppression probe', 0, false,
         ${JSON.stringify({ billedEmploymentStatusIds: [target.employmentStatusId] })}::jsonb)
      RETURNING id
    `))[0];
    configId = String(config.id);
    await db.execute(sql`
      INSERT INTO plugin_configs_charge (id, scope, employer_id, account)
      VALUES (${configId}, 'employer', ${target.employerId}, ${accountId})
    `);
    const rate = rowsOf(await db.execute(sql`
      INSERT INTO sitespecific_bao_employer_rates
        (employer_id, account_id, rate, effective_ymd, source_id, data)
      VALUES
        (${target.employerId}, ${accountId}, '0.0100', ${effectiveYmd}, NULL,
         '{"fixture":"money-sync-suppression"}'::jsonb)
      RETURNING id
    `))[0];
    rateId = String(rate.id);
    const existingEa = rowsOf(await db.execute(sql`
      SELECT id FROM ledger_ea WHERE account_id = ${accountId} AND entity_id = ${target.employerId}
    `))[0];
    const now = new Date();
    const probe = await baoHourlyChargePlugin.execute(
      {
        trigger: "hours_saved",
        hoursId: target.hoursId,
        workerId: target.workerId,
        employerId: target.employerId,
        year: target.year,
        month: target.month,
        day: 1,
        hours: target.hours,
        employmentStatusId: target.employmentStatusId,
        home: true,
      } as any,
      {
        id: configId,
        pluginId: "bao-hourly",
        name: "__money sync suppression probe",
        enabled: true,
        scope: "employer",
        employerId: target.employerId,
        account: accountId,
        settings: { billedEmploymentStatusIds: [target.employmentStatusId] },
        createdAt: now,
        updatedAt: now,
      },
    );
    const createdEa = rowsOf(await db.execute(sql`
      SELECT id FROM ledger_ea WHERE account_id = ${accountId} AND entity_id = ${target.employerId}
    `))[0];
    if (!existingEa && createdEa) fixtureEaId = String(createdEa.id);
    check(
      "fixture: unsuppressed BAO plugin would create a non-zero charge",
      probe.success && probe.transactions.length === 1 && Number(probe.transactions[0].amount) !== 0,
      `transactions=${probe.transactions.length} amount=${probe.transactions[0]?.amount ?? "none"} ` +
        `message=${probe.message ?? "none"} error=${probe.error ?? "none"}`,
    );

    const runnable = await hasRunnableChargePlugins();
    check(
      "fixture: charge preflight reports bao-hourly runnable",
      runnable.runnable && runnable.pluginIds.includes("bao-hourly"),
      JSON.stringify(runnable.pluginIds),
    );
    if (!probe.success || probe.transactions.length !== 1 || Number(probe.transactions[0].amount) === 0) {
      throw new Error("billing fixture is inert");
    }
    if (!runnable.runnable || !runnable.pluginIds.includes("bao-hourly")) {
      throw new Error("billing fixture is not runnable through the executor");
    }
    return { configId, rateId, fixtureEaId };
  } catch (error) {
    if (configId) {
      await db.execute(sql`DELETE FROM ledger WHERE charge_plugin_config_id = ${configId}`);
      await db.execute(sql`DELETE FROM plugin_configs WHERE id = ${configId}`);
    }
    if (rateId) await db.execute(sql`DELETE FROM sitespecific_bao_employer_rates WHERE id = ${rateId}`);
    if (fixtureEaId) {
      await db.execute(sql`
        DELETE FROM ledger_ea
         WHERE id = ${fixtureEaId}
           AND NOT EXISTS (SELECT 1 FROM ledger WHERE ea_id = ${fixtureEaId})
           AND NOT EXISTS (SELECT 1 FROM ledger_payments WHERE ledger_ea_id = ${fixtureEaId})
      `);
    }
    throw error;
  }
}

async function phasePayments(): Promise<void> {
  console.log("== phase: payments (t19 reconcile) ==");
  const nullHash = rowsOf(await db.execute(sql`
    SELECT count(*) FILTER (WHERE content_hash IS NULL)::int AS n FROM s1_staging.records WHERE bundle = 'sirius_payment'
  `))[0];
  check("pay prep: staged payment hashes present", Number(nullHash.n) === 0, `nullHashes=${nullHash.n}`);

  // run1: baseline. Heals dev regen fallout — staged (new) nids all create;
  // retired-nid mappings sweep (payment delete cascades referencing ledger
  // rows; the ledger phase rebuilds them).
  const r1 = await runLoader(T19, []);
  check("pay run1: exit 0", r1.code === 0);
  check("pay run1: envelope present", r1.result != null);
  if (!r1.result) return;
  const s1 = r1.result.summary;
  check("pay run1: converged (created+updated+unchanged == staged)", s1.created + s1.updated + s1.unchanged === Number(r1.result.detail.staged), JSON.stringify(s1));
  check("pay run1: verify pass", r1.result.verify.status === "pass", JSON.stringify(r1.result.verify));
  const aligned = rowsOf(await db.execute(sql`
    SELECT count(*)::int AS mapped,
           (SELECT count(*)::int FROM s1_staging.records r WHERE r.bundle = 'sirius_payment') AS staged,
           count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM s1_staging.records r WHERE r.bundle = 'sirius_payment' AND r.nid = m.s1_id))::int AS stale
      FROM s1_staging.id_map m WHERE m.entity = 'payment' AND m.stub = false
  `))[0];
  check("pay run1: id_map aligned to staged nids", Number(aligned.mapped) === Number(aligned.staged) && Number(aligned.stale) === 0, JSON.stringify(aligned));

  // run2: all-unchanged fast path
  const r2 = await runLoader(T19, []);
  check("pay run2: exit 0", r2.code === 0);
  const s2 = r2.result!.summary;
  check("pay run2: created=0 updated=0 deleted=0", s2.created === 0 && s2.updated === 0 && s2.deleted === 0, JSON.stringify(s2));
  check("pay run2: all unchanged", s2.unchanged > 0 && s2.unchanged === s1.created + s1.updated + s1.unchanged, JSON.stringify(s2));

  // pick a mapped Cleared payment for the status-flip edit
  const pick = rowsOf(await db.execute(sql`
    SELECT m.s1_id AS nid FROM s1_staging.id_map m
      JOIN s1_staging.records r ON r.bundle = 'sirius_payment' AND r.nid = m.s1_id
     WHERE m.entity = 'payment' AND m.stub = false
       AND lower(trim(r.fields->>'field_sirius_payment_status')) = 'cleared'
     ORDER BY m.s1_id LIMIT 1
  `))[0];
  if (!pick) { check("pay edit: found a mapped Cleared payment", false); return; }
  const nid = Number(pick.nid);
  const saved = await readRecord("sirius_payment", nid);
  try {
    // status flip Cleared → Canceled: S2 row must follow (status, allocated, dateCleared)
    await upsertRecords([{ ...saved, fields: { ...saved.fields, field_sirius_payment_status: "Canceled" } }]);
    const r3 = await runLoader(T19, []);
    check("pay run3 (status flip): exit 0", r3.code === 0);
    check("pay run3: updated=1", r3.result!.summary.updated === 1, JSON.stringify(r3.result!.summary));
    const p3 = await s2PaymentByNid(nid);
    check("pay run3: S2 status canceled, allocated=false, dateCleared null",
      p3 != null && p3.status === "canceled" && p3.allocated === false && p3.dateCleared === null,
      JSON.stringify(p3));

    // amount edit on the same (still-Canceled) payment
    const amt = String(saved.fields["field_sirius_dollar_amt"] ?? "0");
    const newAmt = amt === "123.45" ? "123.46" : "123.45";
    await upsertRecords([{ ...saved, fields: { ...saved.fields, field_sirius_payment_status: "Canceled", field_sirius_dollar_amt: newAmt } }]);
    const r4 = await runLoader(T19, []);
    check("pay run4 (amount edit): exit 0", r4.code === 0);
    check("pay run4: updated=1", r4.result!.summary.updated === 1, JSON.stringify(r4.result!.summary));
    const p4 = await s2PaymentByNid(nid);
    check("pay run4: S2 amount follows S1", p4 != null && Number(p4.amount) === Number(newAmt), `amount=${p4?.amount} want=${newAmt}`);
  } finally {
    await upsertRecords([saved]);
  }
  const r5 = await runLoader(T19, []);
  check("pay run5 (restore): exit 0", r5.code === 0);
  check("pay run5: updated=1 (healed back)", r5.result!.summary.updated === 1, JSON.stringify(r5.result!.summary));
  const p5 = await s2PaymentByNid(nid);
  check("pay run5: S2 back to cleared/allocated", p5 != null && p5.status === "cleared" && p5.allocated === true && p5.dateCleared != null, JSON.stringify(p5));

  // S1-deletion coverage (payment + mapping removed, recreate under a new
  // id, cascade fallout convergence) lives in the `cascade` phase — on a
  // converged target every payment has referencing AR rows, so a
  // "reference-free delete" scenario has no valid pick here.
}

// ---------------------------------------------------------------------------
// Phase: ledger (t18)
// ---------------------------------------------------------------------------
// Synthetic ledger_id for the seeded payperiod-referencing AR fake (Task
// 414): dev staging carries no AR rows whose reference targets a payperiod,
// so the hour-resolution and repair wet paths would silently skip. Seeded in
// phaseLedger, cleaned up (staged row deleted + swept) at the end of
// phaseRepair; the row is consistent on both sides so parity stays 0-drift
// even when phases run separately.
const PP_FAKE_LEDGER_ID = 990000414;

async function seedPayperiodArFake(): Promise<boolean> {
  const tmpl = rowsOf(await db.execute(sql`
    SELECT a.ledger_account, a.ledger_participant
      FROM s1_staging.raw_ledger_ar a
     WHERE lower(trim(coalesce(a.ledger_status,''))) = 'cleared'
       AND a.ledger_account IS NOT NULL AND a.ledger_participant IS NOT NULL
       AND a.ledger_id <> ${PP_FAKE_LEDGER_ID}
     ORDER BY a.ledger_id LIMIT 1
  `))[0];
  const pp = rowsOf(await db.execute(sql`
    SELECT m.s1_id FROM s1_staging.id_map m
      JOIN s1_staging.records r ON r.nid = m.s1_id AND r.bundle = 'sirius_payperiod'
     WHERE m.entity = 'payperiod' ORDER BY m.s1_id LIMIT 1
  `))[0];
  if (!tmpl || !pp) return false;
  await upsertRawLedger([{
    ledgerId: PP_FAKE_LEDGER_ID,
    amount: "12.34",
    status: "Cleared",
    account: Number(tmpl.ledger_account),
    participant: Number(tmpl.ledger_participant),
    reference: Number(pp.s1_id),
    ts: 1700000000,
    memo: "smoke payperiod-ref fake (Task 414)",
    key: null,
    json: null,
    contentHash: null,
  }]);
  return true;
}

async function removePayperiodArFake(): Promise<void> {
  const staged = rowsOf(await db.execute(sql`
    SELECT 1 FROM s1_staging.raw_ledger_ar WHERE ledger_id = ${PP_FAKE_LEDGER_ID}
  `)).length > 0;
  if (!staged) return;
  await db.execute(sql`DELETE FROM s1_staging.raw_ledger_ar WHERE ledger_id = ${PP_FAKE_LEDGER_ID}`);
  const r = await runLoader(T18, T18_FLAGS); // sweep removes the S2 row + mapping
  check("rpr cleanup: t18 sweep of the seeded payperiod fake exits 0", r.code === 0);
  const left = rowsOf(await db.execute(sql`
    SELECT count(*)::int AS n FROM ledger WHERE charge_plugin_key = ${"ar-" + PP_FAKE_LEDGER_ID}
  `))[0];
  check("rpr cleanup: seeded fake swept from S2", Number(left.n) === 0, `left=${left.n}`);
}

async function phaseLedger(): Promise<void> {
  console.log("== phase: ledger (t18 reconcile) ==");
  // hash backfill: dev raw AR rows were staged before the sync upgrade
  await upsertRawLedger(await loadRawLedger());
  // seed the payperiod-referencing AR fake so the hour-resolution path runs
  const seeded = await seedPayperiodArFake();
  if (!seeded) console.log("  · could not seed payperiod AR fake (no template/crosswalk row) — hour-link checks will skip");
  const nulls = rowsOf(await db.execute(sql`SELECT count(*) FILTER (WHERE content_hash IS NULL)::int AS n FROM s1_staging.raw_ledger_ar`))[0];
  check("ldg prep: AR content hashes backfilled", Number(nulls.n) === 0, `nullHashes=${nulls.n}`);

  // run1: baseline — mass-adopts pre-sync rows into id_map `ledger-ar`,
  // rebuilds rows the payments-phase sweep cascaded away, sweeps AR keys no
  // longer staged-Cleared. Per-account verify (post-sweep) must pass.
  const r1 = await runLoader(T18, T18_FLAGS);
  check("ldg run1: exit 0", r1.code === 0);
  check("ldg run1: envelope present", r1.result != null);
  if (!r1.result) return;
  check("ldg run1: verify pass", r1.result.verify.status === "pass", JSON.stringify(r1.result.detail.perAccount ?? {}));
  const mapped = rowsOf(await db.execute(sql`SELECT count(*)::int AS n FROM s1_staging.id_map WHERE entity = 'ledger-ar' AND stub = false`))[0];
  const cleared = rowsOf(await db.execute(sql`
    SELECT count(*)::int AS n FROM s1_staging.raw_ledger_ar WHERE lower(trim(coalesce(ledger_status,''))) = 'cleared'
  `))[0];
  check("ldg run1: every staged-Cleared row mapped", Number(mapped.n) === Number(cleared.n), `mapped=${mapped.n} cleared=${cleared.n}`);
  // t19-before-t18 ordering proof: allocation rows resolve payment references
  const refTypes = (r1.result.detail.referenceTypes ?? {}) as Record<string, number>;
  check("ldg run1: payment references resolved", Number(refTypes.payment ?? 0) > 0, JSON.stringify(refTypes));
  // t20-before-t18 ordering proof (Task 414): AR rows referencing staged
  // payperiods must resolve through the crosswalk as referenceType 'hour'.
  // Conditional — dev staging may carry no payperiod-referencing AR rows.
  const ppRefs = rowsOf(await db.execute(sql`
    SELECT count(*)::int AS n
      FROM s1_staging.raw_ledger_ar a
      JOIN s1_staging.records r ON r.nid = a.ledger_reference AND r.bundle = 'sirius_payperiod'
      JOIN s1_staging.id_map m ON m.entity = 'payperiod' AND m.s1_id = a.ledger_reference
     WHERE lower(trim(coalesce(a.ledger_status,''))) = 'cleared'
  `))[0];
  if (Number(ppRefs.n) > 0) {
    check("ldg run1: pay-period references resolved via crosswalk", Number(refTypes.hour ?? 0) > 0, JSON.stringify({ refTypes, crosswalkResolvable: ppRefs.n }));
    const linked = rowsOf(await db.execute(sql`
      SELECT count(*)::int AS n FROM ledger
       WHERE charge_plugin = 's1-import' AND reference_type = 'hour'
    `))[0];
    check("ldg run1: linked s1-import hour rows exist", Number(linked.n) > 0, `linked=${linked.n}`);

    // ---- drifted hour-link heal (Task 414): a payperiod retargeted or
    // deleted in S1 changes the crosswalk WITHOUT changing the AR row's
    // source content, so t18 must re-check linked rows against the current
    // crosswalk each run (refHeal.hourDrift) instead of fast-skipping them.
    // The crosswalk mutations below are exactly what a t20 run performs on a
    // retarget (OVERWRITE repoint) / S1 delete (mapping retirement) — the
    // t20 side of those transitions is asserted in the hours phase.
    const fakeKey = `ar-${PP_FAKE_LEDGER_ID}`;
    const fakeRow = rowsOf(await db.execute(sql`
      SELECT reference_id, (data->>'s1ReferenceNid')::bigint AS nid FROM ledger WHERE charge_plugin_key = ${fakeKey}
    `))[0];
    if (fakeRow) {
      const otherHours = rowsOf(await db.execute(sql`
        SELECT id FROM worker_hours WHERE id <> ${fakeRow.reference_id} LIMIT 1
      `))[0];
      const importedBefore = rowsOf(await db.execute(sql`SELECT count(*)::int AS n FROM ledger WHERE charge_plugin = 's1-import'`))[0];

      // (a) repoint: crosswalk now targets a different hours row → t18 must follow
      await db.execute(sql`
        UPDATE s1_staging.id_map SET s2_id = ${otherHours.id} WHERE entity = 'payperiod' AND s1_id = ${fakeRow.nid}
      `);
      const rRepoint = await runLoader(T18, T18_FLAGS);
      check("ldg drift: repoint run exit 0", rRepoint.code === 0);
      check(
        "ldg drift: refHeal reports the drifted hour link",
        Number((rRepoint.result?.detail?.refHeal as any)?.hourDrift ?? 0) >= 1,
        JSON.stringify(rRepoint.result?.detail?.refHeal),
      );
      const afterRepoint = rowsOf(await db.execute(sql`SELECT reference_type, reference_id FROM ledger WHERE charge_plugin_key = ${fakeKey}`))[0];
      check(
        "ldg drift: ledger reference follows the repointed crosswalk",
        afterRepoint.reference_type === "hour" && afterRepoint.reference_id === otherHours.id,
        JSON.stringify(afterRepoint),
      );

      // (b) retire: mapping deleted (payperiod gone in S1) → t18 must degrade
      await db.execute(sql`DELETE FROM s1_staging.id_map WHERE entity = 'payperiod' AND s1_id = ${fakeRow.nid}`);
      const rRetire = await runLoader(T18, T18_FLAGS);
      check("ldg drift: retire run exit 0", rRetire.code === 0);
      const afterRetire = rowsOf(await db.execute(sql`SELECT reference_type, reference_id FROM ledger WHERE charge_plugin_key = ${fakeKey}`))[0];
      check(
        "ldg drift: retired mapping degrades the link to s1-unknown",
        afterRetire.reference_type === "s1-unknown" && afterRetire.reference_id === String(fakeRow.nid),
        JSON.stringify(afterRetire),
      );

      // (c) restore: mapping back → the existing s1-unknown heal relinks it
      await db.execute(sql`
        INSERT INTO s1_staging.id_map (entity, s1_id, s2_id, stub, loader, last_synced_at)
        VALUES ('payperiod', ${fakeRow.nid}, ${fakeRow.reference_id}, false, 'load-hours', now())
        ON CONFLICT (entity, s1_id) DO UPDATE SET s2_id = EXCLUDED.s2_id, last_synced_at = now()
      `);
      const rRestore = await runLoader(T18, T18_FLAGS);
      check("ldg drift: restore run exit 0", rRestore.code === 0);
      const afterRestore = rowsOf(await db.execute(sql`SELECT reference_type, reference_id FROM ledger WHERE charge_plugin_key = ${fakeKey}`))[0];
      check(
        "ldg drift: restored mapping relinks to the original hours row",
        afterRestore.reference_type === "hour" && afterRestore.reference_id === fakeRow.reference_id,
        JSON.stringify(afterRestore),
      );
      // throughout: the imported fact stayed a single s1-import row — no
      // duplicate charge state was created by any of the three runs
      const importedAfter = rowsOf(await db.execute(sql`SELECT count(*)::int AS n FROM ledger WHERE charge_plugin = 's1-import'`))[0];
      check("ldg drift: no duplicate imported/billing rows created", Number(importedAfter.n) === Number(importedBefore.n), `before=${importedBefore.n} after=${importedAfter.n}`);
    } else {
      console.log("  · seeded payperiod fake not present — drift checks skipped");
    }
  } else {
    console.log("  · no crosswalk-resolvable payperiod AR references in dev staging — hour-link checks skipped");
  }

  // run2: all-unchanged fast path
  const r2 = await runLoader(T18, T18_FLAGS);
  check("ldg run2: exit 0", r2.code === 0);
  const s2 = r2.result!.summary;
  check("ldg run2: created=0 updated=0 deleted=0", s2.created === 0 && s2.updated === 0 && s2.deleted === 0, JSON.stringify(s2));
  check("ldg run2: all unchanged", s2.unchanged === Number(mapped.n), JSON.stringify(s2));

  // pick a mapped Cleared row and edit amount + memo (S1 wins)
  const pick = rowsOf(await db.execute(sql`
    SELECT m.s1_id AS lid FROM s1_staging.id_map m
      JOIN s1_staging.raw_ledger_ar s ON s.ledger_id = m.s1_id
     WHERE m.entity = 'ledger-ar' AND m.stub = false
       AND lower(trim(coalesce(s.ledger_status,''))) = 'cleared'
     ORDER BY m.s1_id LIMIT 3
  `));
  if (pick.length < 3) { check("ldg edits: found 3 mapped Cleared AR rows", false, `found=${pick.length}`); return; }
  const editId = Number(pick[0].lid);
  const flipId = Number(pick[1].lid);
  const delId = Number(pick[2].lid);

  const editSaved = await readArRow(editId);
  try {
    const newAmt = editSaved.amount === "77.77" ? "77.78" : "77.77";
    await upsertRawLedger([{ ...editSaved, amount: newAmt, memo: `${editSaved.memo ?? ""} EDIT295`.trim() }]);
    const r3 = await runLoader(T18, T18_FLAGS);
    check("ldg run3 (amount+memo edit): exit 0", r3.code === 0);
    check("ldg run3: updated=1", r3.result!.summary.updated === 1, JSON.stringify(r3.result!.summary));
    const row3 = await s2LedgerByKey(`ar-${editId}`);
    check("ldg run3: S2 amount+memo follow S1", row3 != null && Number(row3.amount) === Number(newAmt) && (row3.memo ?? "").includes("EDIT295"), JSON.stringify(row3));
    const fp3 = (await getMappings("ledger-ar", [editId])).get(editId);
    const stagedHash3 = rowsOf(await db.execute(sql`SELECT content_hash FROM s1_staging.raw_ledger_ar WHERE ledger_id = ${editId}`))[0].content_hash;
    check("ldg run3: fingerprint advanced post-verify", fp3?.consumedFingerprint === String(stagedHash3));
  } finally {
    await upsertRawLedger([editSaved]);
  }
  const r4 = await runLoader(T18, T18_FLAGS);
  check("ldg run4 (restore): exit 0", r4.code === 0);
  check("ldg run4: updated=1 (healed back)", r4.result!.summary.updated === 1, JSON.stringify(r4.result!.summary));

  // status flip Cleared → Pending: row must SWEEP (plus one more allowed
  // non_cleared_status reject); restore recreates it.
  const flipSaved = await readArRow(flipId);
  try {
    await upsertRawLedger([{ ...flipSaved, status: "Pending" }]);
    const r5 = await runLoader(T18, T18_FLAGS);
    check("ldg run5 (status flip): exit 0", r5.code === 0);
    check("ldg run5: deleted=1", r5.result!.summary.deleted === 1, JSON.stringify(r5.result!.summary));
    check("ldg run5: verify pass post-sweep", r5.result!.verify.status === "pass");
    check("ldg run5: S2 row gone", (await s2LedgerByKey(`ar-${flipId}`)) === null);
    check("ldg run5: mapping gone", !(await getMappings("ledger-ar", [flipId])).has(flipId));
  } finally {
    await upsertRawLedger([flipSaved]);
  }
  const r6 = await runLoader(T18, T18_FLAGS);
  check("ldg run6 (restore): exit 0", r6.code === 0);
  check("ldg run6: created=1", r6.result!.summary.created === 1, JSON.stringify(r6.result!.summary));
  check("ldg run6: S2 row recreated", (await s2LedgerByKey(`ar-${flipId}`)) !== null);

  // hard delete the staged row: sweep removes S2 row + mapping; restore recreates.
  const delSaved = await readArRow(delId);
  try {
    await db.execute(sql`DELETE FROM s1_staging.raw_ledger_ar WHERE ledger_id = ${delId}`);
    const r7 = await runLoader(T18, T18_FLAGS);
    check("ldg run7 (S1 delete): exit 0", r7.code === 0);
    check("ldg run7: deleted=1", r7.result!.summary.deleted === 1, JSON.stringify(r7.result!.summary));
    check("ldg run7: S2 row gone", (await s2LedgerByKey(`ar-${delId}`)) === null);
  } finally {
    await upsertRawLedger([delSaved]);
  }
  const r8 = await runLoader(T18, T18_FLAGS);
  check("ldg run8 (restore): exit 0", r8.code === 0);
  check("ldg run8: created=1", r8.result!.summary.created === 1, JSON.stringify(r8.result!.summary));

  // final: all-unchanged again
  const r9 = await runLoader(T18, T18_FLAGS);
  check("ldg run9: back to all-unchanged", r9.code === 0 && r9.result!.summary.updated === 0 && r9.result!.summary.created === 0 && r9.result!.summary.deleted === 0, JSON.stringify(r9.result?.summary));
}

// ---------------------------------------------------------------------------
// Phase: cascade (t19 delete → t18 recreate, cross-loader convergence)
// Requires payments+ledger phases to have converged first (full-run order).
// ---------------------------------------------------------------------------
async function phaseCascade(): Promise<void> {
  console.log("== phase: cascade (payment delete → AR recreate without force) ==");
  // Pick a payment with ≥1 referencing s1-import ar-* row whose AR source is
  // still staged-Cleared and ledger-ar-mapped (fast-path eligible — the
  // exact shape that used to leave a permanent hole).
  const pick = rowsOf(await db.execute(sql`
    SELECT m.s1_id AS nid, m.s2_id AS s2_id,
           array_agg(substring(l.charge_plugin_key FROM 4)::bigint) AS ar_ids
      FROM s1_staging.id_map m
      JOIN ledger l ON l.reference_type = 'payment' AND l.reference_id = m.s2_id
       AND l.charge_plugin = 's1-import' AND l.charge_plugin_key ~ '^ar-[0-9]+$'
     WHERE m.entity = 'payment' AND m.stub = false
       AND EXISTS (SELECT 1 FROM s1_staging.raw_ledger_ar s
                    WHERE s.ledger_id = substring(l.charge_plugin_key FROM 4)::bigint
                      AND lower(trim(coalesce(s.ledger_status,''))) = 'cleared')
       AND EXISTS (SELECT 1 FROM s1_staging.id_map ma
                    WHERE ma.entity = 'ledger-ar'
                      AND ma.s1_id = substring(l.charge_plugin_key FROM 4)::bigint)
     GROUP BY m.s1_id, m.s2_id ORDER BY m.s1_id LIMIT 1
  `))[0];
  if (!pick) { check("csc: found a payment with mapped staged-Cleared referencing AR rows", false); return; }
  const nid = Number(pick.nid);
  const oldPayId = String(pick.s2_id);
  const arIds = (pick.ar_ids as unknown[]).map(Number);
  console.log(`  · payment nid=${nid} referenced by ${arIds.length} staged-Cleared mapped AR row(s)`);
  const saved = await readRecord("sirius_payment", nid);
  try {
    await db.execute(sql`DELETE FROM s1_staging.records WHERE bundle = 'sirius_payment' AND nid = ${nid}`);
    const r1 = await runLoader(T19, []);
    check("csc run1 (t19 after S1 payment delete): exit 0", r1.code === 0);
    check("csc run1: deleted=1", r1.result!.summary.deleted === 1, JSON.stringify(r1.result!.summary));
    const sweepDetail = (r1.result!.detail as Record<string, any>).sweep ?? {};
    check("csc run1: cascaded ar mappings dropped", Number(sweepDetail.cascadedArMappingsDropped ?? 0) >= arIds.length, JSON.stringify(sweepDetail));
    const payRowGone = rowsOf(await db.execute(sql`SELECT 1 FROM ledger_payments WHERE id = ${oldPayId}`)).length === 0;
    const payMapGone = (await getMappings("payment", [nid])).size === 0;
    check("csc run1: payment row and mapping gone", payRowGone && payMapGone, `rowGone=${payRowGone} mapGone=${payMapGone}`);
    let cascadedGone = true;
    let mappingsGone = true;
    for (const id of arIds) {
      if (await s2LedgerByKey(`ar-${id}`)) cascadedGone = false;
      if ((await getMappings("ledger-ar", [id])).has(id)) mappingsGone = false;
    }
    check("csc run1: cascaded AR rows gone", cascadedGone);
    check("csc run1: their ledger-ar mappings gone", mappingsGone);

    // THE regression: a standard t18 run (no --force-reconcile) must
    // recreate the still-staged AR rows.
    const r2 = await runLoader(T18, T18_FLAGS);
    check("csc run2 (standard t18): exit 0", r2.code === 0);
    check("csc run2: created >= cascaded rows", r2.result!.summary.created >= arIds.length, JSON.stringify(r2.result!.summary));
    check("csc run2: verify pass", r2.result!.verify.status === "pass");
    let recreated = true;
    let remapped = true;
    for (const id of arIds) {
      if (!(await s2LedgerByKey(`ar-${id}`))) recreated = false;
      if (!(await getMappings("ledger-ar", [id])).has(id)) remapped = false;
    }
    check("csc run2: AR rows recreated WITHOUT force", recreated);
    check("csc run2: ledger-ar mappings restored", remapped);
  } finally {
    await upsertRecords([saved]);
  }
  // restore: t19 recreates the payment under a new id; the recreated AR rows
  // were resolved while the payment was gone (referenceType='s1-unknown').
  // The ORDINARY next t18 run must re-point them: its degraded-reference
  // heal pre-pass sees the nid now resolves, clears those fingerprints, and
  // the standard update path rewrites the reference — no --force-reconcile.
  const r3 = await runLoader(T19, []);
  check("csc run3 (restore payment): exit 0", r3.code === 0);
  check("csc run3: created=1", r3.result!.summary.created === 1, JSON.stringify(r3.result!.summary));
  const newPay = await s2PaymentByNid(nid);
  check("csc run3: payment recreated under new id", newPay != null && newPay.id !== oldPayId, `new=${newPay?.id}`);
  const r4 = await runLoader(T18, T18_FLAGS);
  check("csc run4 (standard t18 after restore): exit 0", r4.code === 0);
  const heal = (r4.result!.detail as Record<string, any>).refHeal ?? {};
  check("csc run4: heal pre-pass cleared fingerprint(s)", Number(heal.cleared ?? 0) >= 1, JSON.stringify(heal));
  check("csc run4: updated >= 1 (re-resolved AR row)", r4.result!.summary.updated >= 1, JSON.stringify(r4.result!.summary));
  check("csc run4: verify pass", r4.result!.verify.status === "pass");
  const ref = rowsOf(await db.execute(sql`
    SELECT reference_type, reference_id FROM ledger
     WHERE charge_plugin = 's1-import' AND charge_plugin_key = ${`ar-${arIds[0]}`}
  `))[0];
  check("csc run4: AR reference re-points at recreated payment",
    ref != null && String(ref.reference_type) === "payment" && String(ref.reference_id) === String(newPay?.id),
    JSON.stringify(ref));
  const r5 = await runLoader(T18, T18_FLAGS);
  check("csc run5: converged all-unchanged", r5.code === 0 && r5.result!.summary.created === 0 && r5.result!.summary.updated === 0 && r5.result!.summary.deleted === 0, JSON.stringify(r5.result?.summary));
}

// ---------------------------------------------------------------------------
// Phase: hours (t20) — stale-key cleanup via the sidecar
// ---------------------------------------------------------------------------
const T20 = "load-hours.ts";
const T20_FLAGS = ["--migration-mode"];

interface PpGroup { key: string; workerNid: number; employerNid: number; year: number; month: number; nids: number[] }

function asScalarRef(v: unknown): number | null {
  if (typeof v === "number") return v;
  if (Array.isArray(v) && v.length > 0 && typeof v[0] === "number") return v[0];
  if (typeof v === "string" && /^\d+$/.test(v)) return Number(v);
  return null;
}

async function payperiodGroups(): Promise<PpGroup[]> {
  const rows = rowsOf(await db.execute(sql`SELECT nid, fields FROM s1_staging.records WHERE bundle = 'sirius_payperiod'`));
  const groups = new Map<string, PpGroup>();
  for (const r of rows) {
    const f = (typeof r.fields === "string" ? JSON.parse(r.fields) : r.fields) as Record<string, unknown>;
    const workerNid = asScalarRef(f["field_sirius_worker"]);
    const employerNid = asScalarRef(f["field_grievance_shop"]);
    const ds = f["field_sirius_date_start"];
    if (workerNid == null || employerNid == null || typeof ds !== "string" || !/^\d{4}-\d{2}/.test(ds)) continue;
    const year = Number(ds.slice(0, 4));
    const month = Number(ds.slice(5, 7));
    const key = `${workerNid}|${employerNid}|${year}|${month}`;
    const g = groups.get(key) ?? { key, workerNid, employerNid, year, month, nids: [] };
    g.nids.push(Number(r.nid));
    groups.set(key, g);
  }
  return [...groups.values()];
}

async function s2HoursRow(workerId: string, employerId: string, year: number, month: number): Promise<{ id: string; hours: number } | null> {
  const r = rowsOf(await db.execute(sql`
    SELECT id, hours FROM worker_hours
     WHERE worker_id = ${workerId} AND employer_id = ${employerId} AND year = ${year} AND month = ${month} AND day = 1
  `))[0];
  return r ? { id: String(r.id), hours: Number(r.hours) } : null;
}

async function hoursKeyExists(workerId: string, employerId: string, year: number, month: number): Promise<boolean> {
  return rowsOf(await db.execute(sql`
    SELECT 1 FROM s1_staging.hours_keys
     WHERE worker_id = ${workerId} AND employer_id = ${employerId} AND year = ${year} AND month = ${month}
  `)).length > 0;
}

async function phaseHours(): Promise<void> {
  console.log("== phase: hours (t20 stale-key cleanup) ==");
  await ensureHoursKeysTable();

  // run1: adoption + baseline. Seeds hours_keys from existing mapped-pair
  // day=1 rows (epoch stamp), then the run restamps everything still staged;
  // stale cleanup should find nothing on an aligned dev.
  const r1 = await runLoader(T20, [...T20_FLAGS, "--adopt-hours-keys"]);
  check("hrs run1 (adopt): exit 0", r1.code === 0);
  check("hrs run1: envelope present", r1.result != null);
  if (!r1.result) return;
  const d1 = r1.result.detail as Record<string, any>;
  check("hrs run1: verify pass", r1.result.verify.status === "pass", JSON.stringify(r1.result.verify));
  check("hrs run1: cleanup ran (not skipped)", d1.staleHoursCleanup?.skipped == null, JSON.stringify(d1.staleHoursCleanup));
  const keyCount = rowsOf(await db.execute(sql`SELECT count(*)::int AS n FROM s1_staging.hours_keys`))[0];
  check("hrs run1: sidecar populated", Number(keyCount.n) > 0 && Number(keyCount.n) === Number(d1.written), `keys=${keyCount.n} written=${d1.written}`);
  // Task 356 bulk write path: evidence + bulk downstream invalidation.
  // Zero migration-generated charges is enforced by assertNoOrdinaryBilling
  // inside runLoader (the runnable bao-hourly fixture is installed for the
  // whole hours phase) — written>0 makes that assertion meaningful.
  check("hrs run1: bulk write path used", d1.bulkWritePath === true, JSON.stringify({ bulkWritePath: d1.bulkWritePath }));
  check("hrs run1: wrote groups with runnable charge fixture active (zero billing asserted per run)", Number(d1.written) > 0, `written=${d1.written}`);
  check(
    "hrs run1: bulk downstream invalidation counters",
    d1.downstream != null &&
      Number(d1.downstream.workersInvalidated) > 0 &&
      Number(d1.downstream.scanQueueRowsReset) >= 0 &&
      Number(d1.downstream.denormMarkedStale) >= 0 &&
      typeof d1.downstream.denormConfigMissing === "boolean",
    JSON.stringify(d1.downstream),
  );
  check(
    "hrs run1: phase-local stats reported (scan vs write vs verify)",
    d1.phaseStats != null &&
      typeof d1.phaseStats.scanSeconds === "number" &&
      typeof d1.phaseStats.writeSeconds === "number" &&
      typeof d1.phaseStats.verifySeconds === "number",
    JSON.stringify(d1.phaseStats),
  );

  // ---- payperiod crosswalk (Task 414): every written month must be backed
  // by nid → worker_hours.id mappings, and every mapping must point at a
  // live worker_hours row (many nids per row for multi-payperiod months). ----
  check(
    "hrs run1: crosswalk counters reported",
    d1.payperiodCrosswalk != null && Number(d1.payperiodCrosswalk.mapped) > 0,
    JSON.stringify(d1.payperiodCrosswalk),
  );
  const xwalk = rowsOf(await db.execute(sql`
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE wh.id IS NULL)::int AS dangling,
           count(DISTINCT m.s2_id)::int AS distinct_rows
      FROM s1_staging.id_map m
      LEFT JOIN worker_hours wh ON wh.id = m.s2_id
     WHERE m.entity = 'payperiod'
  `))[0];
  check("hrs run1: crosswalk populated", Number(xwalk.total) > 0, `total=${xwalk.total}`);
  check("hrs run1: crosswalk has no dangling targets", Number(xwalk.dangling) === 0, `dangling=${xwalk.dangling}`);
  // multi-payperiod month: all contributing nids share ONE hours row
  const multi = (await payperiodGroups()).find((g) => g.nids.length > 1);
  if (multi) {
    const m = await getMappings("payperiod", multi.nids);
    const targets = new Set([...m.values()].map((v) => v.s2Id));
    check(
      "hrs run1: multi-payperiod month maps all nids to one hours row",
      m.size === multi.nids.length && targets.size === 1,
      `nids=${multi.nids.length} mapped=${m.size} targets=${targets.size}`,
    );
  } else {
    console.log("  · no multi-payperiod month in dev staging — multi-nid check skipped");
  }

  // pick a single-payperiod group whose worker+employer resolve
  const groups = await payperiodGroups();
  const singles = groups.filter((g) => g.nids.length === 1);
  let target: (PpGroup & { workerId: string; employerId: string }) | null = null;
  for (const g of singles) {
    const wm = (await getMappings("worker", [g.workerNid])).get(g.workerNid);
    const em = (await getMappings("employer", [g.employerNid])).get(g.employerNid);
    if (!wm || !em) continue;
    if (await s2HoursRow(wm.s2Id, em.s2Id, g.year, g.month)) {
      target = { ...g, workerId: wm.s2Id, employerId: em.s2Id };
      break;
    }
  }
  if (!target) { check("hrs: found a resolvable single-payperiod group", false); return; }
  const ppNid = target.nids[0];
  const saved = await readRecord("sirius_payperiod", ppNid);

  // S1 delete → stale cleanup removes the month row + sidecar key
  try {
    await db.execute(sql`DELETE FROM s1_staging.records WHERE bundle = 'sirius_payperiod' AND nid = ${ppNid}`);
    const r2 = await runLoader(T20, T20_FLAGS);
    check("hrs run2 (payperiod deleted): exit 0", r2.code === 0);
    check("hrs run2: deleted=1", r2.result!.summary.deleted === 1, JSON.stringify(r2.result!.summary));
    check("hrs run2: S2 hours row gone", (await s2HoursRow(target.workerId, target.employerId, target.year, target.month)) === null);
    check("hrs run2: sidecar key gone", !(await hoursKeyExists(target.workerId, target.employerId, target.year, target.month)));
    check("hrs run2: crosswalk mapping retired", !(await getMappings("payperiod", [ppNid])).has(ppNid));
  } finally {
    await upsertRecords([saved]);
  }
  const r3 = await runLoader(T20, T20_FLAGS);
  check("hrs run3 (restore): exit 0", r3.code === 0);
  const restoredRow = await s2HoursRow(target.workerId, target.employerId, target.year, target.month);
  check("hrs run3: S2 hours row back", restoredRow !== null);
  check("hrs run3: sidecar key back", await hoursKeyExists(target.workerId, target.employerId, target.year, target.month));
  const xw3 = (await getMappings("payperiod", [ppNid])).get(ppNid);
  check("hrs run3: crosswalk mapping back and pointing at the restored row", xw3 != null && restoredRow != null && xw3.s2Id === (restoredRow as any).id, JSON.stringify({ xw: xw3?.s2Id }));

  // month retarget (payperiod MOVED): shift date_start to a month with no
  // other payperiod for the same (worker, employer) — old month row must be
  // cleaned, new month row created.
  const taken = new Set(groups.filter((g) => g.workerNid === target!.workerNid && g.employerNid === target!.employerNid).map((g) => `${g.year}|${g.month}`));
  let mv: { year: number; month: number } | null = null;
  for (let k = 1; k <= 24 && !mv; k++) {
    const total = target.year * 12 + (target.month - 1) + k;
    const cand = { year: Math.floor(total / 12), month: (total % 12) + 1 };
    if (!taken.has(`${cand.year}|${cand.month}`)) mv = cand;
  }
  if (!mv) { check("hrs retarget: found a free month", false); return; }
  const ds = String(saved.fields["field_sirius_date_start"]);
  const movedDs = `${mv.year}-${String(mv.month).padStart(2, "0")}${ds.slice(7)}`;
  try {
    await upsertRecords([{ ...saved, fields: { ...saved.fields, field_sirius_date_start: movedDs } }]);
    const r4 = await runLoader(T20, T20_FLAGS);
    check("hrs run4 (month retarget): exit 0", r4.code === 0);
    check("hrs run4: deleted=1 (old month)", r4.result!.summary.deleted === 1, JSON.stringify(r4.result!.summary));
    check("hrs run4: old month row gone", (await s2HoursRow(target.workerId, target.employerId, target.year, target.month)) === null);
    const movedRow = await s2HoursRow(target.workerId, target.employerId, mv.year, mv.month);
    check("hrs run4: new month row exists", movedRow !== null);
    const xw4 = (await getMappings("payperiod", [ppNid])).get(ppNid);
    check("hrs run4: crosswalk repointed to the moved month row", xw4 != null && movedRow != null && xw4.s2Id === movedRow.id, JSON.stringify({ xw: xw4?.s2Id, moved: movedRow?.id }));
  } finally {
    await upsertRecords([saved]);
  }
  const r5 = await runLoader(T20, T20_FLAGS);
  check("hrs run5 (restore): exit 0", r5.code === 0);
  check("hrs run5: old month row back", (await s2HoursRow(target.workerId, target.employerId, target.year, target.month)) !== null);
  check("hrs run5: moved month row cleaned", (await s2HoursRow(target.workerId, target.employerId, mv.year, mv.month)) === null);

  // ---- bulk conflict semantics: row identity + staff-owned fields survive,
  // migration-owned hours reasserted (task 356) ----
  console.log("== phase: hours (bulk conflict preservation) ==");
  const rowBefore = rowsOf(await db.execute(sql`
    SELECT id, hours, home, job_title FROM worker_hours
     WHERE worker_id = ${target.workerId} AND employer_id = ${target.employerId}
       AND year = ${target.year} AND month = ${target.month} AND day = 1
  `))[0];
  check("hrs preserve: baseline row present", rowBefore != null);
  if (!rowBefore) return;
  const rowId = String(rowBefore.id);
  const trueHours = Number(rowBefore.hours);
  const prevHome = Boolean(rowBefore.home);
  const prevTitle = rowBefore.job_title == null ? null : String(rowBefore.job_title);
  try {
    // flip staff-owned fields + corrupt the migration-owned aggregate
    await db.execute(sql`
      UPDATE worker_hours SET home = ${!prevHome}, job_title = '__t356-preserve', hours = ${trueHours + 7.25}
       WHERE id = ${rowId}
    `);
    const r6 = await runLoader(T20, T20_FLAGS);
    check("hrs run6 (conflict update): exit 0", r6.code === 0);
    check("hrs run6: verify pass", r6.result?.verify.status === "pass", JSON.stringify(r6.result?.verify));
    const rowAfter = rowsOf(await db.execute(sql`
      SELECT id, hours, home, job_title FROM worker_hours
       WHERE worker_id = ${target.workerId} AND employer_id = ${target.employerId}
         AND year = ${target.year} AND month = ${target.month} AND day = 1
    `))[0];
    check("hrs run6: row identity preserved (same id)", rowAfter != null && String(rowAfter.id) === rowId);
    check("hrs run6: migration-owned hours reasserted", rowAfter != null && Math.abs(Number(rowAfter.hours) - trueHours) < 1e-9, `hours=${rowAfter?.hours} want=${trueHours}`);
    check("hrs run6: staff-owned home preserved", rowAfter != null && Boolean(rowAfter.home) === !prevHome, `home=${rowAfter?.home} want=${!prevHome}`);
    check("hrs run6: staff-owned job_title preserved", rowAfter != null && String(rowAfter.job_title) === "__t356-preserve", `jobTitle=${rowAfter?.job_title}`);
  } finally {
    await db.execute(sql`UPDATE worker_hours SET home = ${prevHome}, job_title = ${prevTitle} WHERE id = ${rowId}`);
  }

  // ---- interruption recovery: a crash right after a completed flush leaves
  // stale cleanup unreachable; a plain re-run (same command, no reset)
  // resumes, converges, and only then cleans up (task 356) ----
  console.log("== phase: hours (interruption recovery) ==");
  try {
    await db.execute(sql`DELETE FROM s1_staging.records WHERE bundle = 'sirius_payperiod' AND nid = ${ppNid}`);
    const rc = await runLoader(T20, T20_FLAGS, { S1_T20_FLUSH_AT: "5", S1_T20_CRASH_AFTER_FLUSH: "1" });
    check("hrs crash: injected crash exits non-zero", rc.code !== 0, `code=${rc.code}`);
    check("hrs crash: stale S2 row survives interruption (cleanup unreachable)",
      (await s2HoursRow(target.workerId, target.employerId, target.year, target.month)) !== null);
    check("hrs crash: sidecar key survives interruption",
      await hoursKeyExists(target.workerId, target.employerId, target.year, target.month));
    const rr = await runLoader(T20, T20_FLAGS);
    check("hrs resume: exit 0 (no reset needed)", rr.code === 0);
    check("hrs resume: deleted=1 (cleanup ran only after the full verified run)", rr.result!.summary.deleted === 1, JSON.stringify(rr.result!.summary));
    check("hrs resume: stale S2 row gone", (await s2HoursRow(target.workerId, target.employerId, target.year, target.month)) === null);
    check("hrs resume: sidecar key gone", !(await hoursKeyExists(target.workerId, target.employerId, target.year, target.month)));
  } finally {
    await upsertRecords([saved]);
  }
  const rHeal = await runLoader(T20, T20_FLAGS);
  check("hrs heal after interruption phase: exit 0", rHeal.code === 0);
  check("hrs heal: S2 row back", (await s2HoursRow(target.workerId, target.employerId, target.year, target.month)) !== null);

  // ---- verify-failure gate: a BEFORE trigger perturbs ONE key's stored
  // hours so persisted != expected — run must fail verify, skip cleanup,
  // delete nothing (task 356) ----
  console.log("== phase: hours (verify-failure gate) ==");
  try {
    // UUID/int literals from our own DB — utility statements cannot take
    // bind params, so the trigger body is built with sql.raw.
    await db.execute(sql.raw(`
      CREATE OR REPLACE FUNCTION __t356_perturb_hours() RETURNS trigger AS $t356$
      BEGIN
        IF NEW.worker_id = '${target.workerId}' AND NEW.employer_id = '${target.employerId}'
           AND NEW.year = ${target.year} AND NEW.month = ${target.month} AND NEW.day = 1 THEN
          NEW.hours := COALESCE(NEW.hours, 0) + 1234.5;
        END IF;
        RETURN NEW;
      END $t356$ LANGUAGE plpgsql
    `));
    await db.execute(sql.raw(`
      CREATE TRIGGER __t356_perturb_hours_trg BEFORE INSERT OR UPDATE ON worker_hours
      FOR EACH ROW EXECUTE FUNCTION __t356_perturb_hours()
    `));
    const rv = await runLoader(T20, T20_FLAGS);
    const dv = rv.result?.detail as Record<string, any> | undefined;
    check("hrs verify-fail: exit non-zero", rv.code !== 0, `code=${rv.code}`);
    check("hrs verify-fail: verify status fail", rv.result?.verify.status === "fail", JSON.stringify(rv.result?.verify));
    check("hrs verify-fail: exactly one mismatch", dv?.verifyMismatchCount === 1, `n=${dv?.verifyMismatchCount}`);
    check("hrs verify-fail: cleanup skipped (verify_failed)", dv?.staleHoursCleanup?.skipped === "verify_failed", JSON.stringify(dv?.staleHoursCleanup));
    check("hrs verify-fail: no rows deleted", rv.result?.summary.deleted === 0, JSON.stringify(rv.result?.summary));
  } finally {
    await db.execute(sql.raw(`DROP TRIGGER IF EXISTS __t356_perturb_hours_trg ON worker_hours`));
    await db.execute(sql.raw(`DROP FUNCTION IF EXISTS __t356_perturb_hours()`));
  }
  const rFix = await runLoader(T20, T20_FLAGS);
  check("hrs verify-fail heal: exit 0", rFix.code === 0);
  const healed = await s2HoursRow(target.workerId, target.employerId, target.year, target.month);
  check("hrs verify-fail heal: perturbed hours reasserted", healed != null && Math.abs(healed.hours - trueHours) < 1e-9, JSON.stringify(healed));
}

// ---------------------------------------------------------------------------
// Phase: repair (one-time repair-hour-links.ts — Task 414). Degrades one
// linked s1-import row back to 's1-unknown', then proves: dry run reports the
// candidate without writing, wet run relinks it, and a second wet run is a
// no-op (alreadyLinked). Duplicate-charge reconciliation math is covered by
// the vitest suite (tests/sitespecific/bao-hourly-imported-base.test.ts);
// here we only assert the command runs clean and moves no money.
// ---------------------------------------------------------------------------
async function phaseRepair(): Promise<void> {
  console.log("== phase: repair (repair-hour-links one-time command) ==");
  const runRepair = (wet: boolean) => {
    const proc = spawnSync(
      "npx",
      ["tsx", "scripts/s1-migration/repair-hour-links.ts", ...(wet ? ["--wet"] : [])],
      { encoding: "utf8", timeout: 600_000 },
    );
    const m = (proc.stdout ?? "").match(/^REPORT (\{.*\})$/m);
    return { code: proc.status, report: m ? JSON.parse(m[1]) : null, out: proc.stdout ?? "" };
  };

  const candidate = rowsOf(await db.execute(sql`
    SELECT l.id, l.reference_id
      FROM ledger l
      JOIN s1_staging.id_map m ON m.entity = 'payperiod' AND m.s1_id = (l.data->>'s1ReferenceNid')::bigint
     WHERE l.charge_plugin = 's1-import' AND l.reference_type = 'hour'
     ORDER BY l.charge_plugin_key LIMIT 1
  `))[0];
  if (!candidate) {
    console.log("  · no linked s1-import hour rows in dev — running dry-run smoke only");
    const dry = runRepair(false);
    check("rpr dry (no candidates): exit 0", dry.code === 0, dry.out.slice(-500));
    check("rpr dry: report emitted", dry.report != null);
    await removePayperiodArFake();
    return;
  }

  const before = await moneySnapshot();
  // degrade: simulate a row imported before the crosswalk existed
  await db.execute(sql`UPDATE ledger SET reference_type = 's1-unknown', reference_id = data->>'s1ReferenceNid' WHERE id = ${candidate.id}`);
  try {
    const dry = runRepair(false);
    check("rpr dry: exit 0", dry.code === 0, dry.out.slice(-500));
    check("rpr dry: reports the degraded candidate as linkable", dry.report?.link?.linked === 1, JSON.stringify(dry.report?.link));
    const stillDegraded = rowsOf(await db.execute(sql`SELECT reference_type FROM ledger WHERE id = ${candidate.id}`))[0];
    check("rpr dry: wrote nothing", stillDegraded.reference_type === "s1-unknown");

    const wet = runRepair(true);
    check("rpr wet: exit 0", wet.code === 0, wet.out.slice(-500));
    check("rpr wet: linked=1", wet.report?.link?.linked === 1, JSON.stringify(wet.report?.link));
    const relinked = rowsOf(await db.execute(sql`SELECT reference_type, reference_id FROM ledger WHERE id = ${candidate.id}`))[0];
    check(
      "rpr wet: row relinked to the SAME hours row",
      relinked.reference_type === "hour" && relinked.reference_id === candidate.reference_id,
      JSON.stringify(relinked),
    );

    const rerun = runRepair(true);
    check("rpr rerun: exit 0", rerun.code === 0, rerun.out.slice(-500));
    check("rpr rerun: idempotent (linked=0, candidate now alreadyLinked)", rerun.report?.link?.linked === 0 && rerun.report?.link?.alreadyLinked >= 1, JSON.stringify(rerun.report?.link));
    check("rpr rerun: no money moved", rerun.report?.duplicates?.adjustmentsCreated === 0, JSON.stringify(rerun.report?.duplicates));

    const after = await moneySnapshot();
    check(
      "rpr: imported totals untouched",
      after.importedLedger.count === before.importedLedger.count && after.importedLedger.cents === before.importedLedger.cents,
      JSON.stringify({ before: before.importedLedger, after: after.importedLedger }),
    );
  } finally {
    // belt-and-braces: the wet run should already have restored the link
    await db.execute(sql`UPDATE ledger SET reference_type = 'hour', reference_id = ${candidate.reference_id} WHERE id = ${candidate.id}`);
    await removePayperiodArFake();
  }
}

// ---------------------------------------------------------------------------
// Request-context suppression cleanup: success, rejection and nested scopes
// must restore the exact surrounding flags.
// ---------------------------------------------------------------------------
async function phaseSuppressionContext(): Promise<void> {
  console.log("== phase: suppression context cleanup ==");
  check("ctx: flags are off with no ambient context", !areChargePluginsSuppressed() && !areNotificationsSuppressed());
  await requestContext.run(
    { userId: "money-sync-smoke", suppressChargePlugins: false, suppressNotifications: false },
    async () => {
      check("ctx: baseline flags are off", !areChargePluginsSuppressed() && !areNotificationsSuppressed());

      await withChargePluginsSuppressed(async () => {
        check("ctx success: charge suppression is on inside", areChargePluginsSuppressed());
      });
      check("ctx success: flags restored", !areChargePluginsSuppressed() && !areNotificationsSuppressed());

      let rejected = false;
      try {
        await withChargePluginsSuppressed(async () => {
          check("ctx rejection: charge suppression is on inside", areChargePluginsSuppressed());
          throw new Error("expected suppression cleanup probe");
        });
      } catch {
        rejected = true;
      }
      check("ctx rejection: callback rejected", rejected);
      check("ctx rejection: flags restored", !areChargePluginsSuppressed() && !areNotificationsSuppressed());

      let notificationRejected = false;
      try {
        await withNotificationsSuppressed(async () => {
          check("ctx notification rejection: notification suppression is on inside",
            areNotificationsSuppressed() && !areChargePluginsSuppressed());
          throw new Error("expected notification suppression cleanup probe");
        });
      } catch {
        notificationRejected = true;
      }
      check("ctx notification rejection: callback rejected", notificationRejected);
      check("ctx notification rejection: flags restored",
        !areChargePluginsSuppressed() && !areNotificationsSuppressed());

      await withChargePluginsSuppressed(async () => {
        check("ctx nested: outer charge flag on, notification flag off", areChargePluginsSuppressed() && !areNotificationsSuppressed());
        await withNotificationsSuppressed(async () => {
          check("ctx nested: both flags on in inner scope", areChargePluginsSuppressed() && areNotificationsSuppressed());
        });
        check("ctx nested: inner scope restored outer flags", areChargePluginsSuppressed() && !areNotificationsSuppressed());
      });
      check("ctx nested: surrounding flags restored", !areChargePluginsSuppressed() && !areNotificationsSuppressed());

      await withNotificationsSuppressed(async () => {
        check("ctx inverse nested: outer notification flag on, charge flag off",
          areNotificationsSuppressed() && !areChargePluginsSuppressed());
        await withChargePluginsSuppressed(async () => {
          check("ctx inverse nested: both flags on in inner scope",
            areNotificationsSuppressed() && areChargePluginsSuppressed());
        });
        check("ctx inverse nested: inner scope restored outer flags",
          areNotificationsSuppressed() && !areChargePluginsSuppressed());
      });
      check("ctx inverse nested: surrounding flags restored",
        !areChargePluginsSuppressed() && !areNotificationsSuppressed());
    },
  );
  check("ctx: ambient context did not leak", !areChargePluginsSuppressed() && !areNotificationsSuppressed());
}

function mapEqual<T>(
  a: Map<string, T>,
  b: Map<string, T>,
  equal: (left: T, right: T) => boolean,
): boolean {
  if (a.size !== b.size) return false;
  for (const [key, value] of a) {
    const other = b.get(key);
    if (other == null || !equal(value, other)) return false;
  }
  return true;
}

function moneyStateEqual(a: MoneySnapshot, b: MoneySnapshot): boolean {
  return (
    a.importedLedger.count === b.importedLedger.count &&
    a.importedLedger.cents === b.importedLedger.cents &&
    a.payments.count === b.payments.count &&
    a.payments.cents === b.payments.cents &&
    a.hours.count === b.hours.count &&
    Math.abs(a.hours.hours - b.hours.hours) < 1e-9 &&
    mapEqual(a.ordinaryLedger, b.ordinaryLedger,
      (x, y) => x.count === y.count && x.cents === y.cents && x.ids === y.ids) &&
    mapEqual(a.ledgerEa, b.ledgerEa, (x, y) => x.count === y.count && x.ids === y.ids)
  );
}

async function runSteadyMoneySequence(label: string): Promise<void> {
  const before = await moneySnapshot();
  const pay = await runLoader(T19, []);
  check(`${label}: payments wet run is a no-op`, pay.code === 0 && pay.result != null &&
    pay.result.summary.created === 0 && pay.result.summary.updated === 0 && pay.result.summary.deleted === 0,
  JSON.stringify(pay.result?.summary));
  const ledger = await runLoader(T18, T18_FLAGS);
  check(`${label}: ledger wet run is a no-op`, ledger.code === 0 && ledger.result != null &&
    ledger.result.summary.created === 0 && ledger.result.summary.updated === 0 && ledger.result.summary.deleted === 0,
  JSON.stringify(ledger.result?.summary));
  const hours = await runLoader(T20, T20_FLAGS);
  check(`${label}: hours wet run verifies`, hours.code === 0 && hours.result?.verify.status === "pass",
    JSON.stringify(hours.result?.verify));
  const after = await moneySnapshot();
  check(`${label}: zero money and charge-state delta`, moneyStateEqual(before, after),
    `imported=${before.importedLedger.count}/${before.importedLedger.cents}→${after.importedLedger.count}/${after.importedLedger.cents}; ` +
    `payments=${before.payments.count}/${before.payments.cents}→${after.payments.count}/${after.payments.cents}; ` +
    `hours=${before.hours.count}/${before.hours.hours}→${after.hours.count}/${after.hours.hours}`);
}

async function phaseNoopWetRerun(): Promise<void> {
  console.log("== phase: two no-op wet money runs ==");
  await runSteadyMoneySequence("wet run 1");
  await phaseParity("wet run 1 parity");
  await runSteadyMoneySequence("wet run 2");
  await phaseParity("wet run 2 parity");
}

// ---------------------------------------------------------------------------
// Phase: parity — verify-balance-parity must report 0 drift after the
// reconcile phases converged everything.
// ---------------------------------------------------------------------------
async function phaseParity(label = "parity"): Promise<void> {
  console.log(`== phase: ${label} ==`);
  const t0 = Date.now();
  const proc = spawnSync("npx", ["tsx", "scripts/s1-migration/verify-balance-parity.ts"], {
    cwd: process.cwd(),
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  console.log(`  · verify-balance-parity.ts → exit ${proc.status} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  check(`${label}: 0 drift (exit 0)`, proc.status === 0);
  if (proc.status !== 0) {
    console.log(`  · stdout tail:\n${(proc.stdout ?? "").slice(-3000)}`);
    console.log(`  · stderr tail:\n${(proc.stderr ?? "").slice(-1000)}`);
  }
}

// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  await ensureStagingSchema();
  await ensureRawLedgerTable();
  await ensureIdMap();
  await phaseSuppressionContext();
  const needsFixture = PHASE !== "parity";
  const fixture = needsFixture ? await installBillingFixture() : null;
  try {
    // Production money order (Task 414): payments → hours → ledger.
    if (PHASE === "all" || PHASE === "payments") await phasePayments();
    if (PHASE === "all" || PHASE === "hours") await phaseHours();
    if (PHASE === "all" || PHASE === "ledger") await phaseLedger();
    if (PHASE === "all" || PHASE === "cascade") await phaseCascade();
    if (PHASE === "all" || PHASE === "repair") await phaseRepair();
    if (PHASE === "all" || PHASE === "rerun") await phaseNoopWetRerun();
    if (PHASE === "all" || PHASE === "parity") await phaseParity();
  } finally {
    if (fixture) {
      await removeBillingFixture(fixture);
      console.log("  · removed runnable charge fixture");
    }
  }
  console.log(failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("SMOKE CRASH:", e);
  process.exit(1);
});
