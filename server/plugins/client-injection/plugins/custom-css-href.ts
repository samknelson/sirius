import type { ClientInjectionPlugin } from "../types";
import { registerClientInjection } from "../registry";

/**
 * Admin-authored external stylesheet injection. Renders a
 * <link rel="stylesheet"> in <head> pointing at the supplied URL. There is no
 * placement or kind choice — this plugin is single-purpose. Multiple rows are
 * supported (each is its own config).
 */
export const customCssHrefPlugin: ClientInjectionPlugin = {
  id: "custom-css-href",
  name: "Custom stylesheet",
  description: "Inject an external stylesheet (<link>) into the <head> of every page.",
  slot: "head",
  kind: "css-href",
  order: 201,
  configSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      src: {
        type: "string",
        title: "Stylesheet URL",
        description: "URL of the external stylesheet to load.",
      },
    },
  },
};

registerClientInjection(customCssHrefPlugin);
