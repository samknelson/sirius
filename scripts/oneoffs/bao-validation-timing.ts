/**
 * Privacy-safe validation benchmark + persisted progress regression.
 * Run: npx tsx scripts/oneoffs/bao-validation-timing.ts
 * Requires the development database; creates and removes one disposable wizard.
 */
import { storage } from "../../server/storage/index";
import { baoMonthlyHours } from "../../server/plugins/wizards/engine/types/bao_monthly_hours";
import { createUnifiedOptionsStorage } from "../../server/storage/unified-options";
import { parse as parseCsv } from "csv-parse/sync";

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  const statuses = await createUnifiedOptionsStorage().list("employment-status");
  const active = statuses.find(s => /active/i.test(s.name));
  const disability = statuses.find(s => s.name.trim().toLowerCase() === "disability");
  assert(active && disability, "Development DB needs Active and retired Disability options");

  const wizard = await storage.wizards.create({
    type: "bao_monthly_hours", status: "draft", currentStep: "validate",
    data: { uploadedFileId: "synthetic", columnMapping: {} },
  });
  const originalLoad = baoMonthlyHours.loadMappedRows;
  const originalGet = storage.variables.getByName;
  const originalMappings = storage.wizardEmploymentStatusMappings.getByEmployer;
  const originalMerge = storage.wizards.mergeData;
  const originalProgress = storage.wizards.writeStepProgress;
  let resultWriteMs = 0;
  let progressWriteMs = 0;
  const rows = Array.from({ length: 2000 }, (_, i) => ({
    ssn: `123-45-${String(i + 1).padStart(4, "0")}`,
    firstName: "Synthetic", lastName: "Worker", dateOfBirth: "6/8/1985",
    phoneNumber: "555-0100", addressLine1: "1 Test St", city: "Test",
    state: "MN", postalCode: "55401", employmentStatus: i % 4 === 0 ? disability!.name : active!.name,
    numberOfHours: "40", withholdingAmount: "$12.50",
  }));
  let settingsReads = 0;
  try {
    const csv = ["ssn,employmentStatus,numberOfHours,dateOfBirth",
      ...rows.map(r => `${r.ssn},${r.employmentStatus},${r.numberOfHours},${r.dateOfBirth}`)].join("\n");
    const parseStart = Date.now();
    assert(parseCsv(csv, { columns: true }).length === rows.length, "Synthetic CSV parses");
    const parseMs = Date.now() - parseStart;
    (baoMonthlyHours as any).loadMappedRows = async () => ({
      wizard, wizardData: wizard.data, mappedRows: rows, mode: "create", rawRows: [], file: {},
    });
    (storage.variables as any).getByName = async (...args: any[]) => {
      settingsReads++;
      await delay(5);
      return originalGet.apply(storage.variables, args as any);
    };
    (storage.wizardEmploymentStatusMappings as any).getByEmployer = async () => [];
    (storage.wizards as any).mergeData = async (...args: any[]) => {
      const t = Date.now();
      try { return await originalMerge.apply(storage.wizards, args as any); }
      finally { resultWriteMs += Date.now() - t; }
    };
    (storage.wizards as any).writeStepProgress = async (...args: any[]) => {
      const t = Date.now();
      try { return await originalProgress.apply(storage.wizards, args as any); }
      finally { progressWriteMs += Date.now() - t; }
    };
    const runId = "synthetic-run";
    await storage.wizards.writeStepProgress(wizard.id, "validate", runId, {
      status: "in_progress", percentComplete: 0,
    }, true);
    let progressWrites = 0;
    const started = Date.now();
    const results = await baoMonthlyHours.validateFeedData(wizard.id, 100, p => {
      if (p.processed % 200 === 0) {
        progressWrites++;
        // Deliberately land some writes after completion.
        void (async () => {
          await delay(80);
          await storage.wizards.writeStepProgress(wizard.id, "validate", runId,
            { percentComplete: Math.round(p.processed / p.total * 99) });
        })();
      }
    });
    const validationMs = Date.now() - started;
    assert(results.totalRows === 2000 && results.invalidRows === 0, "Clean validation counts");
    assert(settingsReads === 1, "Disability mode must be read once per run");
    await storage.wizards.writeStepProgress(wizard.id, "validate", runId,
      { status: "completed", percentComplete: 100, completedAt: new Date().toISOString() });
    await delay(150);
    let saved = await storage.wizards.getById(wizard.id);
    assert((saved?.data as any)?.progress?.validate?.status === "completed", "Late progress must not revive the run");
    assert((saved?.data as any)?.validationResults?.totalRows === 2000, "Results must survive late progress");
    // Re-validation sees new settings and cannot accept a delayed write from the old run.
    const nextRun = "synthetic-rerun";
    await storage.wizards.writeStepProgress(wizard.id, "validate", nextRun, { status: "in_progress", percentComplete: 0 }, true);
    assert(!await storage.wizards.writeStepProgress(wizard.id, "validate", runId, { percentComplete: 75 }), "Old run cannot overwrite rerun");
    rows[0].numberOfHours = "-4";
    rows[1].employmentStatus = "Unmapped synthetic status";
    const invalid = await baoMonthlyHours.validateFeedData(wizard.id, 100);
    assert(invalid.invalidRows === 1 && invalid.unmappedStatuses?.length === 1,
      `Errors and unmapped status survive rerun: ${invalid.invalidRows} invalid, ${invalid.unmappedStatuses?.length} unmapped, warnings=${invalid.ssnWarnings?.length}, ${JSON.stringify(invalid.errors.slice(0, 20).map(e => [e.rowIndex, e.field, e.message]))}`);
    assert(settingsReads === 2, "Re-validation reloads configuration");
    await storage.wizards.writeStepProgress(wizard.id, "validate", nextRun, { status: "failed", error: "Synthetic server failure" });
    saved = await storage.wizards.getById(wizard.id);
    assert((saved?.data as any)?.progress?.validate?.error === "Synthetic server failure", "Failed state is durable on refresh");
    console.log(JSON.stringify({
      rows: 2000, batchSize: 100, parseMs, validationMs, resultWriteMs, progressWriteMs, settingsReadsFirstRun: 1,
      oldPerDisabilityRowSettingDelayMs: 500 * 5,
      progressWrites, terminalStateAfterDelayedWrites: "completed",
      refreshFailureState: (saved?.data as any)?.progress?.validate?.status,
    }));
  } finally {
    baoMonthlyHours.loadMappedRows = originalLoad;
    (storage.variables as any).getByName = originalGet;
    (storage.wizardEmploymentStatusMappings as any).getByEmployer = originalMappings;
    (storage.wizards as any).mergeData = originalMerge;
    (storage.wizards as any).writeStepProgress = originalProgress;
    await storage.wizards.delete(wizard.id);
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });