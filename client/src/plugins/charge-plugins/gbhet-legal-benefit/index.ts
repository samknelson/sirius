import { registerChargePluginUI } from "../registry";
import ConfigList from "./ConfigList";

registerChargePluginUI({
  pluginId: "gbhet-legal-benefit",
  configComponent: ConfigList,
});

export { ConfigList };
