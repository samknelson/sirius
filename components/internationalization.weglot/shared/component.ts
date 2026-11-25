import type { ComponentDefinition } from "../../../shared/components";
export const component: ComponentDefinition = {
  id: "internationalization.weglot",
  name: "Weglot Translation",
  description: "Injects the Weglot SDK and initializer so site content can be translated on the fly.",
  enabledByDefault: false,
  category: "internationalization",
  dependsOnComponents: ["internationalization"],
  pluginConfigs: [
    {
      pluginKind: "client-injection",
      pluginId: "weglot-sdk",
      siriusId: "auto.internationalization.weglot.sdk",
      name: "Weglot SDK",
      ordering: 10,
    },
    {
      pluginKind: "client-injection",
      pluginId: "weglot-init",
      siriusId: "auto.internationalization.weglot.init",
      name: "Weglot Initialization",
      ordering: 20,
    },
  ],
};
