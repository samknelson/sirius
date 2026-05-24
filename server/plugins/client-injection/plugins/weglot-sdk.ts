import type { ClientInjectionPlugin } from "../types";
import { registerClientInjection } from "../registry";

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
