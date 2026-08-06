/**
 * Smoke test for Task: BAO Hours Wizard — FMLA split, validation, Preview.
 *
 * Covers:
 *  1. computeFmlaSplit math (under / at / over threshold, unresolvable).
 *  2. validateRow rejection of bad date formats and bad withholding amounts
 *     (runs against the real dev DB for status option resolution).
 *  3. computePreview: per-worker totals with the FMLA breakout, billing from
 *     stubbed rates/configs, and the withholding-hidden case (storage methods
 *     stubbed on the singleton; no rows are written).
 *
 * Run: npx tsx scripts/oneoffs/bao-hours-wizard-smoke.ts
 * Exits non-zero on failure.
 */
// IMPORTANT: load the storage barrel BEFORE any wizard engine module — using
// an engine type as the entry module trips a barrel init cycle
// (storage → wizard registry → engine types → feed while feed is mid-init).
import { storage } from "../../server/storage/index";
import {
  baoMonthlyHours,
  computeFmlaSplit,
  parseWithholdingAmount,
} from "../../server/plugins/wizards/engine/types/bao_monthly_hours";

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) {
    console.log(`  ok  ${name}`);
  } else {
    failures++;
    console.error(`FAIL  ${name}`, detail === undefined ? "" : JSON.stringify(detail));
  }
}

async function testFmlaSplitMath() {
  console.log("\n[1] computeFmlaSplit");
  // Under threshold: 32 reported, 80 threshold → 32 Active + 48 FMLA.
  const under = computeFmlaSplit(32, 80, true);
  check("under threshold splits 32/48", under.split && under.activeHours === 32 && under.fmlaHours === 48, under);
  // At threshold: no split.
  const at = computeFmlaSplit(80, 80, true);
  check("at threshold: no split", !at.split && at.fmlaHours === 0, at);
  // Over threshold: no split, never negative.
  const over = computeFmlaSplit(100, 80, true);
  check("over threshold: no split", !over.split && over.fmlaHours === 0, over);
  // Unresolvable threshold: no split.
  const unresolved = computeFmlaSplit(32, 0, false);
  check("unresolved threshold: no split", !unresolved.split, unresolved);
  // Zero hours: no split.
  check("zero hours: no split", !computeFmlaSplit(0, 80, true).split);
  // Withholding parser mirrors processing.
  check("withholding parses $1,234.50", parseWithholdingAmount("$1,234.50") === 1234.5);
  check("withholding rejects garbage", !isFinite(parseWithholdingAmount("abc")));
}

async function testValidateRow() {
  console.log("\n[2] validateRow (stricter validation)");
  const base = {
    ssn: "123-45-6789",
    firstName: "Test",
    lastName: "Worker",
    employmentStatus: "Active",
    numberOfHours: "40",
    phoneNumber: "555-0100",
    addressLine1: "1 Main St",
    city: "Townsville",
    state: "MN",
    postalCode: "55401",
  };

  // Rolled-over calendar dates must be rejected, not silently normalized.
  for (const bad of ["13/45/2025", "2/30/2025", "2025-13-40", "0/10/2025", "2025/02/30", "2023/02/29", "2-30-2025"]) {
    const res = await baoMonthlyHours.validateRow({ ...base, dateOfBirth: bad }, 0, "create");
    check(`rollover/invalid calendar date rejected: ${bad}`, res.some((e) => e.field === "dateOfBirth"), res);
  }
  // Real leap days accepted in both orderings.
  for (const good of ["2/29/2024", "2024/02/29", "12/31/1999"]) {
    const res = await baoMonthlyHours.validateRow({ ...base, dateOfBirth: good }, 0, "create");
    check(`valid date accepted: ${good}`, !res.some((e) => e.field === "dateOfBirth"), res);
  }

  // Bad date is now a blocking validation error (previously only failed in process).
  const badDate = await baoMonthlyHours.validateRow({ ...base, dateOfBirth: "13/45/19xx" }, 0, "create");
  check(
    "bad dateOfBirth rejected at validate time",
    badDate.some((e) => e.field === "dateOfBirth"),
    badDate,
  );

  // Good dates pass.
  const goodDate = await baoMonthlyHours.validateRow({ ...base, dateOfBirth: "6/8/1985" }, 0, "create");
  check("M/D/YYYY date accepted", !goodDate.some((e) => e.field === "dateOfBirth"), goodDate);

  // Withholding: negative and garbage rejected; $-formatted accepted.
  const negWh = await baoMonthlyHours.validateRow({ ...base, dateOfBirth: "1985-06-08", withholdingAmount: "-5" }, 0, "create");
  check("negative withholding rejected", negWh.some((e) => e.field === "withholdingAmount"), negWh);
  const badWh = await baoMonthlyHours.validateRow({ ...base, dateOfBirth: "1985-06-08", withholdingAmount: "abc" }, 0, "create");
  check("garbage withholding rejected", badWh.some((e) => e.field === "withholdingAmount"), badWh);
  const dollarWh = await baoMonthlyHours.validateRow({ ...base, dateOfBirth: "1985-06-08", withholdingAmount: "$120.50" }, 0, "create");
  check("$-formatted withholding accepted", !dollarWh.some((e) => e.field === "withholdingAmount"), dollarWh);

  // Negative hours rejected.
  const negHours = await baoMonthlyHours.validateRow({ ...base, dateOfBirth: "1985-06-08", numberOfHours: "-4" }, 0, "create");
  check("negative hours rejected", negHours.some((e) => e.field === "numberOfHours"), negHours);
}

