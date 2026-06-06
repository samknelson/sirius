import { registerChargePluginUI } from "../registry";
import ConfigList from "./ConfigList";

registerChargePluginUI({
  pluginId: "gbhet-pension-sla-hourly",
  configComponent: ConfigList,
});

export { ConfigList };
