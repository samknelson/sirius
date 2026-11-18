import type { LegalUploadCompletedPayload } from "../../services/event-bus";
import { getEnvironmentVariable } from "../../config/env-registry";
import { escapeHtml } from "@shared/utils/html/escape";

export const legalCompletionSendKey = (uploadId: string) => `gbhet-legal-upload-completion:${uploadId}`;

export function legalUploadSummary(payload: LegalUploadCompletedPayload): string {
  const { totals, period } = payload;
  const status = payload.outcome === "failed" ? "Processing failed"
    : payload.outcome === "completed_with_errors" ? "Processing completed with errors" : "Processing is complete";
  const money = totals.postedAmount === null ? "Charge totals could not be confirmed."
    : `Posted charges: ${new Intl.NumberFormat("en-US", { style: "currency", currency: totals.postedCurrency ?? "USD" }).format(Number(totals.postedAmount))} (${totals.postedCharges} entries).`;
  const billing = totals.chargeFailures ? " Some charge work failed; review the results." : "";
  const unpriced = totals.unpriceableGrants ? ` Pricing was unavailable for ${totals.unpriceableGrants} prospective grants; no charge is assumed for them.` : "";
  const noInvoice = payload.invoices.length ? "" : " No invoice is available from this upload's charges.";
  return `${status} for the Legal upload for ${period.month}/${period.year}. ` +
    `${totals.newWorkers} new workers, ${totals.workersWithNewGrants} workers received ${totals.newGrants} new grants; ` +
    `${totals.failedRows} row failures. ${money}${billing}${unpriced}${noInvoice} Review the upload results for details.`;
}

function absolute(path: string) {
  const base = getEnvironmentVariable("PUBLIC_URL");
  if (!base) throw new Error("PUBLIC_URL is required for Legal completion links");
  return `${base.replace(/\/$/, "")}${path}`;
}

export function legalInvoiceLinks(payload: LegalUploadCompletedPayload, html: boolean) {
  if (!payload.invoices.length) return html ? "<p>No invoice is available from this upload's charges.</p>" : "No invoice is available from this upload's charges.";
  const links = payload.invoices.map(invoice => {
    const label = `Account ${invoice.eaId}, ${invoice.month}/${invoice.year}`;
    const url = absolute(invoice.path);
    return html ? `<li><a href="${escapeHtml(url)}">${escapeHtml(label)}</a></li>` : `${label}: ${url}`;
  });
  return html ? `<p>Available invoices for posted charges:</p><ul>${links.join("")}</ul>` : `Available invoices for posted charges:\n${links.join("\n")}`;
}

/** Only documented completion values are exposed to templates, never wizard.data. */
export function legalUploadTokenRow(payload: LegalUploadCompletedPayload) {
  return {
    id: payload.uploadId, employer_id: payload.employerId,
    period: `${payload.period.month}/${payload.period.year}`, outcome: payload.outcome,
    summary: legalUploadSummary(payload), invoice_urls: legalInvoiceLinks(payload, false),
    results_path: payload.resultsPath, results_url: absolute(payload.resultsPath),
    new_workers: payload.totals.newWorkers, new_grants: payload.totals.newGrants,
    workers_with_new_grants: payload.totals.workersWithNewGrants,
    posted_amount: payload.totals.postedAmount, posted_charges: payload.totals.postedCharges,
    // Private backing data for the safe invoice-links leaf, not a field.
    completionSnapshot: payload,
  };
}
