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
  stub(storage.workers, "getWorkersBySSNs", async (ssns: string[]) => {
    const map = new Map<string, any>();
    for (const raw of ssns) {
      const digits = String(raw).replace(/\D/g, "").padStart(9, "0");
      const w = workerBySsn[digits];
      if (w) map.set(digits, w);
    }
    return map;
  });
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

  const deleted: string[] = [];
  const upserted: Array<{ day: number; hours: number | null; statusId: string }> = [];
  // Represents the current DB state for (workerId, employerId, year, month).
  // Tests update this between calls to simulate DB writes from upserts.
  let currentMonthRows: Array<{ id: string; day: number }> = [];

  stub(storage.workerHours, "getWorkerHoursForMonth", async (_wid: string, _eid: string, _yr: number, _mo: number) => {
    return currentMonthRows.slice();
  });
  stub(storage.workerHours, "deleteWorkerHours", async (id: string) => {
    deleted.push(id);
    currentMonthRows = currentMonthRows.filter((r) => r.id !== id);
    return { success: true, notifications: [] };
  });
  let nextUpsertId = 100;
  stub(storage.workerHours, "upsertWorkerHours", async (data: any) => {
    const day = data.day ?? 1;
    upserted.push({ day, hours: data.hours, statusId: data.employmentStatusId });
    // Simulate an upsert: replace existing row for this day or add a new one.
    currentMonthRows = currentMonthRows.filter((r) => r.day !== day);
    currentMonthRows.push({ id: String(nextUpsertId++), day });
    return { data: { id: String(nextUpsertId - 1) }, notifications: [] };
  });
  stub(storage.employers, "getEmployer", async () => ({ id: EMPLOYER_ID, industryId: "smoke-industry" }));
  stub(storage.workerMsh, "getWorkerMsh", async () => [
    { industryId: "smoke-industry", date: "2026-01-01", ms: { data: { sitespecific: { bao: { threshold: 80 } } } } },
  ]);
  stub(baoMonthlyHours as any, "syncWorkStatusFromEmployment", async () => {});

  const wizard = { id: "smoke-wizard", entityId: EMPLOYER_ID, data: { launchArguments: { year: 2026, month: 7 } } };

  try {
    // [A] FMLA split with stale legacy rows on other days → only non-kept days deleted.
    currentMonthRows = [
      { id: "10", day: 10 },
      { id: "15", day: 15 },
    ];
    await (baoMonthlyHours as any).processWorkerHours(
      WORKER_ID,
      { employmentStatus: "FMLA", numberOfHours: "32" },
      wizard,
    );
    check("[A] split: legacy day-10 deleted, day-15 kept for upsert", deleted.length === 1 && deleted[0] === "10", deleted);
    check(
      "[A] split: writes day-1 (32h) + day-15 (48h)",
      upserted.length === 2 &&
        upserted.some((u) => u.day === 1 && u.hours === 32) &&
        upserted.some((u) => u.day === 15 && u.hours === 48),
      upserted,
    );

    // [B] Re-upload same worker as Active → day-15 FMLA top-up deleted, single day-1 written.
    deleted.length = 0;
    upserted.length = 0;
    currentMonthRows = [
      { id: "15", day: 15 },
      { id: "9", day: 9 },
    ];
    await (baoMonthlyHours as any).processWorkerHours(
      WORKER_ID,
      { employmentStatus: "Active", numberOfHours: "100" },
      wizard,
    );
    check("[B] re-upload: stale day-15 and day-9 deleted", [...deleted].sort().join(",") === ["15","9"].sort().join(","), deleted);
    check("[B] re-upload: single day-1 row written", upserted.length === 1 && upserted[0].day === 1 && upserted[0].hours === 100, upserted);
  } finally {
    for (const [obj, key, fn] of originals.reverse()) obj[key] = fn;
  }
}

