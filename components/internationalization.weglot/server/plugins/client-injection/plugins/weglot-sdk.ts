import type { ClientInjectionPlugin } from "../../../../../../server/plugins/client-injection/types";
import { registerClientInjection } from "../../../../../../server/plugins/client-injection/registry";

export const weglotSdkPlugin: ClientInjectionPlugin = {
  id: "weglot-sdk",
  name: "Weglot SDK",
  description: "Loads the Weglot translation SDK from the public CDN.",
  requiredComponent: "internationalization.weglot",
  slot: "head",
  kind: "js-src",
  src: "https://cdn.weglot.com/weglot.min.js",
  order: 10,
};

registerClientInjection(weglotSdkPlugin);
