import { registerWizardPlugin } from "../registry";
import type { WizardPlugin, WizardStepContext } from "../types";
import { HtaUnionImportWizard } from "../engine/types/hta_union_import";
import {
  buildUploadStep,
  buildMapStep,
  buildValidateStep,
  buildProcessStep,
  buildFeedResultsStep,
} from "./feed-steps";

const feed = new HtaUnionImportWizard();

/**
 * HTA union / apprentice import, in a box. Upload → Configure (Union vs
 * Apprentice) → Map → Validate → Process → Review. The legacy wizard took
 * `memberStatusType` as a launch argument; here it is captured as an
 * in-wizard `form` step that writes `launchArguments.memberStatusType` on
 * `wizard.data` (where `HtaUnionImportWizard.getMemberStatusType` reads it),
 * so no framework launch-argument plumbing — and no wizard route — is
 * needed. The inactivity scan runs automatically inside `processFeedData`.
 */
export const htaUnionImportPlugin: WizardPlugin = {
  id: "hta_union_import",
  name: "HTA Union/Apprentice Import",
  description:
    "Import union or apprentice members from HTA files, updating worker, employment, and contact records",
  requiredComponent: "sitespecific.hta",
  category: "Import",
  steps: [
    buildUploadStep(feed, "Upload the member data file"),
    {
      id: "configure",
      name: "Configure",
      description: "Choose whether this import is for Union or Apprentice members",
      kind: "form",
      schema: {
        type: "object",
        properties: {
          memberStatusType: {
            type: "string",
            title: "Member Status Type",
            description:
              "Union or Apprentice — controls hours handling and the inactivity scan.",
            enum: ["Union", "Apprentice"],
            default: "Union",
          },
        },
        required: ["memberStatusType"],
      },
      getState: (wizard) => {
        const data = (wizard.data as any) || {};
        if (data.launchArguments?.memberStatusType) return "completed";
        return wizard.currentStep === "configure" ? "in_progress" : "pending";
      },
      submit: (ctx: WizardStepContext) => {
        const input = ctx.input as { memberStatusType?: string };
        const memberStatusType = input.memberStatusType || "Union";
        const existing =
          ((ctx.wizard.data as any)?.launchArguments as Record<
            string,
            unknown
          >) || {};
        return {
          data: { launchArguments: { ...existing, memberStatusType } },
        };
      },
    },
    buildMapStep(feed, "Map", "Map file columns to member fields"),
    buildValidateStep(feed),
    buildProcessStep(feed),
    buildFeedResultsStep({
      id: "review",
      name: "Review",
      description: "Review import results",
    }),
  ],
};

registerWizardPlugin(htaUnionImportPlugin);
