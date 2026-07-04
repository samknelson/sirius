import type { ClientInjectionPlugin } from "../types";
import { registerClientInjection } from "../registry";

/**
 * Admin-authored inline JavaScript injection. Renders the supplied script body
 * as an inline <script>. The admin chooses the placement (in <head> or before
 * </body>); there is no kind choice — inline vs external is the plugin split.
 * Multiple rows are supported (each is its own config).
 */
export const customJsInlinePlugin: ClientInjectionPlugin = {
  id: "custom-js-inline",
  name: "Custom inline JavaScript",
  description: "Inject admin-authored inline JavaScript into every page.",
  slot: "bodyEnd",
  kind: "js-inline",
  order: 202,
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
      code: {
        type: "string",
        title: "JavaScript",
        description: "Inline script body rendered inside a <script> tag.",
      },
    },
  },
  uiSchema: {
    code: { "ui:widget": "textarea", "ui:options": { rows: 8 } },
  },
};

registerClientInjection(customJsInlinePlugin);
