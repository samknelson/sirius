import { registerWizardPlugin } from "../registry";
import type { WizardPlugin, WizardStepContext } from "../types";
import {
  WorkerRatingsImportWizard,
  parseWorkerIdentifierKind,
} from "../engine/types/worker_ratings_import";
import {
  buildUploadStep,
  buildMapStep,
  buildValidateStep,
  buildProcessStep,
  buildFeedResultsStep,
  prepareFeedDataUpdate,
} from "./feed-steps";

const feed = new WorkerRatingsImportWizard();

/**
 * Worker ratings import, in a box. Upload → Map → Configure (how the file
 * names workers) → Validate → Process → Results.
 *
 * The file is in long format: one row per worker + rating type + value. The
 * Configure step is a `custom` step reading/writing `workerIdentifierKind`
 * on `wizard.data` through the fixed dispatcher submit/getData routes; its
 * client component lists the site's configured worker ID types from the
 * existing generic `GET /api/options/worker-id-type` route alongside SSN,
 * worker UUID and Sirius ID. No wizard-specific route.
 *
 * Validation never blocks: the step completes as soon as at least one row is
 * applicable, and processing skips the rest, listing each one with its reason
 * in the results.
 */
export const workerRatingsImportPlugin: WizardPlugin = {
  id: "worker_ratings_import",
  name: "Worker Ratings Import",
  description:
    "Import worker ratings from a spreadsheet or CSV: one row per worker, rating type and value",
  requiredComponent: "worker.ratings",
  requiredPolicy: "staff",
  category: "Import",
  prepareUpdate: prepareFeedDataUpdate,
  steps: [
    buildUploadStep(feed, "Upload the ratings file"),
    buildMapStep(feed, "Map Columns", "Map file columns to rating fields"),
    {
      id: "configure",
      name: "Configure",
      description: "Choose how the file identifies workers",
      kind: "custom",
      component: "RatingsConfigure",
      getState: (wizard) => {
        const data = (wizard.data as any) || {};
        if (parseWorkerIdentifierKind(data.workerIdentifierKind)) {
          return "completed";
        }
        return wizard.currentStep === "configure" ? "in_progress" : "pending";
      },
      getData: (ctx: WizardStepContext) => {
        const data = (ctx.wizard.data as any) || {};
        return {
          workerIdentifierKind: data.workerIdentifierKind ?? null,
        };
      },
      submit: (ctx: WizardStepContext) => {
        const input = ctx.input as { workerIdentifierKind?: string };
        const parsed = parseWorkerIdentifierKind(input.workerIdentifierKind);
        if (!parsed) {
          throw new Error("Choose how the file identifies workers to continue.");
        }
        return {
          data: { workerIdentifierKind: input.workerIdentifierKind },
        };
      },
    },
    // Validation reports problems but does not block: rows that fail are
    // skipped during processing and listed with their reason in the results,
    // so the step completes as long as there is at least one row to apply.
    buildValidateStep(feed, {
      description: "Check every row and list the ones that will be skipped",
      isComplete: (vr) => (vr.validRows ?? 0) > 0,
    }),
    buildProcessStep(feed, "RunView", "Apply the ratings, one row at a time"),
    buildFeedResultsStep(),
  ],
};

registerWizardPlugin(workerRatingsImportPlugin);
