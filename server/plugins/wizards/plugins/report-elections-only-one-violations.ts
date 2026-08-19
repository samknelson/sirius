import { registerWizardPlugin } from "../registry";
import type { WizardPlugin } from "../types";
import { ReportElectionsOnlyOneViolations } from "../engine/types/report_elections_only_one_violations";
import {
  buildGenericInputsStep,
  buildReportRunStep,
  buildReportResultsStep,
} from "./report-steps";

const report = new ReportElectionsOnlyOneViolations();

/**
 * Trust-category anomaly report: elections that contain more than one
 * benefit from a benefit type currently marked "Only one of this type".
 * Admin-only and gated on the `trust.benefits` component — when that
 * component is disabled the report is hidden from the catalogue and every
 * dispatcher action is rejected by the shared plugin gating.
 */
export const reportElectionsOnlyOneViolationsPlugin: WizardPlugin = {
  id: "report_elections_only_one_violations",
  name: "Only-One Election Violations",
  description:
    'Find elections containing more than one benefit from a benefit type marked "Only one of this type"',
  requiredComponent: "trust.benefits",
  requiredPolicy: "admin",
  category: "Trust",
  isReport: true,
  steps: [
    buildGenericInputsStep(
      "This report checks every election (current, ended, and future-dated) against the current \"Only one of this type\" benefit type settings. Continue to run it.",
    ),
    buildReportRunStep(report, () => ({})),
    buildReportResultsStep(),
  ],
};

registerWizardPlugin(reportElectionsOnlyOneViolationsPlugin);
