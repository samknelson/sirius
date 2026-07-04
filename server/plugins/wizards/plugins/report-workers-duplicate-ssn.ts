import { registerWizardPlugin } from "../registry";
import type { WizardPlugin } from "../types";
import { ReportWorkersDuplicateSSN } from "../../../wizards/types/report_workers_duplicate_ssn";
import {
  buildGenericInputsStep,
  buildReportRunStep,
  buildReportResultsStep,
} from "./report-steps";

const report = new ReportWorkersDuplicateSSN();

export const reportWorkersDuplicateSsnPlugin: WizardPlugin = {
  id: "report_workers_duplicate_ssn",
  name: "Workers with Duplicate SSN",
  description:
    "Generate a report of Social Security Numbers shared by more than one worker",
  requiredPolicy: "admin",
  category: "Workers",
  isReport: true,
  steps: [
    buildGenericInputsStep(
      "This report analyzes all workers in the system. Continue to run it.",
    ),
    buildReportRunStep(report, () => ({})),
    buildReportResultsStep(),
  ],
};

registerWizardPlugin(reportWorkersDuplicateSsnPlugin);
