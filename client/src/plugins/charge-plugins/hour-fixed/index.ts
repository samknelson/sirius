import { registerChargePluginUI } from "../registry";
import ConfigList from "./ConfigList";

registerChargePluginUI({
  pluginId: "hour-fixed",
  configComponent: ConfigList,
});

export { ConfigList };
