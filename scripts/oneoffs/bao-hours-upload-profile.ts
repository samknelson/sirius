/**
 * Profiling harness for Task: Speed up BAO Hours Upload processing.
 *
 * Seeds a self-contained synthetic environment (industry, member status with
 * an FMLA threshold, employer, ledger account, enabled bao-hourly charge
 * config, employer rate, N workers) plus a real uploaded CSV file, then runs
 * the wizard pipeline end-to-end — validate → verify scan → preview →
 * process — timing each phase and snapshotting the resulting rows so a
 * before/after code change can be diffed for parity.
 *
 * Usage:
 *   npx tsx scripts/oneoffs/bao-hours-upload-profile.ts --label baseline
 *   npx tsx scripts/oneoffs/bao-hours-upload-profile.ts --label optimized
 *   ... [--rows 500] [--keep]  (default 500 rows; --keep skips cleanup)
 *
 * Snapshot + timings written to /tmp/bao-profile-<label>.json (id-free,
 * keyed by SSN, so two runs against fresh seeds are directly diffable).
 */
// storage barrel FIRST (barrel init cycle).
import { storage } from "../../server/storage/index";
import { pool } from "../../server/db";
import { loadComponentCache, isComponentEnabledSync } from "../../server/services/component-cache";
import { baoMonthlyHours } from "../../server/plugins/wizards/engine/types/bao_monthly_hours";
// Ensure charge plugins are registered (side-effect import).
import "../../server/plugins/ledger/charge";
import { baoMonthlyHoursPlugin } from "../../server/plugins/wizards/plugins/bao-monthly-hours";
import { initFileSystems, fileSystemService } from "../../server/services/files";
import { stringify as stringifyCSV } from "csv-stringify/sync";
import * as fs from "fs";

const argv = process.argv.slice(2);
function argValue(name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
}
const LABEL = argValue("label") || "run";
const ROWS = parseInt(argValue("rows") || "500", 10);
const KEEP = argv.includes("--keep");

const YEAR = 2026;
const MONTH = 6;
const TAG = "__HOURSPROF";
const FS_ID = "hoursprof_local";
const FS_BASE = "/tmp/bao-hours-profile-fs";

const timings: Record<string, number> = {};
async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const t0 = Date.now();
  try {
    return await fn();
  } finally {
    timings[label] = Date.now() - t0;
    console.log(`  [${label}] ${Date.now() - t0} ms`);
  }
}

function ssnFor(i: number): string {
  // Valid SSA-format SSNs: area 700, group 12, serial 0001..NNNN.
  return `700-12-${String(i + 1).padStart(4, "0")}`;
}

interface RowSpec {
  ssn: string;
  first: string;
  last: string;
  dob: string;
  status: string;
  hours: string;
  withholding: string;
}

function buildRows(n: number): RowSpec[] {
  const rows: RowSpec[] = [];
  for (let i = 0; i < n; i++) {
    const fmla = i % 10 === 3; // every 10th row is FMLA
    rows.push({
      ssn: ssnFor(i),
      first: `Prof${i + 1}`,
      last: `${TAG}Worker`,
      dob: `19${70 + (i % 25)}-0${(i % 9) + 1}-1${i % 9}`,
      status: fmla ? "FMLA" : "Active",
      hours: fmla ? "32" : String(120 + (i % 60)),
      withholding: i % 5 === 0 ? `$${(20 + (i % 10)).toFixed(2)}` : "",
    });
  }
  return rows;
}

async function q(sql: string, params: any[] = []): Promise<any> {
  return (await pool.query(sql, params)).rows[0];
}

