import { registerChargePluginUI } from "../registry";
import ConfigList from "./ConfigList";

registerChargePluginUI({
  pluginId: "gbhet-legal-hourly",
  configComponent: ConfigList,
});

export { ConfigList };
