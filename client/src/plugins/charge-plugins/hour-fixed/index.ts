import { registerChargePluginUI } from "../registry";
import ConfigForm from "./ConfigForm";

registerChargePluginUI({
  pluginId: "hour-fixed",
  configComponent: ConfigForm,
});

export { ConfigForm };
