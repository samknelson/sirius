import { registerPluginKind } from "../../_core";
import { eligibilityPluginRegistry } from "./registry";

export * from "./types";
export * from "./base";
export * from "./registry";
export * from "./executor";

let kindRegistered = false;
export function registerTrustEligibilityKind(): void {
  if (kindRegistered) return;
  registerPluginKind({
    kind: "trust-eligibility",
    registry: eligibilityPluginRegistry,
    // Mirror legacy auth on /api/eligibility-plugins: requireAccess("admin").
    requiredPolicy: "admin",
    sortEntries: (a, b) => a.id.localeCompare(b.id),
    // Backs POST /api/plugins/trust-eligibility/:id/validate-config
    // (replaces the legacy POST /api/eligibility/validate-config).
    validateConfig: async (plugin, config) => {
      return plugin.validateConfig(config);
    },
  });
  kindRegistered = true;
}

import "./plugins/workStatus";
// import "./plugins/gbhetLegal"; // Commented out - no longer needed
import "./plugins/manual";
import "./plugins/always";
import "./plugins/ageout";
import "./plugins/cardcheck";
import "./plugins/priorMonth";
import "./plugins/linked";
import "./plugins/election";
import "./plugins/relationshipType";
import "./plugins/sitespecific-bao-start-healthnet";
