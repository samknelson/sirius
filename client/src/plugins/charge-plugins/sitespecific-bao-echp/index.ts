import { registerChargePluginUI } from "../registry";
import Summary from "./Summary";

registerChargePluginUI({
  pluginId: "sitespecific-bao-echp",
  summaryComponent: Summary,
});
