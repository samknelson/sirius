import { registerWizardPlugin } from "../registry";
import type { WizardPlugin, WizardStepContext } from "../types";
import type { Wizard } from "@shared/schema";
import { ReportEdlsScheduledTooSoon } from "../engine/types/report_edls_scheduled_too_soon";

/**
 * EDLS Scheduled Too Soon report as a wizard plugin: a three-step
 * settings → run → results flow modeled on the GBHET compliance pilot.
 * The read query lives in the engine class and uses the read-only DB
 * escape hatch, so this plugin declares `needsReadOnlyDb: true`.
 */

const report = new ReportEdlsScheduledTooSoon();

/** Read the persisted settings off the wizard row. */
function readConfig(wizard: Wizard): {
  minHours?: number;
  startDate?: string;
  endDate?: string;
} {
  const data = (wizard.data as any) || {};
  const config = data.config || {};
  return {
    minHours:
      typeof config.minHours === "number" ? config.minHours : undefined,
    startDate: config.startDate || undefined,
    endDate: config.endDate || undefined,
  };
}

export const reportEdlsScheduledTooSoonPlugin: WizardPlugin = {
  id: "report_edls_scheduled_too_soon",
  name: "EDLS Scheduled Too Soon",
  description:
    "Finds workers whose consecutive EDLS shift start times are closer together than a minimum gap (default 24 hours)",
  requiredComponent: "edls",
  requiredPolicy: "admin",
  category: "EDLS",
  isReport: true,
  needsReadOnlyDb: true,
  steps: [
    {
      id: "inputs",
      name: "Settings",
      description: "Configure the minimum gap and date range",
      kind: "form",
      // Rendered by the shared SchemaForm — no bespoke client component.
      schema: {
        type: "object",
        properties: {
          minHours: {
            type: "number",
            title: "Minimum hours between shift starts",
            description:
              "Pairs of consecutive shifts starting closer together than this are reported.",
            default: 24,
          },
          startDate: {
            type: "string",
            title: "Start date",
            description:
              "Earliest shift date to include, formatted YYYY-MM-DD. Leave blank for today.",
          },
          endDate: {
            type: "string",
            title: "End date",
            description:
              "Latest shift date to include, formatted YYYY-MM-DD. Leave blank for 10 days after the start date.",
          },
        },
      },
      uiSchema: {
        startDate: { "ui:placeholder": "YYYY-MM-DD" },
        endDate: { "ui:placeholder": "YYYY-MM-DD" },
      },
      // All fields have server-side defaults, so this step is always satisfiable.
      getState: () => "completed",
      submit: (ctx: WizardStepContext) => {
        const { minHours, startDate, endDate } = ctx.input as {
          minHours?: number;
          startDate?: string;
          endDate?: string;
        };
        return {
          data: {
            config: {
              minHours:
                typeof minHours === "number" && !isNaN(minHours)
                  ? minHours
                  : undefined,
              startDate: startDate || undefined,
              endDate: endDate || undefined,
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
        const columns = await report.getRuntimeColumns();
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

registerWizardPlugin(reportEdlsScheduledTooSoonPlugin);