async function testPreview() {
  console.log("\n[3] computePreview (stubbed storage, read-only)");

  const EMPLOYER_ID = "smoke-employer";
  const WORKER_ID = "smoke-worker-1";
  const ACCOUNT_ID = "smoke-account";

  // Find real status option ids so isStatusBilled filtering is realistic.
  const { createUnifiedOptionsStorage } = await import("../../server/storage/unified-options");
  const opts = createUnifiedOptionsStorage();
  const statuses = await opts.list("employment-status");
  const norm = (v: string) => String(v || "").toLowerCase();
  const fmla = statuses.find((s: any) => norm(s.code) === "fmla" || norm(s.name) === "fmla");
  const active = statuses.find(
    (s: any) => norm(s.name) === "active" || norm(s.code) === "active" || norm(s.code) === "default",
  );
  if (!fmla || !active) {
    check("FMLA + Active status options exist in dev DB", false, statuses.map((s: any) => s.code));
    return;
  }

  // ---- Stubs on the singleton (no writes anywhere) ----
  const originals: Array<[any, string, any]> = [];
  function stub(obj: any, key: string, fn: any) {
    originals.push([obj, key, obj[key]]);
    obj[key] = fn;
  }

  const rows = [
    // FMLA worker under an 80-hour threshold: expect 32 Active + 48 FMLA.
    { ssn: "900-11-2222", firstName: "Fmla", lastName: "Under", employmentStatus: "FMLA", numberOfHours: "32", withholdingAmount: "$50" },
    // Active worker, plain hours.
    { ssn: "900-11-3333", firstName: "Plain", lastName: "Active", employmentStatus: "Active", numberOfHours: "100", withholdingAmount: "" },
    // FMLA hours at/over threshold: no split.
    { ssn: "900-11-4444", firstName: "Fmla", lastName: "Over", employmentStatus: "FMLA", numberOfHours: "90", withholdingAmount: "" },
  ];

  const wizardBase = {
    id: "smoke-wizard",
    entityId: EMPLOYER_ID,
    data: {
      launchArguments: { year: 2026, month: 7 },
      columnMapping: { col_0: "ssn", col_1: "employmentStatus", col_2: "numberOfHours", col_3: "withholdingAmount" },
    },
  };

  stub(baoMonthlyHours, "loadMappedRows", async () => ({
    wizard: wizardBase,
    wizardData: wizardBase.data,
    file: {},
    rawRows: [],
    hasHeaders: true,
    mode: "create",
    mappedRows: rows,
  }));

  const workerBySsn: Record<string, any> = {
    "900112222": { id: WORKER_ID },
    "900113333": { id: "smoke-worker-2" },
    "900114444": { id: "smoke-worker-3" },
  };
  stub(storage.workers, "getWorkerBySSN", async (ssn: string) => workerBySsn[String(ssn).replace(/\D/g, "")]);
  stub(storage.employers, "getEmployer", async () => ({ id: EMPLOYER_ID, industryId: "smoke-industry" }));
  // Member-status history: threshold 80 lives on the ms JSON, matching
  // readThresholdFromMs (ms.data.threshold or similar shape).
  const { resolveBaoThreshold } = await import("../../server/plugins/trust/eligibility/plugins/bao-shared");
  stub(storage.workerMsh, "getWorkerMsh", async (workerId: string) =>
    workerId === "smoke-worker-3" || workerId === WORKER_ID
      ? [{ industryId: "smoke-industry", date: "2026-01-01", ms: { data: { sitespecific: { bao: { threshold: 80 } } } } }]
      : [],
  );
  // Sanity: shared resolution sees the 80-hour threshold through the stub.
  const resolved = await resolveBaoThreshold(WORKER_ID, EMPLOYER_ID, "2026-07-31", 0);
  check("stubbed threshold resolves to 80", resolved.resolved && resolved.threshold === 80, resolved);

  stub(storage.pluginConfigs, "search", async (kind: string, params: any) => {
    if (kind !== "charge" || params?.pluginId !== "bao-hourly") return [];
    return [
      {
        config: { id: "smoke-config", pluginId: "bao-hourly", enabled: true, data: {} },
        subsidiary: { id: "smoke-config", scope: "global", employerId: null, account: ACCOUNT_ID },
      },
    ];
  });
  stub(storage.baoEmployerRates, "getEffectiveRate", async () => ({ id: "smoke-rate", rate: "2.50", effectiveYmd: "2026-01-01" }));

  try {
    const preview = await baoMonthlyHours.computePreview("smoke-wizard");

    check("preview covers 3 workers", preview.workers.length === 3, preview.workers.length);
    check("withholding column mapped", preview.withholdingMapped === true);

    const under = preview.workers.find((w) => w.ssnMasked.endsWith("2222"))!;
    check("FMLA under-threshold splits", under.fmlaSplit === true, under);
    check("split: 32 Active + 48 FMLA = 80 total", under.activeHours === 32 && under.fmlaHours === 48 && under.totalHours === 80, under);
    check("split billed = 80h × $2.50 = 200.00", under.billedAmount === "200.00", under.billedAmount);
    check("split worker withholding 50.00", under.withholdingAmount === "50.00", under.withholdingAmount);

    const plain = preview.workers.find((w) => w.ssnMasked.endsWith("3333"))!;
    check("plain Active: no split, 100h", !plain.fmlaSplit && plain.totalHours === 100, plain);
    check("plain billed = 100h × $2.50 = 250.00", plain.billedAmount === "250.00", plain.billedAmount);

    const over = preview.workers.find((w) => w.ssnMasked.endsWith("4444"))!;
    check("FMLA over-threshold: no split, recorded as reported", !over.fmlaSplit && over.totalHours === 90, over);
    check("over-threshold has explanatory note", over.notes.some((n) => n.includes("meet or exceed")), over.notes);

    check("totals billed = 675.00", preview.totals.billedAmount === "675.00", preview.totals);
    check("totals withholding = 50.00", preview.totals.withholdingTotal === "50.00", preview.totals);

    // Withholding-hidden case: mapping without withholdingAmount.
    (wizardBase.data as any).columnMapping = { col_0: "ssn", col_1: "employmentStatus", col_2: "numberOfHours" };
    const rowsNoWh = rows.map(({ withholdingAmount: _wh, ...r }) => r);
    stub(baoMonthlyHours, "loadMappedRows", async () => ({
      wizard: wizardBase,
      wizardData: wizardBase.data,
      file: {},
      rawRows: [],
      hasHeaders: true,
      mode: "create",
      mappedRows: rowsNoWh,
    }));
    const preview2 = await baoMonthlyHours.computePreview("smoke-wizard");
    check("withholding hidden when unmapped", preview2.withholdingMapped === false && preview2.totals.withholdingTotal === null, {
      mapped: preview2.withholdingMapped,
      total: preview2.totals.withholdingTotal,
    });
    check("workers have null withholding when unmapped", preview2.workers.every((w) => w.withholdingAmount === null));
  } finally {
    for (const [obj, key, fn] of originals.reverse()) obj[key] = fn;
  }
}

