import { registerWizardPlugin } from "../registry";
import type { WizardPlugin, WizardStepContext } from "../types";
import { BtuDuesAllocationWizard } from "../engine/types/btu_dues_allocation";
import {
  buildUploadStep,
  buildMapStep,
  buildValidateStep,
  buildProcessStep,
  buildFeedResultsStep,
} from "./feed-steps";

const feed = new BtuDuesAllocationWizard();

/**
 * BTU dues allocation import, in a box. Upload → Map → Validate → Process
 * → Results. The account it posts to comes from the BTU dues charge-plugin
 * config (Ledger > Charge Plugins), not a wizard step. The "Rescan
 * comparison" action on the Results step rides the same generic `run`
 * route via the results step's `run` handler — no wizard route.
 */
export const btuDuesAllocationPlugin: WizardPlugin = {
  id: "btu_dues_allocation",
  name: "BTU Dues Allocation Import",
  description:
    "Import dues deductions from BTU files, creating payment and ledger records matched to workers",
  requiredComponent: "sitespecific.btu",
  category: "Import",
  needsReadOnlyDb: true,
  steps: [
    buildUploadStep(feed, "Upload the dues allocation file"),
    buildMapStep(feed, "Map Columns", "Map file columns to dues fields"),
    buildValidateStep(feed),
    buildProcessStep(feed),
    buildFeedResultsStep({
      run: async (ctx: WizardStepContext) => {
        // rescanComparison persists the refreshed comparison report itself;
        // the dispatcher marks this run step completed when it resolves.
        await feed.rescanComparison(ctx.wizardId);
      },
    }),
  ],
};

registerWizardPlugin(btuDuesAllocationPlugin);
