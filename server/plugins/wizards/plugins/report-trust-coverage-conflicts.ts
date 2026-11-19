import { registerWizardPlugin } from "../registry";
import type { WizardPlugin, WizardStepContext } from "../types";
import type { Wizard } from "@shared/schema";
import type { EdiCoverageConflict, EdiCoverageConflictReport } from "@shared/edi-coverage-choices";
import {
  conflictListRange, CONFLICT_LIST_QUERY_MS, MAX_CONFLICT_LIST_MONTHS, monthLabel, readConflictingCoverage,
} from "../../trust/provider-edi/coverage-conflict-list";
import { coverageConflictsCsv } from "../../trust/provider-edi/coverage-report";
import { conflictRuleInForce } from "../../trust/provider-edi/coverage-settings";

/**
 * Conflicting Coverage: every remaining conflict, across all benefits, for a
 * range of coverage months — the cleanup list behind the temporary feed rule
 * (EDI_EXCLUDE_CONFLICTING_COVERAGE). It only reads coverage, relationship and
 * employer records; the one thing it writes is its own saved result.
 *
 * What a conflict is stays with the feed (`competingSources`); this file only
 * collects the range, runs the shared list and presents it.
 */

const readConfig = (wizard: Wizard) =>
  (((wizard.data as any) || {}).config ?? {}) as { fromMonth?: string; toMonth?: string };

/** One saved row per conflict; the row is the conflict exactly as it is shown. */
async function savedConflicts(ctx: WizardStepContext): Promise<EdiCoverageConflict[]> {
  const rows = await ctx.storage.wizards.getReportData(ctx.wizardId);
  return rows.sort((a, b) => a.pk.localeCompare(b.pk)).map(row => row.data as EdiCoverageConflict);
}

const monthField = (title: string, description: string) => ({
  type: "string" as const, title, description,
  // Blank is allowed: a blank month takes the default named in the description.
  pattern: "^$|^\\d{4}-(0[1-9]|1[0-2])$",
});

export const reportTrustCoverageConflictsPlugin: WizardPlugin = {
  id: "report_trust_coverage_conflicts",
  name: "Conflicting Coverage",
  description:
    "Lists people who hold more than one coverage record for the same benefit and month with a different source or COBRA classification, across all benefits, so the records can be corrected",
  requiredComponent: "trust.providers.edi",
  requiredPolicy: "admin",
  category: "Trust",
  isReport: true,
  needsReadOnlyDb: true,
  steps: [
    {
      id: "inputs",
      name: "Inputs",
      description: "Choose the coverage months to check. All benefits are included.",
      kind: "form",
      schema: {
        type: "object",
        properties: {
          fromMonth: monthField("From coverage month",
            "First coverage month to check, formatted YYYY-MM. Leave blank for the twelve months ending at the To month."),
          toMonth: monthField("To coverage month",
            `Last coverage month to check, formatted YYYY-MM. Leave blank for the current month. A range can cover at most ${MAX_CONFLICT_LIST_MONTHS} months.`),
        },
      },
      uiSchema: {
        fromMonth: { "ui:placeholder": "2026-01" },
        toMonth: { "ui:placeholder": "2026-12" },
      },
      // Both months have defaults, so the report can always run.
      getState: () => "completed",
      submit: (ctx: WizardStepContext) => {
        const fromMonth = String(ctx.input.fromMonth ?? "").trim() || undefined;
        const toMonth = String(ctx.input.toMonth ?? "").trim() || undefined;
        conflictListRange({ fromMonth, toMonth });
        return { data: { config: { fromMonth, toMonth } } };
      },
    },
    {
      id: "run",
      name: "Run",
      description: "Read coverage for the chosen months and list every conflict",
      kind: "run",
      // Reads only, and replaces this report's own saved result.
      retrySafe: true,
      component: "RunView",
      getState: (wizard) => {
        const status = ((wizard.data as any) || {}).progress?.run?.status;
        return status === "completed" || status === "failed" || status === "in_progress" ? status : "pending";
      },
      // A saved range that is no longer valid is refused before any work starts.
      getRunBlocker: (wizard) => {
        try { conflictListRange(readConfig(wizard)); return undefined; }
        catch (error) { return error instanceof Error ? error.message : "Choose a valid range of months."; }
      },
      run: async (ctx: WizardStepContext) => {
        const range = conflictListRange(readConfig(ctx.wizard));
        const limit = { statementTimeoutMs: CONFLICT_LIST_QUERY_MS };
        const list = await readConflictingCoverage(
          fn => ctx.storage.readOnly.query(fn, limit), range,
          (processed, total, phase) => ctx.reportProgress(
            total ? Math.min(99, Math.round(processed / total * 100)) : null, { phase, processed, total }),
          { wizardId: ctx.wizardId, runId: ctx.runId },
        );

        await ctx.reportProgress(99, { phase: "Saving the list", processed: 0, total: list.conflicts.length });
        await ctx.storage.wizards.deleteReportData(ctx.wizardId);
        for (let i = 0; i < list.conflicts.length; i++)
          await ctx.storage.wizards.saveReportData(ctx.wizardId, String(i).padStart(7, "0"), list.conflicts[i]);

        return {
          status: "completed",
          data: {
            reportMeta: {
              generatedAt: new Date().toISOString(),
              // The framework's "records" are the coverage records to correct.
              recordCount: list.recordCount,
              columns: [],
              conflictCount: list.conflicts.length,
              peopleCount: list.peopleCount,
              fromMonth: monthLabel(range.from),
              toMonth: monthLabel(range.to),
            },
            recordCount: list.recordCount,
          },
        };
      },
    },
    {
      id: "results",
      name: "Results",
      description: "View and download the conflicting coverage",
      kind: "results",
      component: "ResultsTable",
      getState: (wizard) => (((wizard.data as any) || {}).reportMeta ? "completed" : "pending"),
      getData: async (ctx): Promise<EdiCoverageConflictReport & Record<string, unknown>> => {
        const meta = ((ctx.wizard.data as any) || {}).reportMeta;
        if (!meta) return { generated: false };
        return {
          generated: true,
          generatedAt: meta.generatedAt, fromMonth: meta.fromMonth, toMonth: meta.toMonth,
          conflictCount: meta.conflictCount, recordCount: meta.recordCount, peopleCount: meta.peopleCount,
          // The rule as it stands now, not when the list was made.
          rule: conflictRuleInForce(),
          conflicts: await savedConflicts(ctx),
        };
      },
      exportFile: async (ctx) => {
        const meta = ((ctx.wizard.data as any) || {}).reportMeta;
        if (!meta) throw new Error("Run the report before downloading it");
        return {
          content: coverageConflictsCsv(await savedConflicts(ctx)),
          filename: `conflicting-coverage-${meta.fromMonth}-to-${meta.toMonth}.csv`,
          mimeType: "text/csv; charset=utf-8",
        };
      },
    },
  ],
};

registerWizardPlugin(reportTrustCoverageConflictsPlugin);
