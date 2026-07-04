import { registerWizardPlugin } from "../registry";
import type { WizardPlugin, WizardStepContext } from "../types";
import { ReportBTUWorkersInvalidCardcheck } from "../engine/types/report_btu_workers_invalid_cardcheck";
import { buildReportRunStep, buildReportResultsStep } from "./report-steps";

const report = new ReportBTUWorkersInvalidCardcheck();

export const reportBtuWorkersInvalidCardcheckPlugin: WizardPlugin = {
  id: "report_btu_workers_invalid_cardcheck",
  name: "BTU Workers with Invalid Cardcheck",
  description:
    "List workers whose cardcheck answers no longer satisfy the selected cardcheck definition",
  requiredPolicy: "admin",
  requiredComponent: "sitespecific.btu",
  category: "Workers",
  isReport: true,
  steps: [
    {
      id: "inputs",
      name: "Inputs",
      description:
        "Pick a cardcheck definition (and optionally an employer) to check workers against.",
      // Custom UI (cardcheck-definition + employer pickers). No `schema` so
      // StepBody renders the InputsForm escape hatch instead of SchemaForm.
      kind: "custom",
      component: "InputsForm",
      getState: (wizard) => {
        const config = (wizard.data as any)?.config || {};
        return config.filters?.cardcheckDefinitionId ? "completed" : "pending";
      },
      submit: (ctx: WizardStepContext) => {
        const input = (ctx.input || {}) as {
          filters?: { cardcheckDefinitionId?: string; employerId?: string };
        };
        return {
          data: {
            config: {
              filters: {
                cardcheckDefinitionId:
                  input.filters?.cardcheckDefinitionId || undefined,
                employerId: input.filters?.employerId || undefined,
              },
            },
          },
        };
      },
    },
    buildReportRunStep(report, (wizard) => {
      const config = ((wizard.data as any)?.config || {}) as {
        filters?: { cardcheckDefinitionId?: string; employerId?: string };
      };
      return {
        filters: {
          cardcheckDefinitionId: config.filters?.cardcheckDefinitionId,
          employerId: config.filters?.employerId,
        },
      };
    }),
    buildReportResultsStep(),
  ],
};

registerWizardPlugin(reportBtuWorkersInvalidCardcheckPlugin);
