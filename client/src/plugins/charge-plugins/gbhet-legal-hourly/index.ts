import { registerChargePluginUI } from "../registry";
import Summary from "./Summary";

registerChargePluginUI({
  pluginId: "gbhet-legal-hourly",
  summaryComponent: Summary,
});
