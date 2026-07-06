import { registerWizardPlugin } from "../registry";
import type { WizardPlugin, WizardStepContext } from "../types";
import type { Wizard } from "@shared/schema";
import { ReportGbhetLegalCompliance } from "../engine/types/report_gbhet_legal_compliance";

/**
 * Pilot: the GBHET Legal Compliance report ported to run "in a box" on
 * the wizard plugin framework. It reuses the existing report logic
 * (`ReportGbhetLegalCompliance`) — which already reads exclusively
 * through `storage.*` — for column definitions, primary key, and record
 * fetching. All persistence is owned by the dispatcher; the run handler
 * only writes bulk rows through the storage layer.
 *
 * The three steps demonstrate BOTH client UX mechanisms:
 *   - `inputs`  → a `form` step whose server JSON schema is rendered by
 *                 the shared SchemaForm (zero client files).
 *   - `run`     → a `run` step with an auto-discovered React component.
 *   - `results` → a `results` step with an auto-discovered React
 *                 component + columns-driven table and CSV export.
 */

const report = new ReportGbhetLegalCompliance();

/** Read the persisted work-month config off the wizard row. */
function readConfig(wizard: Wizard): {
  workMonthFrom?: string;
  workMonthTo?: string;
} {
  const data = (wizard.data as any) || {};
  const config = data.config || {};
  return {
    workMonthFrom: config.workMonthFrom || undefined,
    workMonthTo: config.workMonthTo || undefined,
  };
}

export const reportGbhetLegalCompliancePlugin: WizardPlugin = {
  id: "report_gbhet_legal_compliance",
  name: "GBHET Legal Compliance Check",
  description:
    "Identifies workers with 80+ hours in a work month who are missing the legal benefit after the 3-month lag (e.g., January work → April benefit)",
  requiredComponent: "sitespecific.gbhet.legal",
  requiredPolicy: "admin",
  category: "Compliance",
  isReport: true,
  needsReadOnlyDb: true,
  steps: [
    {
      id: "inputs",
      name: "Inputs",
      description: "Configure report parameters and filters",
      kind: "form",
      // Rendered by the shared SchemaForm — no bespoke client component.
      schema: {
        type: "object",
        properties: {
          workMonthFrom: {
            type: "string",
            title: "From Work Month",
            description:
              "Earliest work month to include, formatted YYYY-MM. Leave blank for all months.",
          },
          workMonthTo: {
            type: "string",
            title: "To Work Month",
            description:
              "Latest work month to include, formatted YYYY-MM. Leave blank for all months.",
          },
        },
      },
      uiSchema: {
        workMonthFrom: { "ui:placeholder": "2025-01" },
        workMonthTo: { "ui:placeholder": "2025-12" },
      },
      // Filters are optional, so this step is always satisfiable.
      getState: () => "completed",
      submit: (ctx: WizardStepContext) => {
        const { workMonthFrom, workMonthTo } = ctx.input as {
          workMonthFrom?: string;
          workMonthTo?: string;
        };
        return {
          data: {
            config: {
              workMonthFrom: workMonthFrom || undefined,
              workMonthTo: workMonthTo || undefined,
            },
          },
        };
      },
    },
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
        const config = readConfig(ctx.wizard);
        const columns = report.getColumns();
        const pkField = report.getPrimaryKeyField();

        const records = await report.fetchRecords(config, 100, (p) => {
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

registerWizardPlugin(reportGbhetLegalCompliancePlugin);