async function testProcessingReconciliation() {
  console.log("\n[4] processWorkerHours month reconciliation (stubbed writes)");

  const EMPLOYER_ID = "smoke-employer";
  const WORKER_ID = "smoke-worker-1";

  const originals: Array<[any, string, any]> = [];
  function stub(obj: any, key: string, fn: any) {
    originals.push([obj, key, obj[key]]);
    obj[key] = fn;
  }

  const deleted: number[] = [];
  const upserted: Array<{ day: number; hours: number | null; statusId: string }> = [];
  let existingRows: Array<{ id: string; employerId: string; year: number; month: number; day: number }> = [];

  stub(storage.workerHours, "getWorkerHours", async () => existingRows);
  stub(storage.workerHours, "deleteWorkerHours", async (id: string) => {
    deleted.push(Number(id));
    return { success: true, notifications: [] };
  });
  stub(storage.workerHours, "upsertWorkerHours", async (data: any) => {
    upserted.push({ day: data.day ?? 1, hours: data.hours, statusId: data.employmentStatusId });
    return { workerHours: { id: "x" }, notifications: [] };
  });
  stub(storage.employers, "getEmployer", async () => ({ id: EMPLOYER_ID, industryId: "smoke-industry" }));
  stub(storage.workerMsh, "getWorkerMsh", async () => [
    { industryId: "smoke-industry", date: "2026-01-01", ms: { data: { sitespecific: { bao: { threshold: 80 } } } } },
  ]);
  stub(baoMonthlyHours as any, "syncWorkStatusFromEmployment", async () => {});

  const wizard = { id: "smoke-wizard", entityId: EMPLOYER_ID, data: { launchArguments: { year: 2026, month: 7 } } };

  try {
    // Split month with stale legacy rows on other days → only non-kept days deleted.
    existingRows = [
      { id: "10", employerId: EMPLOYER_ID, year: 2026, month: 7, day: 10 },
      { id: "15", employerId: EMPLOYER_ID, year: 2026, month: 7, day: 15 },
      { id: "1", employerId: "other-employer", year: 2026, month: 7, day: 20 }, // other employer: untouched
      { id: "2", employerId: EMPLOYER_ID, year: 2026, month: 6, day: 22 }, // other month: untouched
    ];
    await (baoMonthlyHours as any).processWorkerHours(
      WORKER_ID,
      { employmentStatus: "FMLA", numberOfHours: "32" },
      wizard,
    );
    check("split: legacy day-10 row deleted, day-15 kept for upsert", deleted.length === 1 && deleted[0] === 10, deleted);
    check(
      "split: writes day-1 (32h) + day-15 (48h)",
      upserted.length === 2 &&
        upserted.some((u) => u.day === 1 && u.hours === 32) &&
        upserted.some((u) => u.day === 15 && u.hours === 48),
      upserted,
    );

    // Transition back to a plain Active month → all non-day-1 rows deleted.
    deleted.length = 0;
    upserted.length = 0;
    existingRows = [
      { id: "15", employerId: EMPLOYER_ID, year: 2026, month: 7, day: 15 },
      { id: "9", employerId: EMPLOYER_ID, year: 2026, month: 7, day: 9 },
    ];
    await (baoMonthlyHours as any).processWorkerHours(
      WORKER_ID,
      { employmentStatus: "Active", numberOfHours: "100" },
      wizard,
    );
    check("re-upload: stale day-15 and day-9 rows deleted", deleted.sort().join(",") === "15,9".split(",").sort().join(","), deleted);
    check("re-upload: single day-1 row written", upserted.length === 1 && upserted[0].day === 1 && upserted[0].hours === 100, upserted);
  } finally {
    for (const [obj, key, fn] of originals.reverse()) obj[key] = fn;
  }
}

