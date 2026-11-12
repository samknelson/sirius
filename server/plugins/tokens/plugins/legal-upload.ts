import { registerTokenPlugin } from "../registry";
import { tokenEntityOf } from "../types";
import { legalInvoiceLinks, legalUploadTokenRow } from "../../event-notifier/legal-upload-message";
import type { LegalUploadCompletedPayload } from "../../../services/event-bus";

const fields = ["id", "employer_id", "period", "outcome", "summary", "invoice_urls",
  "results_path", "results_url", "new_workers", "new_grants", "workers_with_new_grants",
  "posted_amount", "posted_charges"];

registerTokenPlugin({
  metadata: {
    id: "token.wizards.legal-completion", name: "Legal upload",
    description: "A Legal upload's committed completion snapshot (no uploaded rows)",
    segmentName: "__wizards", inputTypes: [], outputType: "wizards",
    entityFields: fields, defaultLeaf: "summary", hiddenFromPicker: true,
    requiredComponent: "sitespecific.gbhet.legal",
    sampleSets: [
      { id: "legal-success", label: "Legal upload completed", values: {
        summary: "Processing is complete for the Legal upload for 1/2026. 2 new workers, 3 workers received 4 new grants. Posted charges: $80.00 (4 entries).",
        period: "1/2026", outcome: "completed", new_workers: "2", new_grants: "4",
        workers_with_new_grants: "3", posted_amount: "80.00", posted_charges: "4",
        results_path: "/wizards/example", results_url: "https://example.com/wizards/example",
        invoice_urls: "Account example, 1/2026: https://example.com/ea/example/invoices/1/2026",
      } },
      { id: "legal-errors", label: "Legal upload with errors", values: {
        summary: "Processing completed with errors. Some charge work failed; review the results. No invoice is available from this upload's charges.",
        outcome: "completed_with_errors", posted_amount: "0.00", invoice_urls: "No invoice is available.",
        results_path: "/wizards/example", results_url: "https://example.com/wizards/example",
      } },
    ],
    previewEntity: {
      gate: { scope: "route", policy: "admin" },
      async load(storage, id) {
        const wizard = await storage.wizards.getById(id);
        if (!wizard || !["gbhet_legal_workers_monthly", "gbhet_legal_workers_corrections"].includes(wizard.type)) return null;
        const data = (wizard.data ?? {}) as any;
        if (!data.legalCompletion || !wizard.entityId) return null;
        const payload: LegalUploadCompletedPayload = {
          uploadId: wizard.id, uploadType: wizard.type, employerId: wizard.entityId,
          submitter: data.legalSubmitter ?? null, period: data.launchArguments,
          outcome: wizard.status === "failed" ? "failed" : wizard.status === "completed_with_errors" ? "completed_with_errors" : "completed",
          ...data.legalCompletion, resultsPath: `/wizards/${wizard.id}`,
        };
        return { entity: { kind: "wizards", row: legalUploadTokenRow(payload) }, label: `Legal upload ${payload.period.month}/${payload.period.year}` };
      },
    },
  },
  async resolve() { return null; },
});

registerTokenPlugin({
  metadata: {
    id: "token.wizards.invoice-links", name: "Available Legal invoices",
    description: "Authenticated links to every available account/month invoice for this upload's posted charges",
    segmentName: "invoice_links", inputTypes: ["wizards"], outputType: "value",
    emitsHtml: true, requiredComponent: "sitespecific.gbhet.legal",
    example: '<p>Available invoices for posted charges:</p><a href="https://example.com/ea/example/invoices/1/2026">Account example, 1/2026</a>',
  },
  async resolve(entity) {
    const payload = tokenEntityOf(entity, "wizards")?.row.completionSnapshot as LegalUploadCompletedPayload | undefined;
    return payload ? legalInvoiceLinks(payload, true) : null;
  },
});
