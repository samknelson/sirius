import { registerWizardPlugin } from "../registry";
import type { WizardPlugin } from "../types";
import {
  buildGenericInputsStep,
  buildReportRunStep,
  buildReportResultsStep,
  type ReportLike,
} from "./report-steps";
import { listDcUploadReviewFindings } from "../../../services/sitespecific/bao/dc-reporting";

const KIND_LABELS: Record<string, string> = {
  retired_disability_row: "Retired Disability status row",
  fmla_gap: "Unreported gap after FMLA",
  reconciliation_actionable: "Reconciliation actionable",
};

/**
 * Upload review export: retired-Disability employer rows, unreported gaps
 * between FMLA months, and actionable grant-reconciliation conditions —
 * the same live findings the dashboard shows.
 */
const report: ReportLike = {
  getColumns: () => [
    { id: "finding", header: "Finding", type: "string", width: 200 },
    { id: "workerName", header: "Worker", type: "string", width: 200 },
    { id: "workerSiriusId", header: "Sirius ID", type: "number", width: 100 },
    { id: "monthYmd", header: "Month", type: "string", width: 120 },
    { id: "employerName", header: "Employer", type: "string", width: 180 },
    { id: "detail", header: "Detail", type: "string", width: 400 },
  ],
  getPrimaryKeyField: () => "id",
  fetchRecords: async () => {
    const findings = await listDcUploadReviewFindings();
    return findings.map((f, i) => ({
      id: `${f.kind}:${f.worker.workerId}:${f.monthYmd}:${i}`,
      finding: KIND_LABELS[f.kind] ?? f.kind,
      workerName: f.worker.name,
      workerSiriusId: f.worker.siriusId,
      monthYmd: f.monthYmd,
      employerName: f.employerName ?? "",
      detail: f.detail,
    }));
  },
};

export const reportBaoDcUploadReviewPlugin: WizardPlugin = {
  id: "report_bao_dc_upload_review",
  name: "DC Upload Review",
  description:
    "Disability Credit upload anomalies: retired Disability status rows, unreported gaps between FMLA months, and actionable reconciliation conditions",
  requiredPolicy: "staff",
  requiredComponent: "sitespecific.bao",
  category: "Disability Credit",
  isReport: true,
  needsReadOnlyDb: true,
  steps: [
    buildGenericInputsStep(
      "Scans live hours, case, and grant data for upload anomalies needing staff review. Continue to run it.",
    ),
    buildReportRunStep(report, () => ({})),
    buildReportResultsStep(),
  ],
};

registerWizardPlugin(reportBaoDcUploadReviewPlugin);
