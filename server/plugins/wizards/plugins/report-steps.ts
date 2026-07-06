import type { Wizard } from "@shared/schema";
import type { WizardStepHandler, WizardStepContext } from "../types";

/**
 * Shared Run + Results step builders for the report wizards. Every report
 * follows the same Inputs → Run → Results shape: the Run step invokes the
 * legacy report class (columns / primary key / record fetch, all reading
 * through `storage.*`), persists the bulk rows to `wizard_report_data`,
 * and stashes a `reportMeta` summary; the Results step is a columns-driven
 * table + CSV export served by the generic dispatcher data/export routes.
 *
 * Only the per-report Inputs step (and the config it produces) differs, so
 * each plugin supplies its own report instance and a `readConfig` that maps
 * the persisted `wizard.data.config` into the shape `fetchRecords` expects.
 */

export interface ReportLike {
  getColumns(): Array<{
    id: string;
    header: string;
    type?: string;
    width?: number;
  }>;
  getPrimaryKeyField(): string;
  fetchRecords(
    config: any,
    batchSize?: number,
    onProgress?: (progress: { processed: number; total: number }) => void,
  ): Promise<Array<Record<string, unknown>>>;
}

export function buildReportRunStep(
  report: ReportLike,
  readConfig: (wizard: Wizard) => Record<string, unknown>,
): WizardStepHandler {
  return {
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
  };
}

export function buildReportResultsStep(): WizardStepHandler {
  return {
    id: "results",
    name: "Results",
    description: "View and download report results",
    kind: "results",
    component: "ResultsTable",
    getState: (wizard) => {
      const data = (wizard.data as any) || {};
      return data.reportMeta ? "completed" : "pending";
    },
  };
}

/** Inputs step for reports that take no parameters (always ready to run). */
export function buildGenericInputsStep(description: string): WizardStepHandler {
  return {
    id: "inputs",
    name: "Inputs",
    description,
    kind: "form",
    schema: { type: "object", properties: {} },
    getState: () => "completed",
    submit: () => ({ data: { config: {} } }),
  };
}