async function cleanup(ids: Partial<Record<string, string>>) {
  // Workers created by seed OR by processing carry the 700-12 SSN prefix.
  const workerRows = (
    await pool.query(
      `select id, contact_id from workers where regexp_replace(coalesce(ssn,''),'[^0-9]','','g') like '70012%'`,
    )
  ).rows;
  const workerIds = workerRows.map((r: any) => r.id);
  const contactIds = workerRows.map((r: any) => r.contact_id).filter(Boolean);
  if (ids.config) {
    await pool.query(`delete from ledger where charge_plugin_config_id = $1`, [ids.config]);
  }
  if (ids.wizard) {
    await pool.query(`delete from sitespecific_bao_withholding_allocations where wizard_id = $1`, [ids.wizard]).catch(() => {});
  }
  if (workerIds.length > 0) {
    await pool.query(`delete from worker_hours where worker_id = any($1)`, [workerIds]);
    await pool.query(`delete from worker_wsh where worker_id = any($1)`, [workerIds]).catch(() => {});
    await pool.query(`delete from worker_msh where worker_id = any($1)`, [workerIds]);
    await pool.query(`delete from worker_employment_denorm where worker_id = any($1)`, [workerIds]).catch(() => {});
    await pool.query(`delete from worker_msh_denorm where worker_id = any($1)`, [workerIds]).catch(() => {});
    await pool.query(`delete from worker_ids where worker_id = any($1)`, [workerIds]).catch(() => {});
    if (ids.account) {
      await pool.query(`delete from ledger_ea where account_id = $1`, [ids.account]);
    }
    await pool.query(`delete from workers where id = any($1)`, [workerIds]);
    if (contactIds.length > 0) {
      await pool.query(`delete from contact_phone_numbers where contact_id = any($1)`, [contactIds]).catch(() => {});
      await pool.query(`delete from contact_postal where contact_id = any($1)`, [contactIds]).catch(() => {});
      await pool.query(`delete from contacts where id = any($1)`, [contactIds]).catch(() => {});
    }
  }
  await pool.query(`delete from files where file_system_id = $1`, [FS_ID]);
  if (ids.wizard) {
    await pool.query(`delete from wizards where id = $1`, [ids.wizard]);
  }
  if (ids.rate) await pool.query(`delete from sitespecific_bao_employer_rates where id = $1`, [ids.rate]);
  if (ids.config) {
    await pool.query(`delete from plugin_configs_charge where id = $1`, [ids.config]);
    await pool.query(`delete from plugin_configs where id = $1`, [ids.config]);
  }
  if (ids.account) await pool.query(`delete from ledger_accounts where id = $1`, [ids.account]);
  if (ids.employer) await pool.query(`delete from employers where id = $1`, [ids.employer]);
  if (ids.ms) await pool.query(`delete from options_worker_ms where id = $1`, [ids.ms]);
  if (ids.industry) await pool.query(`delete from options_industries where id = $1`, [ids.industry]);
  fs.rmSync(FS_BASE, { recursive: true, force: true });
}

