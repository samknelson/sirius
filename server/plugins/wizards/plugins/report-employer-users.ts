import { registerWizardPlugin } from "../registry";
import type { WizardPlugin } from "../types";
import { ReportEmployerUsers } from "../engine/types/report_employer_users";
import {
  buildGenericInputsStep,
  buildReportRunStep,
  buildReportResultsStep,
} from "./report-steps";

const report = new ReportEmployerUsers();

export const reportEmployerUsersPlugin: WizardPlugin = {
  id: "report_employer_users",
  name: "Employer Users",
  description:
    "Generate a report of employer contacts and their portal user access",
  requiredPolicy: "admin",
  category: "Employers",
  isReport: true,
  needsReadOnlyDb: true,
  steps: [
    buildGenericInputsStep(
      "This report analyzes all employer contacts in the system. Continue to run it.",
    ),
    buildReportRunStep(report, () => ({})),
    buildReportResultsStep(),
  ],
};

registerWizardPlugin(reportEmployerUsersPlugin);
