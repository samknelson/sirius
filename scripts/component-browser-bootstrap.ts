import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Plugin } from "vite";
import { discoverOptionalComponents } from "./optional-components";

/** Build/dev only. Never put this filesystem reader on the production boot path. */
export function componentBrowserBootstrap(root = import.meta.dirname + "/.."): Plugin {
  const scripts = discoverOptionalComponents(resolve(root)).flatMap(component =>
    component.earlyDocument.map(path => {
      const code = readFileSync(resolve(root, path), "utf8");
      if (/<\/script/i.test(code)) throw new Error(`Invalid early-document script: ${path}`);
      return `<script>${code}</script>`;
    }),
  ).join("\n");
  return {
    name: "component-early-document",
    transformIndexHtml: {
      order: "post",
      // Literal insertion, not head-prepend tags: run before injected module
      // scripts, preconnects, stylesheets, and any other external resources.
      handler: html => scripts ? html.replace(/<head(?:\s[^>]*)?>/i, head => `${head}\n${scripts}`) : html,
    },
  };
}
