import { registerWizardPlugin } from "../registry";
import type { WizardPlugin, WizardStepContext } from "../types";
import { ReportLedgerIntegrity } from "../../../wizards/types/report_ledger_integrity";
import { buildReportRunStep, buildReportResultsStep } from "./report-steps";

const report = new ReportLedgerIntegrity();

export const reportLedgerIntegrityPlugin: WizardPlugin = {
  id: "report_ledger_integrity",
  name: "Ledger Integrity",
  description:
    "Verify posted ledger entries against what each charge plugin expects, and flag mismatches",
  requiredPolicy: "admin",
  category: "Ledger",
  isReport: true,
  steps: [
    {
      id: "inputs",
      name: "Inputs",
      description:
        "Choose which charge plugins and date range to verify. Leave empty to check all.",
      // Custom UI (charge-plugin multiselect + date range). No `schema` so
      // StepBody renders the InputsForm escape hatch instead of SchemaForm.
      kind: "custom",
      component: "InputsForm",
      getState: () => "completed",
      submit: (ctx: WizardStepContext) => {
        const input = (ctx.input || {}) as {
          chargePlugins?: string[];
          dateFrom?: string;
          dateTo?: string;
        };
        return {
          data: {
            config: {
              chargePlugins: Array.isArray(input.chargePlugins)
                ? input.chargePlugins
                : [],
              dateFrom: input.dateFrom || undefined,
              dateTo: input.dateTo || undefined,
            },
          },
        };
      },
    },
    buildReportRunStep(report, (wizard) => {
      const config = ((wizard.data as any)?.config || {}) as {
        chargePlugins?: string[];
        dateFrom?: string;
        dateTo?: string;
      };
      return {
        chargePlugins: config.chargePlugins || [],
        dateFrom: config.dateFrom || undefined,
        dateTo: config.dateTo || undefined,
      };
    }),
    buildReportResultsStep(),
  ],
};

registerWizardPlugin(reportLedgerIntegrityPlugin);
