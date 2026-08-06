/**
 * Integration test: BAO FMLA split vs the REAL ledger (dev DB).
 *
 * Seeds a throwaway industry / member status (threshold 80) / employer /
 * worker / ledger account / enabled bao-hourly charge config / $2.50 rate,
 * then runs the wizard's processWorkerHours through the real storage +
 * charge-plugin path and asserts the actual ledger total matches the Preview
 * step's billed amount for each transition:
 *
 *   1. Active 100h            → ledger 250.00
 *   2. FMLA 32h (split 32/48) → ledger 200.00 (retained day-1 row changes
 *      status+hours: net-total reconcile must replace the old charge)
 *   3. FMLA 40h (split 40/40) → ledger 200.00 via adjustments
 *   4. Active 100h again      → day-15 deleted + charges reversed → 250.00
 *
 * All seeded rows are deleted in a finally block.
 *
 * Run: npx tsx scripts/oneoffs/bao-fmla-ledger-integration.ts
 */
import { storage } from "../../server/storage/index";
import { pool } from "../../server/db";
import { loadComponentCache, isComponentEnabledSync } from "../../server/services/component-cache";
import { baoMonthlyHours } from "../../server/plugins/wizards/engine/types/bao_monthly_hours";
// Ensure charge plugins are registered (side-effect import).
import "../../server/plugins/ledger/charge";

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) console.log(`  ok  ${name}`);
  else {
    failures++;
    console.error(`FAIL  ${name}`, detail === undefined ? "" : JSON.stringify(detail));
  }
}

const YEAR = 2026;
const MONTH = 7;

async function ledgerTotal(configId: string): Promise<string> {
  const r = await pool.query(
    `select coalesce(sum(amount::numeric),0)::numeric(12,2) as total from ledger where charge_plugin_config_id = $1`,
    [configId],
  );
  return String(r.rows[0].total);
}

