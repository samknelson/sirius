import { z } from "zod";
import {
  registerPluginKind,
  registerPluginConfigAdapter,
  baseConfigSchemaShape,
  baseSearchSchemaShape,
} from "../../_core";
import { chargePluginRegistry } from "./registry";

export * from "./types";
export * from "./base";
export * from "./registry";
export * from "./executor";
export * from "./listener";

let kindRegistered = false;
export function registerChargePluginKind(): void {
  if (kindRegistered) return;
  registerPluginKind({
    kind: "charge",
    registry: chargePluginRegistry,
    label: "Charge Plugins",
    description:
      "Automated charges posted to the ledger when trigger events occur (for example when hours or payments are saved).",
    // Mirror legacy auth on /api/charge-plugins:
    // requireComponent("ledger") + requireAccess("admin").
    requiredComponent: "ledger",
    requiredPolicy: "admin",
    sortEntries: (a, b) => a.id.localeCompare(b.id),
    // Backs POST /api/plugins/charge/:id/validate-config. Delegates to
    // the plugin's JSON-Schema-backed `validateConfig` helper.
    validateConfig: (plugin, config) => plugin.validateConfig(config),
  });
  registerPluginConfigAdapter({
    pluginType: "charge",
    configSchema: z
      .object({
        ...baseConfigSchemaShape,
        scope: z.enum(["global", "employer"]),
        employerId: z.string().nullable().optional(),
        // A ledger account is REQUIRED for every charge config (enforced at the
        // DB level by the NOT NULL FK on plugin_configs_charge.account).
        account: z.string().min(1, "account is required"),
      })
      // Preserve the legacy charge route's scope/employer invariants:
      // an employer-scoped config REQUIRES an employerId; a global-scoped
      // config FORBIDS one. Runs in the generic POST/PATCH handlers, which
      // parse the body through this adapter schema.
      .superRefine((data, ctx) => {
        if (data.scope === "employer" && !data.employerId) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["employerId"],
            message: "employerId is required when scope is 'employer'",
          });
        }
        // Use `!= null` so an explicit empty string ("") is also rejected,
        // not just real ids — only a true null/undefined means "no employer".
        if (data.scope === "global" && data.employerId != null) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["employerId"],
            message: "employerId must not be set when scope is 'global'",
          });
        }
      }),
    searchParamsSchema: z.object({
      ...baseSearchSchemaShape,
      scope: z.string().optional(),
      employerId: z.string().nullable().optional(),
      account: z.string().nullable().optional(),
    }),
    toRows: (input) => ({
      base: {
        pluginType: "charge",
        pluginId: input.pluginId,
        enabled: input.enabled,
        name: input.name,
        ordering: input.ordering,
        data: input.data,
      },
      subsidiary: {
        scope: input.scope,
        employerId: input.employerId ?? null,
        account: input.account ?? null,
      },
    }),
    envelopeFields: [
      {
        name: "scope",
        label: "Scope",
        type: "string",
        required: true,
        filterable: true,
        // Render as a dropdown of the fixed scope enum (global / employer).
        options: {
          choices: [
            { value: "global", label: "Global" },
            { value: "employer", label: "Employer" },
          ],
        },
      },
      {
        name: "employerId",
        label: "Employer",
        type: "string",
        filterable: true,
        // Render as a dropdown populated from the active-employer lookup.
        options: {
          endpoint: "/api/employers/lookup",
          valueKey: "id",
          labelKey: "name",
        },
      },
      {
        name: "account",
        label: "Account",
        type: "string",
        required: true,
        filterable: true,
        // Render as a dropdown populated from the ledger accounts endpoint.
        options: {
          endpoint: "/api/ledger/accounts",
          valueKey: "id",
          labelKey: "name",
        },
      },
    ],
    // Duplicate charge configs (same plugin / scope / employer / account) are
    // an accepted state, so no uniqueKey is declared — the generic route skips
    // its duplicate-collision rejection for this kind.
  });
  kindRegistered = true;
}

// Import and register all plugins
// import "./plugins/hourFixed"; // Temporarily disabled - no charge plugins active
// import "./plugins/gbhetLegalHourly"; // Replaced by gbhetLegalBenefit
import "./plugins/gbhetLegalBenefit";
import "./plugins/gbheHourlyCharge";
import "./plugins/gbhetPensionSlaHourly";
import "./plugins/paymentSimpleAllocation";
import "./plugins/btuStewardAttendance";
import "./plugins/btuDuesAllocation";
import "./plugins/sitespecific-bao-echp";
