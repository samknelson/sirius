import { registerWizardPlugin } from "../registry";
import type { WizardPlugin } from "../types";
import {
  buildGenericInputsStep,
  buildReportRunStep,
  buildReportResultsStep,
  type ReportLike,
} from "./report-steps";
import { getDcNetGrantActivity } from "../../../services/sitespecific/bao/dc-reporting";

/**
 * Trustee export: net Disability Credit months per WORK month for at least a
 * trailing year, derived live from the append-only grant event log and
 * reconciled exactly against the currently-granted month rows
 * (grants − removals = currently granted; same-period grant/removal pairs
 * net to zero).
 */
const report: ReportLike = {
  getColumns: () => [
    { id: "workMonthYmd", header: "Work month", type: "string", width: 130 },
    { id: "grants", header: "Grants", type: "number", width: 100 },
    { id: "removals", header: "Removals", type: "number", width: 100 },
    { id: "net", header: "Net", type: "number", width: 100 },
    { id: "currentlyGranted", header: "Currently granted", type: "number", width: 150 },
    { id: "reconciled", header: "Reconciles", type: "string", width: 110 },
  ],
  getPrimaryKeyField: () => "workMonthYmd",
  fetchRecords: async () => {
    const rows = await getDcNetGrantActivity();
    return rows.map((r) => ({
      workMonthYmd: r.workMonthYmd,
      grants: r.grants,
      removals: r.removals,
      net: r.net,
      currentlyGranted: r.currentlyGranted,
      reconciled: r.reconciled ? "Yes" : "NO — investigate",
    }));
  },
};

export const reportBaoDcNetGrantsPlugin: WizardPlugin = {
  id: "report_bao_dc_net_grants",
  name: "DC Net Grant Activity",
  description:
    "Net Disability Credit months by work month (trailing year): grants minus removals from the event log, reconciled against currently-granted months",
  requiredPolicy: "staff",
  requiredComponent: "sitespecific.bao",
  category: "Disability Credit",
  isReport: true,
  needsReadOnlyDb: true,
  steps: [
    buildGenericInputsStep(
      "Reports net DC grant activity per work month for the trailing year, derived live from grant events. Continue to run it.",
    ),
    buildReportRunStep(report, () => ({})),
    buildReportResultsStep(),
  ],
};

registerWizardPlugin(reportBaoDcNetGrantsPlugin);
