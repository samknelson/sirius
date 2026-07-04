import { registerWizardPlugin } from "../registry";
import type { WizardPlugin, WizardStepContext } from "../types";
import { BtuWorkerImportWizard } from "../../../wizards/types/btu_worker_import";
import {
  buildUploadStep,
  buildMapStep,
  buildValidateStep,
  buildProcessStep,
  buildFeedResultsStep,
} from "./feed-steps";

const feed = new BtuWorkerImportWizard();

/**
 * BTU worker import, in a box. Upload → Map → Configure → Validate →
 * Process → Results, all driven by the fixed dispatcher route set. The
 * "Reprocess unmatched" action on the Results step rides the same generic
 * `run` route via the results step's `run` handler — no wizard route.
 */
export const btuWorkerImportPlugin: WizardPlugin = {
  id: "btu_worker_import",
  name: "BTU Worker Import",
  description:
    "Import workers from BTU roster files, creating employment records based on employer mappings",
  requiredComponent: "sitespecific.btu",
  category: "Import",
  steps: [
    buildUploadStep(feed, "Upload the worker roster file"),
    buildMapStep(feed, "Map Columns", "Map file columns to worker fields"),
    {
      id: "configure",
      name: "Configure",
      description: "Set import options including as-of date",
      kind: "form",
      schema: {
        type: "object",
        properties: {
          asOfDate: {
            type: "string",
            format: "date",
            title: "As-of Date",
            description:
              "Effective date for employment records and termination-by-absence.",
          },
          terminateByAbsence: {
            type: "boolean",
            title: "Terminate workers not present in this file",
            description:
              "When on, active workers for the matched employers who are absent from this file are terminated as of the as-of date.",
            default: true,
          },
        },
        required: ["asOfDate"],
      },
      getState: (wizard) => {
        const data = (wizard.data as any) || {};
        if (data.asOfDate) return "completed";
        return wizard.currentStep === "configure" ? "in_progress" : "pending";
      },
      submit: (ctx: WizardStepContext) => {
        const input = ctx.input as {
          asOfDate?: string;
          terminateByAbsence?: boolean;
        };
        if (!input.asOfDate) {
          throw new Error("As-of date is required.");
        }
        return {
          data: {
            asOfDate: input.asOfDate,
            terminateByAbsence: input.terminateByAbsence ?? true,
          },
        };
      },
    },
    buildValidateStep(feed),
    buildProcessStep(feed),
    buildFeedResultsStep({
      run: async (ctx: WizardStepContext) => {
        await feed.reprocessUnmatched(ctx.wizardId, (p) => {
          const pct =
            p.total > 0
              ? Math.min(99, Math.round((p.processed / p.total) * 100))
              : 0;
          void ctx.reportProgress(pct);
        });
        // reprocessUnmatched persists the updated processResults itself.
      },
    }),
  ],
};

registerWizardPlugin(btuWorkerImportPlugin);
