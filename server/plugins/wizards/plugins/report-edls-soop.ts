import { registerWizardPlugin } from "../registry";
import type { WizardPlugin, WizardStepContext } from "../types";
import { ReportEdlsSoop } from "../engine/types/report_edls_soop";

/**
 * EDLS Scheduled Out of Population report as a wizard plugin. No input
 * form step — the report takes no parameters, so the flow is just
 * run → results. All data access goes through the storage layer
 * (`storage.edlsAssignments.getFutureOutOfPopulationAssignments`), so
 * this plugin does not need direct read-only DB access.
 */

const report = new ReportEdlsSoop();

export const reportEdlsSoopPlugin: WizardPlugin = {
  id: "report_edls_soop",
  name: "EDLS Scheduled Out of Population",
  description:
    "Lists future (today and later) sheet assignments whose worker is no longer in the EDLS scheduling population",
  requiredComponent: "edls",
  requiredPolicy: "admin",
  category: "EDLS",
  isReport: true,
  steps: [
    {
      id: "run",
      name: "Run",
      description: "Execute the report and generate results",
      kind: "run",
      component: "RunView",
      getState: (wizard) => {
        const data = (wizard.data as any) || {};
        const status = data.progress?.run?.status;
        if (status === "completed") return "completed";
        if (status === "failed") return "failed";
        if (status === "in_progress") return "in_progress";
        return "pending";
      },
      run: async (ctx: WizardStepContext) => {
        const columns = report.getColumns();
        const pkField = report.getPrimaryKeyField();

        const records = await report.fetchRecords({}, 100, (p) => {
          const pct =
            p.total > 0
              ? Math.min(99, Math.round((p.processed / p.total) * 100))
              : 0;
          void ctx.reportProgress(pct);
        });

        // Bulk rows go to wizard_report_data via storage — never wizard.data.
        await ctx.storage.wizards.deleteReportData(ctx.wizardId);
        for (const record of records) {
          const pk = String(record[pkField]);
          await ctx.storage.wizards.saveReportData(ctx.wizardId, pk, record);
        }

        return {
          status: "completed",
          data: {
            reportMeta: {
              generatedAt: new Date().toISOString(),
              recordCount: records.length,
              columns,
              primaryKeyField: pkField,
            },
            recordCount: records.length,
          },
        };
      },
    },
    {
      id: "results",
      name: "Results",
      description: "View and download report results",
      kind: "results",
      component: "ResultsTable",
      getState: (wizard) => {
        const data = (wizard.data as any) || {};
        return data.reportMeta ? "completed" : "pending";
      },
    },
  ],
};

registerWizardPlugin(reportEdlsSoopPlugin);
