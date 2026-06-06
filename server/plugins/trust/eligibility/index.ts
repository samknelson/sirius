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
    toRows: (input) => {
      // `data.appliesTo` is the authoritative rule-level scan-type list
      // (the per-plugin validateConfig requires it). The subsidiary
      // `applies_to` column is a denormalized comma-joined copy derived from
      // it, so config payloads never carry a top-level `appliesTo` array
      // (which would fail the adapter's `appliesTo: z.string()` schema).
      const dataAppliesTo = (input.data as { appliesTo?: unknown } | null)
        ?.appliesTo;
      const appliesTo = Array.isArray(dataAppliesTo)
        ? dataAppliesTo.join(",")
        : (input.appliesTo ?? null);
      return {
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
          appliesTo,
        },
      };
    },
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
