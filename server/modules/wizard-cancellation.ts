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
 * All-or-nothing strategy: deletion is intentionally NOT wrapped in one
 * giant transaction (charge-plugin executions and cache-invalidating events
 * fire inside the delete paths, and those must not run against a transaction
 * that later rolls back). Instead, each row delete (and its charge-plugin
 * reconciliation) is individually self-consistent, and the wizard is only
 * marked cancelled once EVERYTHING is verified gone — all hours rows, all
 * WMB rows, and zero remaining ledger entries referencing them. Any partial
 * failure returns an error and leaves the wizard un-cancelled so the admin
 * simply retries; retrying removes whatever remains (deletes are idempotent
 * on already-removed rows).
 */

const CANCELLABLE_WIZARD_TYPES = new Set([
  "gbhet_legal_workers_monthly",
  "gbhet_legal_workers_corrections",
]);

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

const COMPLETED_STATUSES = new Set(["complete", "completed"]);

export function isRunCancellable(wizard: { status: string; data: unknown }): boolean {
  if (COMPLETED_STATUSES.has(wizard.status)) return true;
  const data = (wizard.data || {}) as Record<string, any>;
  // Processing finished (possibly with row failures) — results were saved.
  if (data.processResults) return true;
  // Processing was started (process step reached) but never finished —
  // a mid-way failure may have already written hours/WMB/charges.
  if (data.progress?.process) return true;
  return false;
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
  // Only completed runs OR runs that failed mid-way through processing are
  // cancellable. A failed run stays in "draft" status, so we detect it via
  // the run's own data: either processing results were saved, or the
  // process step was reached (its progress entry exists). A pending run
  // that never started processing must NOT be cancellable — cancellation
  // wipes the employer/period globally and would destroy legitimate data
  // the run did not produce.
  if (!isRunCancellable(wizard)) {
    return {
      error: {
        status: 400,
        message: "Only completed runs, or runs that failed during processing, can be cancelled",
      },
    };
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
  // the corresponding ledger entries away). A `false`/unsuccessful result
  // means the row was already gone, which is fine for our purposes.
  let wmbDeleted = 0;
  for (const row of wmbRows) {
    if (await storage.trust.wmb.deleteWorkerBenefit(row.id)) wmbDeleted++;
  }

  let hoursDeleted = 0;
  for (const row of hoursRows) {
    const res = await storage.workerHours.deleteWorkerHours(row.id);
    if (res.success) hoursDeleted++;
  }

  // Verify everything is actually gone before finalizing. If any rows or
  // ledger entries remain (e.g. a charge plugin failed to reconcile), do
  // NOT mark the wizard cancelled — report the failure so the admin can
  // retry; the retry only has to remove what remains.
  const [remainingHours, remainingWmb, leftover] = await Promise.all([
    storage.workerHours.listByEmployerPeriod(target.employerId, target.year, target.month),
    storage.trust.wmb.listByEmployerPeriod(target.employerId, target.year, target.month),
    storage.ledger.entries.getByReferenceIds(referenceIds),
  ]);

  if (remainingHours.length > 0 || remainingWmb.length > 0 || leftover.length > 0) {
    return {
      error: {
        status: 409,
        message:
          `Cancellation did not complete: ${remainingHours.length} hours record(s), ` +
          `${remainingWmb.length} benefit record(s), and ${leftover.length} ledger charge(s) ` +
          `could not be removed. The wizard was NOT marked cancelled — please retry; ` +
          `already-removed data will not be affected again.`,
      },
    };
  }

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