async function testDuplicateSsnReconciliation() {
  console.log("\n[5] duplicate-SSN reconciliation (split→non-split and non-split→split)");

  const EMPLOYER_ID = "smoke-employer";
  const WORKER_ID = "smoke-worker-dup";

  const originals: Array<[any, string, any]> = [];
  function stub(obj: any, key: string, fn: any) {
    originals.push([obj, key, obj[key]]);
    obj[key] = fn;
  }

  const deleted: string[] = [];
  const upserted: Array<{ day: number; hours: number | null }> = [];
  let currentMonthRows: Array<{ id: string; day: number }> = [];

  stub(storage.workerHours, "getWorkerHoursForMonth", async () => currentMonthRows.slice());
  stub(storage.workerHours, "deleteWorkerHours", async (id: string) => {
    deleted.push(id);
    currentMonthRows = currentMonthRows.filter((r) => r.id !== id);
    return { success: true, notifications: [] };
  });
  let nextId = 200;
  stub(storage.workerHours, "upsertWorkerHours", async (data: any) => {
    const day = data.day ?? 1;
    upserted.push({ day, hours: data.hours });
    currentMonthRows = currentMonthRows.filter((r) => r.day !== day);
    currentMonthRows.push({ id: String(nextId++), day });
    return { data: { id: String(nextId - 1) }, notifications: [] };
  });
  stub(storage.employers, "getEmployer", async () => ({ id: EMPLOYER_ID, industryId: "smoke-industry" }));
  stub(storage.workerMsh, "getWorkerMsh", async () => [
    { industryId: "smoke-industry", date: "2026-01-01", ms: { data: { sitespecific: { bao: { threshold: 80 } } } } },
  ]);
  stub(baoMonthlyHours as any, "syncWorkStatusFromEmployment", async () => {});

  const wizard = { id: "dup-wizard", entityId: EMPLOYER_ID, data: { launchArguments: { year: 2026, month: 7 } } };

  try {
    // --- Scenario 1: split → non-split (FMLA row first, then Active overrides) ---
    // No pre-existing rows. Row 1 = FMLA 32h → creates day-1 (32h Active) + day-15 (48h FMLA).
    // Row 2 = Active 100h → must delete day-15, upsert day-1 as Active 100h.
    currentMonthRows = [];
    deleted.length = 0;
    upserted.length = 0;

    await (baoMonthlyHours as any).processWorkerHours(WORKER_ID, { employmentStatus: "FMLA", numberOfHours: "32" }, wizard);
    check("dup[S1] first row (FMLA): 2 upserts written", upserted.length === 2, upserted.length);
    check("dup[S1] first row: day-1 + day-15 exist", currentMonthRows.length === 2, currentMonthRows.map(r=>r.day));

    deleted.length = 0;
    upserted.length = 0;
    await (baoMonthlyHours as any).processWorkerHours(WORKER_ID, { employmentStatus: "Active", numberOfHours: "100" }, wizard);
    check("dup[S1] second row (Active): day-15 FMLA top-up deleted", deleted.length === 1, deleted);
    check("dup[S1] second row: only day-1 remains in DB", currentMonthRows.length === 1 && currentMonthRows[0].day === 1, currentMonthRows.map(r=>r.day));
    check("dup[S1] second row: day-1 upsert written", upserted.length === 1 && upserted[0].day === 1 && upserted[0].hours === 100, upserted);

    // --- Scenario 2: non-split → split (Active first, then FMLA overrides) ---
    // No pre-existing rows. Row 1 = Active 100h → creates day-1 (100h).
    // Row 2 = FMLA 32h → reconcile sees day-1 and keeps it, also creates day-15.
    currentMonthRows = [];
    deleted.length = 0;
    upserted.length = 0;

    await (baoMonthlyHours as any).processWorkerHours(WORKER_ID, { employmentStatus: "Active", numberOfHours: "100" }, wizard);
    check("dup[S2] first row (Active): day-1 written", upserted.length === 1 && upserted[0].day === 1, upserted);
    check("dup[S2] first row: day-1 exists in DB", currentMonthRows.length === 1, currentMonthRows.map(r=>r.day));

    deleted.length = 0;
    upserted.length = 0;
    await (baoMonthlyHours as any).processWorkerHours(WORKER_ID, { employmentStatus: "FMLA", numberOfHours: "32" }, wizard);
    check("dup[S2] second row (FMLA): no prior rows deleted (day-1 and day-15 both kept)", deleted.length === 0, deleted);
    check("dup[S2] second row: 2 upserts (day-1 Active + day-15 FMLA)", upserted.length === 2, upserted.length);
    check("dup[S2] second row: day-1 + day-15 in DB", currentMonthRows.length === 2, currentMonthRows.map(r=>r.day));

    // --- Scenario 3: FMLA row with post-write syncWorkStatus failure, then duplicate Active row ---
    // Verifies the finally-block dirty-marking: even though the first row's
    // processWorkerHours threw (after writing day-1 + day-15), the worker was
    // marked dirty, so the duplicate Active row re-queries and deletes day-15.
    currentMonthRows = [];
    deleted.length = 0;
    upserted.length = 0;

    stub(baoMonthlyHours as any, "syncWorkStatusFromEmployment", async () => {
      throw new Error("simulated work-status sync failure");
    });

    let threw = false;
    try {
      await (baoMonthlyHours as any).processWorkerHours(WORKER_ID, { employmentStatus: "FMLA", numberOfHours: "32" }, wizard);
    } catch {
      threw = true;
    }
    check("dup[S3] first row (FMLA, sync fails): throws", threw);
    check("dup[S3] first row: day-1 + day-15 written before the throw", currentMonthRows.length === 2, currentMonthRows.map(r=>r.day));

    // Restore syncWorkStatusFromEmployment before the duplicate row.
    originals.pop(); // remove the throwing stub
    stub(baoMonthlyHours as any, "syncWorkStatusFromEmployment", async () => {});

    deleted.length = 0;
    upserted.length = 0;
    await (baoMonthlyHours as any).processWorkerHours(WORKER_ID, { employmentStatus: "Active", numberOfHours: "100" }, wizard);
    check("dup[S3] duplicate Active row: day-15 FMLA top-up deleted despite prior failure", deleted.length === 1, deleted);
    check("dup[S3] duplicate Active row: only day-1 remains in DB", currentMonthRows.length === 1 && currentMonthRows[0].day === 1, currentMonthRows.map(r=>r.day));
  } finally {
    for (const [obj, key, fn] of originals.reverse()) obj[key] = fn;
  }
}

