import type { ClientInjectionPlugin } from "../types";
import { registerClientInjection } from "../registry";

/**
 * Admin-authored inline CSS injection. Renders the supplied CSS rules as an
 * inline <style> in <head>. There is no placement or kind choice — this plugin
 * is single-purpose. Multiple rows are supported (each is its own config), so
 * several independent inline stylesheets can coexist.
 */
export const customCssInlinePlugin: ClientInjectionPlugin = {
  id: "custom-css-inline",
  name: "Custom inline CSS",
  description: "Inject admin-authored inline CSS into the <head> of every page.",
  slot: "head",
  kind: "css-inline",
  order: 200,
  configSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      code: {
        type: "string",
        title: "CSS",
        description: "Inline CSS rules rendered inside a <style> tag.",
      },
    },
  },
  uiSchema: {
    code: { "ui:widget": "textarea", "ui:options": { rows: 8 } },
  },
};

registerClientInjection(customCssInlinePlugin);
