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
