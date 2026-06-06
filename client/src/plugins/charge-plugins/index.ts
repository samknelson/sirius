// Import all charge plugin UIs to trigger registration
import "./hour-fixed";
import "./gbhe-hourly-charge";
import "./gbhet-legal-hourly";
import "./gbhet-legal-benefit";
import "./gbhet-pension-sla-hourly";
import "./payment-simple-allocation";
import "./btu-steward-attendance";
import "./btu-dues-allocation";
import "./sitespecific-bao-echp";

export { chargePluginUIRegistry } from "./registry";
export type { ChargePluginConfigProps, ChargePluginUIRegistration } from "./registry";
