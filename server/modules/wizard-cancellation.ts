import { storage } from "../storage";
import type { Wizard } from "@shared/schema";

/**
 * Cancellation of a completed monthly-upload wizard run.
 *
 * Cancelling wipes the data the run wrote for its employer + reporting
 * period — worker hours rows and worker monthly benefit (WMB) rows — and
 * lets the existing delete paths propagate the ledger reversal: each delete
 * re-runs the charge plugins, which reconcile the employer's ledger entries
 * back to "no hours / no benefit" (the entries are removed). Worker records
 * themselves are kept.
 *
 * NOTE: deletion is intentionally NOT wrapped in one giant transaction.
 * Each row delete (and its charge-plugin reconciliation) is self-consistent,
 * and a failure partway through leaves the system in a valid state — the
 * admin simply retries the cancellation and the remaining rows are removed.
 */

const CANCELLABLE_WIZARD_TYPES = new Set([
  "gbhet_legal_workers_monthly",
  "gbhet_legal_workers_corrections",
]);

const COMPLETED_STATUSES = new Set(["complete", "completed"]);

export interface CancellationPreview {
  canCancel: boolean;
  reason?: string;
  employerId?: string;
  employerName?: string;
  year?: number;
  month?: number;
  hoursRowCount: number;
  wmbRowCount: number;
  ledgerEntryCount: number;
  chargeTotal: string;
}

interface CancellationTarget {
  wizard: Wizard;
  employerId: string;
  year: number;
  month: number;
}

async function resolveTarget(
  wizardId: string,
): Promise<{ target?: CancellationTarget; error?: { status: number; message: string } }> {
  const wizard = await storage.wizards.getById(wizardId);
  if (!wizard) {
    return { error: { status: 404, message: "Wizard not found" } };
  }
  if (!CANCELLABLE_WIZARD_TYPES.has(wizard.type)) {
    return { error: { status: 400, message: "This wizard type cannot be cancelled" } };
  }
  if (wizard.status === "cancelled") {
    return { error: { status: 400, message: "This wizard run has already been cancelled" } };
  }
  if (!COMPLETED_STATUSES.has(wizard.status)) {
    return { error: { status: 400, message: "Only completed wizard runs can be cancelled" } };
  }
  const monthly = await storage.wizardEmployerMonthly.getByWizardId(wizardId);
  if (!monthly) {
    return { error: { status: 400, message: "This wizard run has no employer/period record to cancel against" } };
  }
  return {
    target: {
      wizard,
      employerId: monthly.employerId,
      year: monthly.year,
      month: monthly.month,
    },
  };
}

function sumAmounts(amounts: Array<string | null>): string {
  // Ledger amounts are numeric strings; sum in cents to avoid float drift.
  let cents = 0n;
  for (const a of amounts) {
    if (!a) continue;
    const n = Math.round(parseFloat(a) * 100);
    if (Number.isFinite(n)) cents += BigInt(n);
  }
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  const whole = abs / 100n;
  const frac = (abs % 100n).toString().padStart(2, "0");
  return `${negative ? "-" : ""}${whole}.${frac}`;
}

async function collectImpact(target: CancellationTarget) {
  const { employerId, year, month } = target;
  const [hoursRows, wmbRows] = await Promise.all([
    storage.workerHours.listByEmployerPeriod(employerId, year, month),
    storage.trust.wmb.listByEmployerPeriod(employerId, year, month),
  ]);
  const referenceIds = [
    ...hoursRows.map((r) => r.id),
    ...wmbRows.map((r) => r.id),
  ];
  const ledgerEntries = await storage.ledger.entries.getByReferenceIds(referenceIds);
  return { hoursRows, wmbRows, ledgerEntries };
}

export async function previewCancellation(
  wizardId: string,
): Promise<{ preview?: CancellationPreview; error?: { status: number; message: string } }> {
  const { target, error } = await resolveTarget(wizardId);
  if (error || !target) return { error };

  const { hoursRows, wmbRows, ledgerEntries } = await collectImpact(target);
  const employer = await storage.employers.getEmployer(target.employerId);

  return {
    preview: {
      canCancel: true,
      employerId: target.employerId,
      employerName: employer?.name,
      year: target.year,
      month: target.month,
      hoursRowCount: hoursRows.length,
      wmbRowCount: wmbRows.length,
      ledgerEntryCount: ledgerEntries.length,
      chargeTotal: sumAmounts(ledgerEntries.map((e) => e.amount)),
    },
  };
}

export interface CancellationResult {
  hoursDeleted: number;
  wmbDeleted: number;
  ledgerEntriesReversed: number;
  leftoverLedgerEntries: number;
}

export async function executeCancellation(
  wizardId: string,
  cancelledByUserId: string | undefined,
): Promise<{ result?: CancellationResult; error?: { status: number; message: string } }> {
  const { target, error } = await resolveTarget(wizardId);
  if (error || !target) return { error };

  const { hoursRows, wmbRows, ledgerEntries } = await collectImpact(target);
  const referenceIds = [
    ...hoursRows.map((r) => r.id),
    ...wmbRows.map((r) => r.id),
  ];

  // Delete WMB rows first (their ledger reversal is awaited in-line), then
  // hours rows (each delete runs the hourly charge plugins, which reconcile
  // the corresponding ledger entries away).
  let wmbDeleted = 0;
  for (const row of wmbRows) {
    if (await storage.trust.wmb.deleteWorkerBenefit(row.id)) wmbDeleted++;
  }

  let hoursDeleted = 0;
  for (const row of hoursRows) {
    const res = await storage.workerHours.deleteWorkerHours(row.id);
    if (res.success) hoursDeleted++;
  }

  // Verify the charge reversal actually landed: any ledger entry still
  // referencing a deleted row is surfaced so the admin can follow up.
  const leftover = await storage.ledger.entries.getByReferenceIds(referenceIds);

  const existingData = (target.wizard.data || {}) as Record<string, unknown>;
  await storage.wizards.update(wizardId, {
    status: "cancelled",
    data: {
      ...existingData,
      cancellation: {
        cancelledAt: new Date().toISOString(),
        cancelledBy: cancelledByUserId ?? null,
        employerId: target.employerId,
        year: target.year,
        month: target.month,
        hoursDeleted,
        wmbDeleted,
        ledgerEntriesReversed: ledgerEntries.length - leftover.length,
        chargeTotalReversed: sumAmounts(ledgerEntries.map((e) => e.amount)),
      },
    } as any,
  });

  return {
    result: {
      hoursDeleted,
      wmbDeleted,
      ledgerEntriesReversed: ledgerEntries.length - leftover.length,
      leftoverLedgerEntries: leftover.length,
    },
  };
}
