import { registerChargePluginUI } from "../registry";
import Summary from "./Summary";

registerChargePluginUI({
  pluginId: "gbhet-legal-benefit",
  summaryComponent: Summary,
});
