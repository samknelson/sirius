import type { ClientInjectionPlugin } from "../types";
import { registerClientInjection } from "../registry";

/**
 * Admin-authored custom JavaScript injection. The impl ships sane defaults
 * (inline <script> before </body>); the admin supplies the actual script — or
 * an external script URL — per config row via the generic plugin-config
 * editor. Multiple rows are supported (each is its own config).
 */
export const customJsPlugin: ClientInjectionPlugin = {
  id: "custom-js",
  name: "Custom JavaScript",
  description:
    "Inject admin-authored JavaScript into every page. Choose inline script or an external script URL.",
  slot: "bodyEnd",
  kind: "js-inline",
  order: 200,
  configSchema: {
    type: "object",
    properties: {
      slot: {
        type: "string",
        title: "Placement",
        enum: ["head", "bodyEnd"],
        enumNames: ["In <head>", "Before </body>"],
        default: "bodyEnd",
      },
      kind: {
        type: "string",
        title: "Injection type",
        enum: ["js-inline", "js-src"],
        enumNames: ["Inline script", "External script (URL)"],
        default: "js-inline",
      },
      code: {
        type: "string",
        title: "JavaScript",
        description: "Inline script body (used when injection type is Inline script).",
      },
      src: {
        type: "string",
        title: "Script URL",
        description:
          "URL of an external script (used when injection type is External script).",
      },
    },
  },
  uiSchema: {
    code: { "ui:widget": "textarea", "ui:options": { rows: 8 } },
  },
};

registerClientInjection(customJsPlugin);
