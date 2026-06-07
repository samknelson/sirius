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
    label: "Trust Eligibility",
    description:
      "Rules that determine worker eligibility for trust benefits at election start and continuation.",
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
      // `data.appliesTo` is the authoritative rule-level scan-type list (the
      // per-plugin validateConfig and the executor both read it from there).
      // The subsidiary `applies_to` column is a denormalized comma-joined copy.
      //
      // Two save paths share this adapter:
      //   - the policy-benefits rule editor sends the array on `data.appliesTo`;
      //   - the generic admin config page sends a comma-joined string on the
      //     top-level `appliesTo` envelope field (checkbox group), and RJSF
      //     strips `appliesTo` out of `data` (it's not in the JSON Schema).
      // Resolve the authoritative array from whichever source provided it, then
      // write it back into `data.appliesTo` so the executor stays correct
      // regardless of which editor saved the config.
      const dataObj = (input.data as Record<string, unknown> | null) ?? {};
      const dataAppliesTo = dataObj.appliesTo;
      const appliesToArr = Array.isArray(dataAppliesTo)
        ? (dataAppliesTo as string[])
        : typeof input.appliesTo === "string" && input.appliesTo.length > 0
          ? input.appliesTo
              .split(",")
              .map((s: string) => s.trim())
              .filter(Boolean)
          : [];
      const appliesTo = appliesToArr.length > 0 ? appliesToArr.join(",") : null;
      return {
        base: {
          pluginType: "trust-eligibility",
          pluginId: input.pluginId,
          enabled: input.enabled,
          name: input.name,
          ordering: input.ordering,
          data: { ...dataObj, appliesTo: appliesToArr },
        },
        subsidiary: {
          policy: input.policy ?? null,
          benefit: input.benefit ?? null,
          appliesTo,
        },
      };
    },
    envelopeFields: [
      {
        name: "policy",
        label: "Policy",
        type: "string",
        filterable: true,
        options: { endpoint: "/api/policies", valueKey: "id", labelKey: "name" },
      },
      {
        name: "benefit",
        label: "Benefit",
        type: "string",
        filterable: true,
        options: {
          endpoint: "/api/trust-benefits",
          valueKey: "id",
          labelKey: "name",
        },
      },
      {
        name: "appliesTo",
        label: "Applies To",
        type: "string",
        multiple: true,
        filterable: true,
        options: {
          choices: [
            { value: "start", label: "Start" },
            { value: "continue", label: "Continue" },
          ],
        },
      },
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
