import { registerChargePluginUI } from "../registry";
import Summary from "./Summary";

registerChargePluginUI({
  pluginId: "hour-fixed",
  summaryComponent: Summary,
});
