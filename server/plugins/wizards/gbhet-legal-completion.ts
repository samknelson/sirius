import type { Wizard } from "@shared/schema";
import { storage } from "../../storage";
import { eventBus, EventType } from "../../services/event-bus";
import { dateToYmd } from "@shared/utils/date";

export interface LegalInvoiceDestination {
  eaId: string;
  year: number;
  month: number;
  path: string;
}

export interface LegalActualTotals {
  newWorkers: number;
  workersWithNewGrants: number;
  newGrants: number;
  processedRows: number;
  failedRows: number;
  postedCharges: number;
  postedAmount: string | null;
  chargeFailures: number;
  chargeReadFailed: boolean;
  unpriceableGrants: number;
}

/** Snapshot contains only actual persisted work, not the uploaded rows.
 * Invoice existence uses the SAME account/month implementation as its route. */
export async function resolveLegalActuals(
  employerId: string, wmbIds: string[], totals: Omit<LegalActualTotals, "postedCharges" | "postedAmount" | "chargeReadFailed">,
) {
  const invoices: LegalInvoiceDestination[] = [];
  let postedCharges = 0, postedCents = 0, chargeReadFailed = false;
  try {
    const accounts = await storage.ledger.ea.getByEntity("employer", employerId);
    const owned = new Set(accounts.map(account => account.id));
    const groups = new Map<string, { eaId: string; year: number; month: number }>();
    for (const id of wmbIds) {
      for (const entry of await storage.ledger.entries.getByReference("wmb", id)) {
        if (!entry.eaId || !owned.has(entry.eaId)) continue;
        postedCharges++;
        postedCents += Math.round(Number(entry.amount) * 100);
        const ymd = entry.statementYmd || (entry.date ? dateToYmd(new Date(entry.date)) : null);
        if (!ymd) continue;
        const year = Number(ymd.slice(0, 4)), month = Number(ymd.slice(5, 7));
        groups.set(`${entry.eaId}:${year}:${month}`, { eaId: entry.eaId, year, month });
      }
    }
    for (const group of groups.values()) {
      const details = await storage.ledger.invoices.getDetails(group.eaId, group.month, group.year);
      if (details) invoices.push({ ...group, path: `/ea/${group.eaId}/invoices/${group.month}/${group.year}` });
    }
  } catch {
    chargeReadFailed = true;
  }
  return {
    totals: { ...totals, postedCharges, postedAmount: chargeReadFailed ? null : (postedCents / 100).toFixed(2), chargeReadFailed },
    invoices: chargeReadFailed ? [] : invoices,
  };
}

/** Called only by the dispatcher's after-commit terminal hook, never on reads
 * or historical uploads. Delivery remains best-effort; comm keys own dedup. */
export async function publishLegalCompletion(wizard: Wizard, runOutcome: "completed" | "failed") {
  const data = (wizard.data ?? {}) as Record<string, any>;
  if (!wizard.entityId || !data.legalCompletion) return;
  const outcome = runOutcome === "failed" ? "failed"
    : wizard.status === "completed_with_errors" ? "completed_with_errors" : "completed";
  await eventBus.emit(EventType.GBHET_LEGAL_UPLOAD_COMPLETED_AFTER, {
    uploadId: wizard.id, uploadType: wizard.type,
    employerId: wizard.entityId,
    submitter: data.legalSubmitter ?? null,
    period: { year: Number(data.launchArguments.year), month: Number(data.launchArguments.month) },
    outcome, totals: data.legalCompletion.totals, invoices: data.legalCompletion.invoices,
    resultsPath: `/wizards/${wizard.id}`,
  });
}
