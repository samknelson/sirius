import { registerChargePluginUI } from "../registry";
import Summary from "./Summary";

registerChargePluginUI({
  pluginId: "btu-steward-attendance",
  summaryComponent: Summary,
});
