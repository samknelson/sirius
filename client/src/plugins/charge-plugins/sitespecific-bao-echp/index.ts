import { registerChargePluginUI } from "../registry";
import ConfigList from "./ConfigList";

registerChargePluginUI({
  pluginId: "sitespecific-bao-echp",
  configComponent: ConfigList,
});

export { ConfigList };