async function main() {
  await loadComponentCache();
  if (!isComponentEnabledSync("sitespecific.bao")) {
    console.error("sitespecific.bao component is not enabled in this DB; cannot profile");
    process.exit(1);
  }

  // Local filesystem so the pipeline exercises real download+parse.
  process.env.FILESYSTEMS = JSON.stringify({
    [FS_ID]: {
      name: "Hours profile scratch",
      access: "private",
      provider: "local",
      provider_settings: { base_path: FS_BASE },
    },
  });
  fs.mkdirSync(FS_BASE, { recursive: true });
  initFileSystems([]);

  // Stale leftovers from a crashed run.
  const staleEmp = await q(`select id from employers where name like $1 limit 1`, [`${TAG}%`]);
  if (staleEmp) {
    console.log("Cleaning stale leftovers from a prior run...");
    const staleIds: Record<string, string> = { employer: staleEmp.id };
    const staleCfg = await q(
      `select pc.id, s.account from plugin_configs pc join plugin_configs_charge s on s.id = pc.id where pc.plugin_id='bao-hourly' and s.employer_id=$1`,
      [staleEmp.id],
    );
    if (staleCfg) {
      staleIds.config = staleCfg.id;
      staleIds.account = staleCfg.account;
    }
    const staleWiz = await q(`select w.id from wizards w join wizard_employer_monthly m on m.wizard_id=w.id where m.employer_id=$1`, [staleEmp.id]);
    if (staleWiz) staleIds.wizard = staleWiz.id;
    const staleRate = await q(`select id from sitespecific_bao_employer_rates where employer_id=$1`, [staleEmp.id]);
    if (staleRate) staleIds.rate = staleRate.id;
    const staleMs = await q(`select id from options_worker_ms where name like $1`, [`${TAG}%`]);
    if (staleMs) staleIds.ms = staleMs.id;
    const staleInd = await q(`select id from options_industries where name like $1`, [`${TAG}%`]);
    if (staleInd) staleIds.industry = staleInd.id;
    await cleanup(staleIds);
  }

  const ids: Record<string, string> = {};
  console.log(`Seeding ${ROWS}-row synthetic environment...`);
  ids.industry = (await q(`insert into options_industries (name) values ($1) returning id`, [`${TAG} industry`])).id;
  ids.ms = (
    await q(`insert into options_worker_ms (name, industry_id, data) values ($1,$2,$3) returning id`, [
      `${TAG} ms 80`,
      ids.industry,
      JSON.stringify({ sitespecific: { bao: { threshold: 80 } } }),
    ])
  ).id;
  ids.employer = (await q(`insert into employers (name, industry_id) values ($1,$2) returning id`, [`${TAG} employer`, ids.industry])).id;
  ids.account = (await q(`insert into ledger_accounts (name) values ($1) returning id`, [`${TAG} account`])).id;

  // Billed status ids: Active + FMLA.
  const statuses = (await pool.query(`select id, name, code from options_employment_status`)).rows;
  const activeId = statuses.find((s: any) => (s.code || "").toUpperCase() === "ACTIVE")?.id;
  const fmlaId = statuses.find((s: any) => (s.code || "").toUpperCase() === "FMLA")?.id;
  if (!activeId || !fmlaId) throw new Error("Active/FMLA employment-status options not found");

  ids.config = (
    await q(
      `insert into plugin_configs (plugin_kind, plugin_id, enabled, name, data) values ('charge','bao-hourly',true,$1,$2) returning id`,
      [`${TAG} bao-hourly`, JSON.stringify({ data: { billedEmploymentStatusIds: [activeId, fmlaId] } })],
    )
  ).id;
  await pool.query(`insert into plugin_configs_charge (id, scope, employer_id, account) values ($1,'employer',$2,$3)`, [
    ids.config,
    ids.employer,
    ids.account,
  ]);
  ids.rate = (
    await q(
      `insert into sitespecific_bao_employer_rates (employer_id, account_id, rate, effective_ymd) values ($1,$2,'2.50','2026-01-01') returning id`,
      [ids.employer, ids.account],
    )
  ).id;

  // Pre-create the first 60% of workers (with member-status history so FMLA
  // thresholds resolve); the rest are new-worker rows for the verify scan.
  const rows = buildRows(ROWS);
  const preCreate = Math.floor(ROWS * 0.6);
  await timed("seed:workers", async () => {
    for (let i = 0; i < preCreate; i++) {
      const w = await storage.workers.createWorker(`${rows[i].first} ${rows[i].last}`);
      await storage.workers.updateWorkerSSN(w.id, rows[i].ssn);
      await pool.query(`insert into worker_msh (date, worker_id, ms_id, industry_id) values ('2026-01-01',$1,$2,$3)`, [
        w.id,
        ids.ms,
        ids.industry,
      ]);
    }
  });

  // Wizard + uploaded file.
  const wizard = await storage.wizards.createMonthlyWizard({
    wizard: {
      type: "bao_monthly_hours",
      status: "draft",
      currentStep: "upload",
      entityId: ids.employer,
      data: { launchArguments: { year: YEAR, month: MONTH } },
    } as any,
    employerId: ids.employer,
    year: YEAR,
    month: MONTH,
  });
  ids.wizard = wizard.id;

  const header = [
    "SSN", "First", "Last", "DOB", "Status", "Hours", "Phone", "Address", "City", "State", "Zip", "Withholding",
  ];
  const csvRows = [
    header,
    ...rows.map((r, i) => [
      r.ssn, r.first, r.last, r.dob, r.status, r.hours,
      `555-01${String(i % 100).padStart(2, "0")}`,
      `${100 + i} Main St`, "Townsville", "MN", "55401", r.withholding,
    ]),
  ];
  const csvBuffer = Buffer.from(stringifyCSV(csvRows), "utf-8");
  const uploaded = await fileSystemService.upload({
    fileSystemId: FS_ID,
    fileName: "hours-profile.csv",
    fileContent: csvBuffer,
    mimeType: "text/csv",
  });
  const fileRow = await storage.files.create({
    fileName: "hours-profile.csv",
    mimeType: "text/csv",
    size: uploaded.size,
    storagePath: uploaded.storagePath,
    uploadedBy: "system",
    entityType: "wizard",
    entityId: wizard.id,
    fileSystemId: FS_ID,
  } as any);

  // Mapping shape: sourceCol → fieldId (see applyColumnMapping in feed.ts).
  const columnMapping: Record<string, string> = {
    col_0: "ssn",
    col_1: "firstName",
    col_2: "lastName",
    col_3: "dateOfBirth",
    col_4: "employmentStatus",
    col_5: "numberOfHours",
    col_6: "phoneNumber",
    col_7: "addressLine1",
    col_8: "city",
    col_9: "state",
    col_10: "postalCode",
    col_11: "withholdingAmount",
  };
  await storage.wizards.update(wizard.id, {
    data: {
      ...(wizard.data as any),
      uploadedFileId: fileRow.id,
      columnMapping,
      hasHeaders: true,
      mode: "create",
    },
  });

  const mergeWizardData = async (patch: Record<string, unknown>) => {
    const w = await storage.wizards.getById(wizard.id);
    await storage.wizards.update(wizard.id, { data: { ...((w!.data as any) || {}), ...patch } });
  };

  const snapshot: Record<string, unknown> = { label: LABEL, rows: ROWS };

  try {
    console.log("\nRunning pipeline...");
    // 1. Validate.
    const validation = await timed("validate", () => baoMonthlyHours.validateFeedData(wizard.id));
    snapshot.validation = {
      totalRows: validation.totalRows,
      validRows: validation.validRows,
      invalidRows: validation.invalidRows,
      errorSummary: validation.errorSummary,
      ssnWarnings: (validation.ssnWarnings || []).length,
    };

    // 2. Verify new-worker scan (the plugin step's run handler).
    const verifyStep = baoMonthlyHoursPlugin.steps.find((s) => s.id === "verify")!;
    const verifyCtx: any = {
      wizardId: wizard.id,
      wizard: await storage.wizards.getById(wizard.id),
      input: {},
      storage,
      reportProgress: async () => {},
    };
    const verifyResult: any = await timed("verify-scan", () => verifyStep.run!(verifyCtx));
    await mergeWizardData(verifyResult.data);
    snapshot.verify = {
      newWorkers: verifyResult.data.verifyNewWorkers.rows.length,
      withCandidates: verifyResult.data.verifyNewWorkers.rows.filter((r: any) => r.candidates.length > 0).length,
    };

    // 3. Preview.
    const preview = await timed("preview", () => baoMonthlyHours.computePreview(wizard.id));
    await mergeWizardData({ previewResults: preview });
    snapshot.preview = {
      totals: preview.totals,
      splitCount: preview.workers.filter((w) => w.fmlaSplit).length,
      workers: preview.workers.map((w) => ({
        ssn: w.ssnMasked,
        status: w.statusName,
        reported: w.reportedHours,
        active: w.activeHours,
        fmla: w.fmlaHours,
        billed: w.billedAmount,
        withholding: w.withholdingAmount,
        notes: w.notes,
      })),
    };

    // 4. Process.
    const results = await timed("process", () => baoMonthlyHours.processFeedData(wizard.id));
    snapshot.process = {
      totalRows: results.totalRows,
      createdCount: results.createdCount,
      updatedCount: results.updatedCount,
      failureCount: results.failureCount,
      rowResults: results.rowResults.map((r) => `${r.rowIndex}:${r.status}:${r.message}`),
    };

    // Parity snapshot from the DB (id-free, keyed by SSN).
    const hours = (
      await pool.query(
        `select regexp_replace(w.ssn,'[^0-9]','','g') as ssn, wh.day, wh.hours, es.name as status
         from worker_hours wh
         join workers w on w.id = wh.worker_id
         join options_employment_status es on es.id = wh.employment_status_id
         where wh.employer_id = $1 and wh.year = $2 and wh.month = $3
         order by 1, wh.day`,
        [ids.employer, YEAR, MONTH],
      )
    ).rows;
    snapshot.hoursRows = hours;
    const ledger = await q(
      `select count(*)::int as count, coalesce(sum(amount::numeric),0)::numeric(14,2) as total from ledger where charge_plugin_config_id = $1`,
      [ids.config],
    );
    snapshot.ledger = ledger;
    const allocations = (
      await pool.query(
        `select regexp_replace(w.ssn,'[^0-9]','','g') as ssn, a.amount
         from sitespecific_bao_withholding_allocations a join workers w on w.id = a.worker_id
         where a.wizard_id = $1 order by 1`,
        [wizard.id],
      )
    ).rows;
    snapshot.allocations = allocations;
    const wsh = await q(
      `select count(*)::int as count from worker_wsh where data->>'source' = 'hours_upload' and worker_id in (select id from workers where regexp_replace(coalesce(ssn,''),'[^0-9]','','g') like '70012%')`,
    );
    snapshot.workStatusEntries = wsh.count;

    // Result CSV content (timestamped name excluded).
    if (results.resultsFileId) {
      const rf = await storage.files.getById(results.resultsFileId);
      const buf = await fileSystemService.download(rf!.fileSystemId, rf!.storagePath);
      snapshot.resultCsv = buf.toString("utf-8");
    }

    snapshot.timings = timings;
    const outPath = `/tmp/bao-profile-${LABEL}.json`;
    fs.writeFileSync(outPath, JSON.stringify(snapshot, null, 2));
    console.log(`\nTimings (ms): ${JSON.stringify(timings)}`);
    console.log(`Snapshot written to ${outPath}`);
  } finally {
    if (KEEP) {
      console.log("--keep: leaving seeded data in place");
    } else {
      console.log("Cleaning up...");
      await cleanup(ids);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Profile run crashed:", err);
    process.exit(1);
  });
