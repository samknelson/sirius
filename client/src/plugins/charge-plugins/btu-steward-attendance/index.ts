import { registerChargePluginUI } from "../registry";
import ConfigList from "./ConfigList";

registerChargePluginUI({
  pluginId: "btu-steward-attendance",
  configComponent: ConfigList,
});

export { ConfigList };
