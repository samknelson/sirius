import type { ClientInjectionPlugin } from "../types";
import { registerClientInjection } from "../registry";

/**
 * Admin-authored external script injection. Renders a <script src="..."> at the
 * chosen placement (in <head> or before </body>). There is no kind choice —
 * inline vs external is the plugin split. Multiple rows are supported (each is
 * its own config).
 */
export const customJsHrefPlugin: ClientInjectionPlugin = {
  id: "custom-js-href",
  name: "Custom script",
  description: "Inject an external script (<script src>) into every page.",
  slot: "bodyEnd",
  kind: "js-src",
  order: 203,
  configSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      slot: {
        type: "string",
        title: "Placement",
        enum: ["head", "bodyEnd"],
        enumNames: ["In <head>", "Before </body>"],
        default: "bodyEnd",
      },
      src: {
        type: "string",
        title: "Script URL",
        description: "URL of the external script to load.",
      },
    },
  },
};

registerClientInjection(customJsHrefPlugin);
