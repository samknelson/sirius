import { registerPluginKind } from "../../_core";
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
