import { z } from "zod";
import {
  registerPluginKind,
  registerPluginConfigAdapter,
  baseConfigSchemaShape,
  baseSearchSchemaShape,
} from "../../_core";
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
  registerPluginConfigAdapter({
    pluginType: "trust-eligibility",
    configSchema: z.object({
      ...baseConfigSchemaShape,
      policy: z.string().nullable().optional(),
      benefit: z.string().nullable().optional(),
      appliesTo: z.string().nullable().optional(),
    }),
    searchParamsSchema: z.object({
      ...baseSearchSchemaShape,
      policy: z.string().nullable().optional(),
      benefit: z.string().nullable().optional(),
      appliesTo: z.string().nullable().optional(),
    }),
    toRows: (input) => ({
      base: {
        pluginType: "trust-eligibility",
        pluginId: input.pluginId,
        enabled: input.enabled,
        name: input.name,
        ordering: input.ordering,
        data: input.data,
      },
      subsidiary: {
        policy: input.policy ?? null,
        benefit: input.benefit ?? null,
        appliesTo: input.appliesTo ?? null,
      },
    }),
    envelopeFields: [
      { name: "policy", label: "Policy", type: "string" },
      { name: "benefit", label: "Benefit", type: "string" },
      { name: "appliesTo", label: "Applies To", type: "string" },
    ],
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
import "./plugins/sitespecific-bao-start-kaiser";
import "./plugins/sitespecific-bao-buildup";