async function testStalePreviewInvalidation() {
  console.log("\n[5] stale-preview invalidation + Process gating");
  const { prepareBaoDataUpdate } = await import("../../server/plugins/wizards/plugins/bao-monthly-hours");

  const oldValidation = { totalRows: 3, invalidRows: 0, completedAt: "2026-07-01T00:00:00Z" };
  const preview = { workers: [], totals: {}, completedAt: "2026-07-01T01:00:00Z" };
  const progress = { validate: { status: "completed" }, preview: { status: "completed" } };

  // Validation RERUN (new validationResults object) must clear the preview.
  const newValidation = { totalRows: 3, invalidRows: 0, completedAt: "2026-07-02T00:00:00Z" };
  const rerun = prepareBaoDataUpdate({
    existing: { data: { validationResults: oldValidation, previewResults: preview, progress } },
    incoming: { validationResults: newValidation },
    merged: { validationResults: newValidation, previewResults: preview, progress: { ...progress } },
  } as any) as any;
  check(
    "validation rerun clears previewResults + progress.preview",
    rerun.data && rerun.data.previewResults === undefined && rerun.data.progress?.preview === undefined,
    rerun.data && { preview: rerun.data.previewResults, progress: rerun.data.progress },
  );
  check("validation rerun keeps validationResults", rerun.data?.validationResults === newValidation);

  // An unrelated update (no validationResults in incoming) keeps the preview.
  const unrelated = prepareBaoDataUpdate({
    existing: { data: { validationResults: oldValidation, previewResults: preview, progress } },
    incoming: { notes: "x" },
    merged: { validationResults: oldValidation, previewResults: preview, progress: { ...progress }, notes: "x" },
  } as any) as any;
  check("unrelated update keeps preview", unrelated.data?.previewResults === preview, unrelated.data?.previewResults);

  // Process step refuses to run without previewResults.
  const { baoMonthlyHoursPlugin } = await import("../../server/plugins/wizards/plugins/bao-monthly-hours");
  const processStep = baoMonthlyHoursPlugin.steps?.find((s: any) => s.id === "process");
  check("process step exists", !!processStep);
  if (processStep) {
    let threw: string | null = null;
    try {
      await processStep.run!({ wizardId: "x", wizard: { data: { validationResults: oldValidation } }, reportProgress: async () => {} } as any);
    } catch (e: any) {
      threw = e?.message ?? String(e);
    }
    check("process without preview throws", !!threw && threw.includes("Preview"), threw);
  }
}

async function main() {
  await testFmlaSplitMath();
  await testValidateRow();
  await testPreview();
  await testProcessingReconciliation();
  await testStalePreviewInvalidation();

  console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Smoke test crashed:", err);
  process.exit(1);
});
