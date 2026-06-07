import type { ClientInjectionPlugin } from "../types";
import { registerClientInjection } from "../registry";

/**
 * Admin-authored custom CSS injection. The impl ships sane defaults
 * (inline <style> in <head>); the admin supplies the actual CSS — or an
 * external stylesheet href — per config row via the generic plugin-config
 * editor. Multiple rows are supported (each is its own config), so several
 * independent custom stylesheets can coexist.
 */
export const customCssPlugin: ClientInjectionPlugin = {
  id: "custom-css",
  name: "Custom CSS",
  description:
    "Inject admin-authored CSS into every page. Choose inline CSS or an external stylesheet URL.",
  slot: "head",
  kind: "css-inline",
  order: 200,
  configSchema: {
    type: "object",
    properties: {
      kind: {
        type: "string",
        title: "Injection type",
        enum: ["css-inline", "css-href"],
        enumNames: ["Inline CSS", "External stylesheet (URL)"],
        default: "css-inline",
      },
      code: {
        type: "string",
        title: "CSS",
        description: "Inline CSS rules (used when injection type is Inline CSS).",
      },
      src: {
        type: "string",
        title: "Stylesheet URL",
        description:
          "URL of an external stylesheet (used when injection type is External stylesheet).",
      },
    },
  },
  uiSchema: {
    code: { "ui:widget": "textarea", "ui:options": { rows: 8 } },
  },
};

registerClientInjection(customCssPlugin);
