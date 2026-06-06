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
        // pluginId is denormalized onto the subsidiary purely so the 4-tuple
        // (pluginId, scope, employerId, account) can be enforced by a single
        // null-safe DB unique index — the base table holds the canonical
        // pluginId; reads still take it from the base row.
        pluginId: input.pluginId,
        scope: input.scope,
        employerId: input.employerId ?? null,
        account: input.account ?? null,
      },
    }),
    envelopeFields: [
      { name: "scope", label: "Scope", type: "string", required: true },
      { name: "employerId", label: "Employer ID", type: "string" },
      {
        name: "account",
        label: "Account",
        type: "string",
        required: true,
        // Render as a dropdown populated from the ledger accounts endpoint.
        options: {
          endpoint: "/api/ledger/accounts",
          valueKey: "id",
          labelKey: "name",
        },
      },
    ],
    // One config per plugin per scope/employer/account (the legacy table's
    // unique constraint). The generic route uses this to reject collisions.
    uniqueKey: (input) => ({
      pluginId: input.pluginId,
      scope: input.scope,
      employerId: input.employerId ?? null,
      account: input.account ?? null,
    }),
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
