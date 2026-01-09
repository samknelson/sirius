import { registerChargePluginUI } from "../registry";
import ConfigList from "./ConfigList";

registerChargePluginUI({
  pluginId: "btu-dues-allocation",
  configComponent: ConfigList,
});

export { ConfigList };
