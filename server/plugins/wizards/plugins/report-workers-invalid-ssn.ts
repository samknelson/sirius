import { registerWizardPlugin } from "../registry";
import type { WizardPlugin } from "../types";
import { ReportWorkersInvalidSSN } from "../engine/types/report_workers_invalid_ssn";
import {
  buildGenericInputsStep,
  buildReportRunStep,
  buildReportResultsStep,
} from "./report-steps";

const report = new ReportWorkersInvalidSSN();

export const reportWorkersInvalidSsnPlugin: WizardPlugin = {
  id: "report_workers_invalid_ssn",
  name: "Workers with Invalid SSN",
  description:
    "Generate a report of all workers with invalid Social Security Numbers (fails SSA validation rules)",
  requiredPolicy: "admin",
  category: "Workers",
  isReport: true,
  needsReadOnlyDb: true,
  steps: [
    buildGenericInputsStep(
      "This report analyzes all workers in the system. Continue to run it.",
    ),
    buildReportRunStep(report, () => ({})),
    buildReportResultsStep(),
  ],
};

registerWizardPlugin(reportWorkersInvalidSsnPlugin);
