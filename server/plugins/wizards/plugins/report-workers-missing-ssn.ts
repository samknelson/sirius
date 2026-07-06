import { registerWizardPlugin } from "../registry";
import type { WizardPlugin } from "../types";
import { ReportWorkersMissingSSN } from "../engine/types/report_workers_missing_ssn";
import {
  buildGenericInputsStep,
  buildReportRunStep,
  buildReportResultsStep,
} from "./report-steps";

const report = new ReportWorkersMissingSSN();

export const reportWorkersMissingSsnPlugin: WizardPlugin = {
  id: "report_workers_missing_ssn",
  name: "Workers Missing SSN",
  description:
    "Generate a report of all workers with missing or empty Social Security Numbers",
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

registerWizardPlugin(reportWorkersMissingSsnPlugin);
