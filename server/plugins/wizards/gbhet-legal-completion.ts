import type { Wizard } from "@shared/schema";
import { storage } from "../../storage";
import { eventBus, EventType } from "../../services/event-bus";
import { dateToYmd } from "@shared/utils/date";
import { ledgerMinor, ledgerDecimal, type LegalChargeGroup } from "@shared/legal-payment";

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
  postedCharges: number | null;
  postedAmount: string | null;
  postedCurrency?: string | null;
  chargeFailures: number;
  chargeReadFailed: boolean;
  unpriceableGrants: number | null;
}

/** Snapshot contains only actual persisted work, not the uploaded rows.
 * Invoice existence uses the SAME account/month implementation as its route. */
export async function resolveLegalActuals(
  employerId: string, wmbIds: string[], totals: Omit<LegalActualTotals, "postedCharges" | "postedAmount" | "chargeReadFailed">,
  priorCharges: Map<string, string> | null = new Map(),
) {
  const invoices: LegalInvoiceDestination[] = [];
  const chargeGroups = new Map<string, LegalChargeGroup>();
  let postedCharges = 0, chargeReadFailed = priorCharges === null;
  try {
    const accounts = await storage.ledger.ea.getByEntity("employer", employerId);
    const owned = new Set(accounts.map(account => account.id));
    const accountDetails = new Map(await Promise.all(accounts.map(async ea => {
      const account = await storage.ledger.accounts.get(ea.accountId);
      if (!account) throw new Error("The charged account is unavailable.");
      return [ea.id, account] as const;
    })));
    const groups = new Map<string, { eaId: string; year: number; month: number }>();
    const seenEntries = new Set<string>();
    for (const id of new Set(wmbIds)) {
      for (const entry of await storage.ledger.entries.getByReference("wmb", id)) {
        if (!entry.eaId || !owned.has(entry.eaId) || seenEntries.has(entry.id)) continue;
        seenEntries.add(entry.id);
        const account = accountDetails.get(entry.eaId)!;
        const amount = ledgerMinor(entry.amount) - ledgerMinor(priorCharges?.get(entry.id) ?? "0");
        const group = chargeGroups.get(entry.eaId) ?? {
          eaId: entry.eaId, accountId: account.id, accountName: account.name,
          currency: account.currencyCode, amount: "0.00", entries: 0, invoicePaths: [],
        };
        group.amount = ledgerDecimal(ledgerMinor(group.amount) + amount);
        group.entries++;
        chargeGroups.set(entry.eaId, group);
        postedCharges++;
        const ymd = entry.statementYmd || (entry.date ? dateToYmd(new Date(entry.date)) : null);
        if (!ymd) continue;
        const year = Number(ymd.slice(0, 4)), month = Number(ymd.slice(5, 7));
        groups.set(`${entry.eaId}:${year}:${month}`, { eaId: entry.eaId, year, month });
      }
    }
    for (const group of groups.values()) {
      const details = await storage.ledger.invoices.getDetails(group.eaId, group.month, group.year);
      if (details) {
        const path = `/ea/${group.eaId}/invoices/${group.month}/${group.year}`;
        invoices.push({ ...group, path });
        chargeGroups.get(group.eaId)?.invoicePaths.push(path);
      }
    }
  } catch {
    chargeReadFailed = true;
  }
  return {
    totals: { ...totals, postedCharges: chargeReadFailed ? null : postedCharges,
      postedCurrency: chargeReadFailed || new Set([...chargeGroups.values()].map(g => g.currency)).size !== 1
        ? null : [...chargeGroups.values()][0].currency,
      postedAmount: chargeReadFailed || new Set([...chargeGroups.values()].map(g => g.currency)).size > 1
        ? null : ledgerDecimal([...chargeGroups.values()].reduce((sum, group) => sum + ledgerMinor(group.amount), 0n)),
      chargeReadFailed },
    invoices: chargeReadFailed ? [] : invoices,
    chargeGroups: chargeReadFailed ? null : [...chargeGroups.values()],
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
