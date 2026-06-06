import { registerChargePluginUI } from "../registry";
import Summary from "./Summary";

registerChargePluginUI({
  pluginId: "gbhe-hourly-charge",
  summaryComponent: Summary,
});
