import { registerChargePluginUI } from "../registry";
import ConfigList from "./ConfigList";

registerChargePluginUI({
  pluginId: "gbhe-hourly-charge",
  configComponent: ConfigList,
});

export { ConfigList };
