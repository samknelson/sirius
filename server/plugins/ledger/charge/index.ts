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
    configSchema: z.object({
      ...baseConfigSchemaShape,
      scope: z.string().min(1),
      employerId: z.string().nullable().optional(),
      account: z.string().nullable().optional(),
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
      { name: "scope", label: "Scope", type: "string", required: true },
      { name: "employerId", label: "Employer ID", type: "string" },
      { name: "account", label: "Account", type: "string" },
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