async function main() {
  await loadComponentCache();
  if (!isComponentEnabledSync("sitespecific.bao")) {
    console.error("sitespecific.bao component is not enabled in this DB; cannot run integration test");
    process.exit(1);
  }

  // ---------- Seed ----------
  const ids: Record<string, string> = {};
  const q = async (sql: string, params: any[]) => (await pool.query(sql, params)).rows[0];

  const industry = await q(`insert into options_industries (name) values ('FMLA-IT industry (delete me)') returning id`, []);
  ids.industry = industry.id;
  const ms = await q(
    `insert into options_worker_ms (name, industry_id, data) values ('FMLA-IT 80 (delete me)', $1, $2) returning id`,
    [ids.industry, JSON.stringify({ sitespecific: { bao: { threshold: 80 } } })],
  );
  ids.ms = ms.id;
  const employer = await q(`insert into employers (name, industry_id) values ('FMLA-IT employer (delete me)', $1) returning id`, [ids.industry]);
  ids.employer = employer.id;
  const worker = await storage.workers.createWorker("Fmla IntegrationTest");
  ids.worker = worker.id;
  await q(`insert into worker_msh (date, worker_id, ms_id, industry_id) values ('2026-01-01', $1, $2, $3) returning id`, [ids.worker, ids.ms, ids.industry]).then((r) => (ids.msh = r.id));
  const account = await q(`insert into ledger_accounts (name) values ('FMLA-IT account (delete me)') returning id`, []);
  ids.account = account.id;
  const cfg = await q(
    `insert into plugin_configs (plugin_kind, plugin_id, enabled, name, data) values ('charge', 'bao-hourly', true, 'FMLA-IT config (delete me)', '{}') returning id`,
    [],
  );
  ids.config = cfg.id;
  await pool.query(`insert into plugin_configs_charge (id, scope, employer_id, account) values ($1, 'employer', $2, $3)`, [ids.config, ids.employer, ids.account]);
  await q(`insert into sitespecific_bao_employer_rates (employer_id, account_id, rate, effective_ymd) values ($1, $2, '2.50', '2026-01-01') returning id`, [ids.employer, ids.account]).then((r) => (ids.rate = r.id));

  // Preview support: stub ONLY the file-loading + SSN lookup; billing,
  // thresholds, rates, and status resolution all hit the real DB.
  const originals: Array<[any, string, any]> = [];
  function stub(obj: any, key: string, fn: any) {
    originals.push([obj, key, obj[key]]);
    obj[key] = fn;
  }
  const wizard = { id: "fmla-it-wizard", entityId: ids.employer, data: { launchArguments: { year: YEAR, month: MONTH }, columnMapping: { c0: "ssn", c1: "employmentStatus", c2: "numberOfHours" } } };
  let previewRows: Array<Record<string, any>> = [];
  stub(baoMonthlyHours, "loadMappedRows", async () => ({ wizard, wizardData: wizard.data, file: {}, rawRows: [], hasHeaders: true, mode: "create", mappedRows: previewRows }));
  stub(storage.workers, "getWorkerBySSN", async () => ({ id: ids.worker }));
  stub(baoMonthlyHours as any, "syncWorkStatusFromEmployment", async () => {});

  const scenario = async (label: string, status: string, hours: string, expectTotal: string, expectSplit: boolean) => {
    previewRows = [{ ssn: "900-88-7777", firstName: "Fmla", lastName: "IT", employmentStatus: status, numberOfHours: hours }];
    const preview = await baoMonthlyHours.computePreview("fmla-it-wizard");
    await (baoMonthlyHours as any).processWorkerHours(ids.worker, previewRows[0], wizard);
    const total = await ledgerTotal(ids.config);
    check(`${label}: ledger total ${expectTotal}`, total === expectTotal, total);
    check(`${label}: preview billed equals ledger`, preview.totals.billedAmount === total, { preview: preview.totals.billedAmount, ledger: total });
    check(`${label}: preview split=${expectSplit}`, preview.workers[0].fmlaSplit === expectSplit, preview.workers[0]);
    const rows = (await storage.workerHours.getWorkerHours(ids.worker)).filter((r: any) => r.employerId === ids.employer && r.year === YEAR && r.month === MONTH);
    check(`${label}: row count ${expectSplit ? 2 : 1}`, rows.length === (expectSplit ? 2 : 1), rows.map((r: any) => ({ day: r.day, hours: r.hours })));
  };

  try {
    // 1. Plain Active month.
    await scenario("Active 100h", "Active", "100", "250.00", false);
    // 2. Re-upload as FMLA 32h → split 32 Active + 48 FMLA = 80h × 2.50.
    await scenario("FMLA 32h split", "FMLA", "32", "200.00", true);
    // 3. Changed FMLA hours 40h → split 40/40, same 80h total.
    await scenario("FMLA 40h split", "FMLA", "40", "200.00", true);
    // 4. Back to Active 100h → day-15 removed, charges reversed.
    await scenario("Back to Active 100h", "Active", "100", "250.00", false);
  } finally {
    for (const [obj, key, fn] of originals.reverse()) obj[key] = fn;
    // ---------- Cleanup (children first) ----------
    await pool.query(`delete from ledger where charge_plugin_config_id = $1`, [ids.config]);
    await pool.query(`delete from ledger_ea where account_id = $1`, [ids.account]);
    await pool.query(`delete from worker_hours where worker_id = $1`, [ids.worker]);
    await pool.query(`delete from worker_msh where worker_id = $1`, [ids.worker]);
    await pool.query(`delete from worker_wsh where worker_id = $1`, [ids.worker]).catch(() => {});
    await pool.query(`delete from worker_employment_denorm where worker_id = $1`, [ids.worker]).catch(() => {});
    await pool.query(`delete from worker_msh_denorm where worker_id = $1`, [ids.worker]).catch(() => {});
    await pool.query(`delete from workers where id = $1`, [ids.worker]);
    await pool.query(`delete from contacts where id = $1`, [(await storage.workers.getWorker?.(ids.worker) as any)?.contactId ?? "-"]).catch(() => {});
    await pool.query(`delete from sitespecific_bao_employer_rates where id = $1`, [ids.rate]);
    await pool.query(`delete from plugin_configs_charge where id = $1`, [ids.config]);
    await pool.query(`delete from plugin_configs where id = $1`, [ids.config]);
    await pool.query(`delete from ledger_accounts where id = $1`, [ids.account]);
    await pool.query(`delete from employers where id = $1`, [ids.employer]);
    await pool.query(`delete from options_worker_ms where id = $1`, [ids.ms]);
    await pool.query(`delete from options_industries where id = $1`, [ids.industry]);
  }

  console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Integration test crashed:", err);
  process.exit(1);
});
