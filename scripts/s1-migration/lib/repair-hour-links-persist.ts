/**
 * Persistence mapping for repair-hour-links.ts duplicate corrections
 * (Task 414). Split out so the mapping is unit-testable without executing
 * the repair script: a historical correction MUST carry the plugin's
 * transactionDate (the affected work month) as the ledger `date` and the
 * plugin's statementYmd — never the repair's execution date — or the
 * correction is misdated in date-based ledger history and reporting.
 */
import type { LedgerTransaction } from "../../../server/plugins/ledger/charge/types";
import type { InsertLedger } from "../../../shared/schema";

export function toRepairLedgerInsert(
  t: LedgerTransaction,
  eaId: string,
): InsertLedger {
  if (!t.statementYmd) {
    throw new Error(
      `repair-hour-links: plugin transaction ${t.chargePluginKey} has no statementYmd — refusing to persist a correction without its work-month statement`,
    );
  }
  return {
    chargePlugin: t.chargePlugin,
    chargePluginKey: t.chargePluginKey,
    chargePluginConfigId: t.chargePluginConfigId,
    amount: t.amount,
    eaId,
    referenceType: t.referenceType || "charge_plugin",
    referenceId: t.referenceId,
    date: t.transactionDate,
    statementYmd: t.statementYmd,
    memo: t.description,
    data: { ...(t.metadata ?? {}), repairSource: "repair-hour-links" },
  };
}
