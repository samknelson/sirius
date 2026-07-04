import { registerWizardPlugin } from "../registry";
import type { WizardPlugin, WizardStepContext } from "../types";
import { BtuCardcheckImportWizard } from "../engine/types/btu_cardcheck_import";
import {
  buildUploadStep,
  buildMapStep,
  buildValidateStep,
  buildProcessStep,
  buildFeedResultsStep,
} from "./feed-steps";

const feed = new BtuCardcheckImportWizard();

/**
 * BTU card check import, in a box. Upload → Map → Configure (pick the card
 * check definition) → Validate → Process → Results. The Configure step is
 * a `custom` step: it reads/writes `cardcheckDefinitionId` on `wizard.data`
 * through the fixed dispatcher submit/getData routes; the client component
 * fetches the definition options from the existing generic
 * `GET /api/cardcheck/definitions` route. No wizard-specific route.
 */
export const btuCardcheckImportPlugin: WizardPlugin = {
  id: "btu_cardcheck_import",
  name: "BTU Card Check Import",
  description:
    "Import card check records from BTU files, matched to workers by BPS employee id",
  requiredComponent: "sitespecific.btu",
  category: "Import",
  steps: [
    buildUploadStep(feed, "Upload the card check file"),
    buildMapStep(feed, "Map Columns", "Map file columns to card check fields"),
    {
      id: "configure",
      name: "Configure",
      description: "Select the card check definition",
      kind: "custom",
      component: "CardcheckConfigure",
      getState: (wizard) => {
        const data = (wizard.data as any) || {};
        if (data.cardcheckDefinitionId) return "completed";
        return wizard.currentStep === "configure" ? "in_progress" : "pending";
      },
      getData: (ctx: WizardStepContext) => {
        const data = (ctx.wizard.data as any) || {};
        return { cardcheckDefinitionId: data.cardcheckDefinitionId ?? null };
      },
      submit: (ctx: WizardStepContext) => {
        const input = ctx.input as { cardcheckDefinitionId?: string };
        if (!input.cardcheckDefinitionId) {
          throw new Error("Select a card check definition to continue.");
        }
        return { data: { cardcheckDefinitionId: input.cardcheckDefinitionId } };
      },
    },
    // Cardcheck uses the legacy "skip invalid" rule: the step completes as
    // long as at least one valid row exists (invalid rows are skipped, not
    // blocking). Mirrors legacy `evaluateValidateCompleteSkipInvalid`.
    buildValidateStep(feed, { isComplete: (vr) => (vr.validRows ?? 0) > 0 }),
    buildProcessStep(feed),
    buildFeedResultsStep(),
  ],
};

registerWizardPlugin(btuCardcheckImportPlugin);