async function testStalePreviewInvalidation() {
  console.log("\n[6] stale-preview invalidation + Process gating");
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

/**
 * Test 7: ChargeTransactionCollector batching behaviour.
 *
 * Verifies that when `withChargeBatchCollector` is active:
 *  - The executor's `createLedgerEntries` pushes to the sink instead of
 *    calling `storage.ledger.entries.create` immediately.
 *  - `flush()` resolves EAs in parallel and calls `bulkCreate` exactly once
 *    with all accumulated transactions.
 *  - The EA cache is populated during the run so the plugin's
 *    `getOrCreateEaCached` calls don't repeat DB round-trips.
 *  - If `fn` throws, flush still runs (finally block) and accumulated
 *    transactions are not lost.
 */
async function testChargeBatchCollector() {
  console.log("\n[7] ChargeTransactionCollector: deferred bulk-insert behaviour");

  const { withChargeBatchCollector, ChargeTransactionCollector } =
    await import("../../server/plugins/ledger/charge/charge-batch");
  const { requestContext } = await import("../../server/middleware/request-context");

  // ---- 7a: transactions are deferred, not written immediately ----
  {
    const createCalls: any[] = [];
    const bulkCalls: any[] = [];
    const eaGetOrCreateCalls: any[] = [];

    const origCreate = storage.ledger.entries.create;
    const origBulkCreate = (storage.ledger.entries as any).bulkCreate;
    const origEaGetOrCreate = storage.ledger.ea.getOrCreate;

    (storage.ledger.entries as any).create = async (entry: any) => {
      createCalls.push(entry);
      return { id: "x", ...entry };
    };
    (storage.ledger.entries as any).bulkCreate = async (entries: any[]) => {
      bulkCalls.push(entries);
      return entries.map((e, i) => ({ id: String(i), ...e }));
    };
    (storage.ledger.ea as any).getOrCreate = async (type: string, entityId: string, accountId: string) => {
      eaGetOrCreateCalls.push({ type, entityId, accountId });
      return { id: `ea-${entityId}-${accountId}`, entityType: type, entityId, accountId };
    };

    try {
      await withChargeBatchCollector(async () => {
        // Simulate two transactions being pushed by the executor
        const sink = requestContext.getStore()?.chargeTransactionSink;
        check("7a: sink is installed inside withChargeBatchCollector", !!sink);

        // Push two fake transactions (same EA → only one EA getOrCreate during flush)
        sink?.push({
          chargePlugin: "bao-hourly",
          chargePluginKey: "cfg-1:ea-emp1-acc1:hours-1",
          chargePluginConfigId: "cfg-1",
          accountId: "acc1",
          entityType: "employer",
          entityId: "emp1",
          amount: "25.00",
          description: "BAO hours",
          transactionDate: new Date("2026-07-31"),
          referenceType: "worker_hours",
          referenceId: "hours-1",
        });
        sink?.push({
          chargePlugin: "bao-hourly",
          chargePluginKey: "cfg-1:ea-emp1-acc1:hours-2",
          chargePluginConfigId: "cfg-1",
          accountId: "acc1",
          entityType: "employer",
          entityId: "emp1",
          amount: "30.00",
          description: "BAO hours",
          transactionDate: new Date("2026-07-31"),
          referenceType: "worker_hours",
          referenceId: "hours-2",
        });

        // While still inside the scope, immediate create should NOT have been called
        check("7a: no immediate create while inside scope", createCalls.length === 0, createCalls.length);
        check("7a: no bulkCreate while inside scope", bulkCalls.length === 0, bulkCalls.length);
      });

      // After withChargeBatchCollector returns, flush was called
      check("7a: create was never called (deferred)", createCalls.length === 0, createCalls.length);
      check("7a: bulkCreate called exactly once", bulkCalls.length === 1, bulkCalls.length);
      check(
        "7a: bulkCreate received both transactions",
        bulkCalls[0]?.length === 2,
        bulkCalls[0]?.length,
      );
      check(
        "7a: EA resolved once (1 unique triplet for 2 transactions)",
        eaGetOrCreateCalls.length === 1,
        eaGetOrCreateCalls.length,
      );
      check("7a: sink is absent after scope exits", !requestContext.getStore()?.chargeTransactionSink);
    } finally {
      (storage.ledger.entries as any).create = origCreate;
      (storage.ledger.entries as any).bulkCreate = origBulkCreate;
      (storage.ledger.ea as any).getOrCreate = origEaGetOrCreate;
    }
  }

  // ---- 7b: flush runs even when fn throws ----
  {
    const bulkCalls: any[] = [];
    const origBulkCreate = (storage.ledger.entries as any).bulkCreate;
    const origEaGetOrCreate = storage.ledger.ea.getOrCreate;

    (storage.ledger.entries as any).bulkCreate = async (entries: any[]) => {
      bulkCalls.push(entries);
      return entries.map((e, i) => ({ id: String(i), ...e }));
    };
    (storage.ledger.ea as any).getOrCreate = async (_t: string, entityId: string, accountId: string) => ({
      id: `ea-${entityId}-${accountId}`,
      entityType: _t,
      entityId,
      accountId,
    });

    let caught = false;
    try {
      await withChargeBatchCollector(async () => {
        const sink = requestContext.getStore()?.chargeTransactionSink;
        sink?.push({
          chargePlugin: "bao-hourly",
          chargePluginKey: "cfg-1:ea-emp2-acc1:hours-3",
          chargePluginConfigId: "cfg-1",
          accountId: "acc1",
          entityType: "employer",
          entityId: "emp2",
          amount: "10.00",
          description: "test",
          transactionDate: new Date(),
        });
        throw new Error("simulated outer failure");
      });
    } catch {
      caught = true;
    } finally {
      (storage.ledger.entries as any).bulkCreate = origBulkCreate;
      (storage.ledger.ea as any).getOrCreate = origEaGetOrCreate;
    }
    check("7b: withChargeBatchCollector re-throws fn error", caught);
    check("7b: flush still ran despite error (bulkCreate called)", bulkCalls.length === 1, bulkCalls.length);
    check("7b: the accumulated transaction was flushed", bulkCalls[0]?.length === 1, bulkCalls[0]?.length);
  }

  // ---- 7b2: duplicate keys in the same run are coalesced (last-writer-wins) ----
  // Simulates a duplicate-SSN upload where two rows produce transactions for
  // the same chargePluginKey (because the hours row was upserted in-place via
  // ON CONFLICT, returning the same id). The collector must keep only the last
  // transaction, and flush must issue a single-row INSERT (not two rows for
  // the same key, which PostgreSQL would reject with a cardinality violation).
  {
    const bulkCalls: any[][] = [];
    const origBulkCreate = (storage.ledger.entries as any).bulkCreate;
    const origEaGetOrCreate = storage.ledger.ea.getOrCreate;

    (storage.ledger.entries as any).bulkCreate = async (entries: any[]) => {
      bulkCalls.push(entries);
      return entries.map((e, i) => ({ id: String(i), ...e }));
    };
    (storage.ledger.ea as any).getOrCreate = async (_t: string, entityId: string, accountId: string) => ({
      id: `ea-${entityId}-${accountId}`, entityType: _t, entityId, accountId,
    });

    try {
      await withChargeBatchCollector(async () => {
        const sink = requestContext.getStore()?.chargeTransactionSink!;
        // Row A: creates transaction for hours-id "h1" at $25
        sink.push({
          chargePlugin: "bao-hourly", chargePluginKey: "cfg-1:ea-emp4-acc1:h1",
          chargePluginConfigId: "cfg-1", accountId: "acc1",
          entityType: "employer", entityId: "emp4",
          amount: "25.00", description: "row A", transactionDate: new Date("2026-07-31"),
          referenceType: "worker_hours", referenceId: "h1",
        });
        // Row B (duplicate SSN, same hours id h1 due to ON CONFLICT): creates at $30
        sink.push({
          chargePlugin: "bao-hourly", chargePluginKey: "cfg-1:ea-emp4-acc1:h1",
          chargePluginConfigId: "cfg-1", accountId: "acc1",
          entityType: "employer", entityId: "emp4",
          amount: "30.00", description: "row B", transactionDate: new Date("2026-07-31"),
          referenceType: "worker_hours", referenceId: "h1",
        });
      });
      check("7b2: only ONE entry flushed (duplicate key coalesced)", bulkCalls[0]?.length === 1, bulkCalls[0]?.length);
      check("7b2: coalesced entry has row B's amount (last-writer-wins)", bulkCalls[0]?.[0]?.amount === "30.00", bulkCalls[0]?.[0]?.amount);
    } finally {
      (storage.ledger.entries as any).bulkCreate = origBulkCreate;
      (storage.ledger.ea as any).getOrCreate = origEaGetOrCreate;
    }
  }

  // ---- 7b3: orphaned-entry cancellation via collector-aware delete ----
  // Simulates the FMLA-then-Active duplicate-SSN case at the collector level:
  // Row A queues a pending entry for h2 (FMLA top-up). Then deleteWorkerHours
  // fires for h2 (hours=0): the plugin calls getByChargePluginKey → sees the
  // pending synthetic entry → takes the delete path → calls delete(syntheticId)
  // → collector cancels the pending create. flush must produce NO entries for h2.
  {
    const bulkCalls: any[][] = [];
    const origBulkCreate = (storage.ledger.entries as any).bulkCreate;
    const origEaGetOrCreate = storage.ledger.ea.getOrCreate;
    const origGetByChargePluginKey = storage.ledger.entries.getByChargePluginKey.bind(storage.ledger.entries);
    const origGetByReferenceAndConfig = storage.ledger.entries.getByReferenceAndConfig.bind(storage.ledger.entries);
    const origDelete = storage.ledger.entries.delete.bind(storage.ledger.entries);

    (storage.ledger.entries as any).bulkCreate = async (entries: any[]) => {
      bulkCalls.push(entries);
      return entries.map((e, i) => ({ id: String(i), ...e }));
    };
    (storage.ledger.ea as any).getOrCreate = async (_t: string, entityId: string, accountId: string) => ({
      id: `ea-${entityId}-${accountId}`, entityType: _t, entityId, accountId,
    });

    try {
      await withChargeBatchCollector(async () => {
        const sink = requestContext.getStore()?.chargeTransactionSink!;

        // Row A queues h1 (Active, day-1) and h2 (FMLA top-up, day-15).
        sink.push({
          chargePlugin: "bao-hourly", chargePluginKey: "cfg-1:ea-emp5-acc1:h1",
          chargePluginConfigId: "cfg-1", accountId: "acc1",
          entityType: "employer", entityId: "emp5",
          amount: "25.00", description: "h1 active", transactionDate: new Date("2026-07-31"),
          referenceType: "worker_hours", referenceId: "h1",
        });
        sink.push({
          chargePlugin: "bao-hourly", chargePluginKey: "cfg-1:ea-emp5-acc1:h2",
          chargePluginConfigId: "cfg-1", accountId: "acc1",
          entityType: "employer", entityId: "emp5",
          amount: "15.00", description: "h2 fmla", transactionDate: new Date("2026-07-31"),
          referenceType: "worker_hours", referenceId: "h2",
        });
        check("7b3: h2 is pending before delete", !!sink.getPendingAsEntry("bao-hourly", "cfg-1:ea-emp5-acc1:h2"));

        // Simulate deleteWorkerHours(h2) firing the plugin's delete path:
        // - getByChargePluginKey sees the pending synthetic entry
        // - getByReferenceAndConfig returns the synthetic entry
        // - delete(syntheticId) cancels from collector
        const existingEntry = sink.getPendingAsEntry("bao-hourly", "cfg-1:ea-emp5-acc1:h2");
        check("7b3: getByChargePluginKey via sink returns synthetic entry", !!existingEntry && existingEntry.amount === "15.00");
        const allEntries = sink.getPendingByReference("h2", "cfg-1");
        check("7b3: getPendingByReference finds h2's synthetic entry", allEntries.length === 1, allEntries.length);
        // Plugin's delete loop:
        for (const entry of allEntries) {
          const cancelled = sink.cancelBySyntheticId(entry.id);
          check("7b3: cancelBySyntheticId returns true for pending id", cancelled);
        }

        check("7b3: h2 is no longer pending after delete", !sink.getPendingAsEntry("bao-hourly", "cfg-1:ea-emp5-acc1:h2"));
        check("7b3: h1 is still pending (not affected)", !!sink.getPendingAsEntry("bao-hourly", "cfg-1:ea-emp5-acc1:h1"));
      });
      // After scope: flush should have written only h1 (h2 was cancelled).
      check("7b3: flush writes only h1 (h2 was cancelled)", bulkCalls[0]?.length === 1, bulkCalls[0]?.length);
      check("7b3: flushed entry is h1", bulkCalls[0]?.[0]?.referenceId === "h1", bulkCalls[0]?.[0]?.referenceId);
    } finally {
      (storage.ledger.entries as any).bulkCreate = origBulkCreate;
      (storage.ledger.ea as any).getOrCreate = origEaGetOrCreate;
    }
  }

  // ---- 7c: EA cache is populated during run (second getOrCreate call is cache hit) ----
  {
    const { getOrCreateEaCached } = await import("../../server/plugins/ledger/charge/ea-cache");
    const eaDbCalls: string[] = [];
    const origEaGetOrCreate = storage.ledger.ea.getOrCreate;

    (storage.ledger.ea as any).getOrCreate = async (_t: string, entityId: string, accountId: string) => {
      eaDbCalls.push(`${_t}:${entityId}:${accountId}`);
      return { id: `ea-${entityId}-${accountId}`, entityType: _t, entityId, accountId };
    };

    try {
      await withChargeBatchCollector(async () => {
        // Call getOrCreateEaCached twice for the same triplet
        await getOrCreateEaCached("employer", "emp3", "acc1");
        await getOrCreateEaCached("employer", "emp3", "acc1");
      });
      check("7c: only 1 DB getOrCreate despite 2 calls (cache hit on 2nd)", eaDbCalls.length === 1, eaDbCalls);
    } finally {
      (storage.ledger.ea as any).getOrCreate = origEaGetOrCreate;
    }
  }
}

async function main() {
  await testFmlaSplitMath();
  await testValidateRow();
  await testPreview();
  await testProcessingReconciliation();
  await testDuplicateSsnReconciliation();
  await testStalePreviewInvalidation();
  await testChargeBatchCollector();

  console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Smoke test crashed:", err);
  process.exit(1);
});
