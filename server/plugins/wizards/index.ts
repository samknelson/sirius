import { registerPluginKind } from "../_core";
import { wizardPluginRegistry } from "./registry";

export {
  wizardPluginRegistry,
  registerWizardPlugin,
  WizardPluginRegistry,
} from "./registry";
export type { WizardManifestEntry } from "./registry";
export * from "./types";
export { registerWizardDispatcherRoutes } from "./dispatcher";

// Side-effect: register the bundled wizard plugins so they appear in the
// registry as soon as this module is imported.
import "./plugins/report-gbhet-legal-compliance";

let kindRegistered = false;

/**
 * Register wizards as the sixth plugin kind on the shared framework.
 * Kind-level access is admin-only: the manifest listing of "which wizard
 * kinds exist" mirrors the admin-gated report catalogue.
 */
export function registerWizardPluginKind(): void {
  if (kindRegistered) return;
  kindRegistered = true;
  registerPluginKind({
    kind: "wizard",
    registry: wizardPluginRegistry,
    label: "Wizards",
    description:
      "Multi-step wizards run in a box on the shared plugin framework.",
    requiredPolicy: "admin",
  });
}

export function initializeWizardPluginSystem(): void {
  registerWizardPluginKind();
}
