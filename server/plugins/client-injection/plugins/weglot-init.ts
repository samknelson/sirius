import type { ClientInjectionPlugin } from "../types";
import { registerClientInjection } from "../registry";

export const weglotInitPlugin: ClientInjectionPlugin = {
  id: "weglot-init",
  name: "Weglot Initialization",
  description:
    "Initializes the Weglot SDK with the configured API key. Skipped when WEGLOT_API_KEY is not set.",
  requiredComponent: "internationalization.weglot",
  slot: "head",
  kind: "js-inline",
  order: 20,
  resolve: ({ env }) => {
    const apiKey = env.WEGLOT_API_KEY;
    if (!apiKey || apiKey.trim() === "") return null;
    const safe = JSON.stringify(apiKey);
    return {
      code: `(function(){function init(){if(window.Weglot&&!window.__weglotInitialized){window.Weglot.initialize({api_key:${safe}});window.__weglotInitialized=true;}}if(window.Weglot){init();}else{document.addEventListener('DOMContentLoaded',init);window.addEventListener('load',init);}})();`,
    };
  },
};

registerClientInjection(weglotInitPlugin);
