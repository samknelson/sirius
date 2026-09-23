import { generate, parse } from "css-tree";
import { calculate } from "specificity";
import { parseTemplateDocument, sanitizeTemplateBody } from "./sanitize";
import { templateDeclarations, type TemplateDeclaration } from "./template-css";
import { unwrapLetterPage } from "./letter-page";

interface Ranked extends TemplateDeclaration { rank: number[] }
const compare = (a: number[], b: number[]) => {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
};

/**
 * Canonical body-only template. Authored tokens are opaque, BEFORE HTML/CSS
 * parsing, including quoted arguments in attributes. Authored output is source,
 * not safe-to-mount HTML: normalize with preserveTokens:false after evaluation.
 */
export function normalizeTemplateHtml(
  html: string,
  { preserveTokens = true }: { preserveTokens?: boolean } = {},
): string {
  html = unwrapLetterPage(html);
  let prefix = "siriustemplateplaceholder";
  while (html.includes(prefix)) prefix += "x";
  const tokens: string[] = [];
  if (preserveTokens) html = html.replace(/\{\{[^{}]*\}\}/g, (token) => {
    tokens.push(token);
    return `${prefix}${tokens.length - 1}end`;
  });
  const root = parseTemplateDocument(html);
  const body = root.querySelector("body") ?? root;
  const ranks = new Map<Element, Ranked[]>();
  let order = 0;
  const add = (el: Element, declarations: TemplateDeclaration[], specificity: number[]) => {
    const list = ranks.get(el) ?? [];
    for (const decl of declarations) {
      list.push({ ...decl, rank: [decl.important ? 1 : 0, ...specificity, order++] });
    }
    ranks.set(el, list);
  };
  for (const style of Array.from(root.querySelectorAll("style"))) {
    try {
      const sheet = parse(style.textContent ?? "");
      if (sheet.type === "StyleSheet") sheet.children.forEach((rule) => {
        // At-rules (imports, media, font-face, page) are not body styles.
        if (rule.type !== "Rule" || rule.prelude.type !== "SelectorList") return;
        const declarations = templateDeclarations(generate(rule.block).slice(1, -1), preserveTokens ? prefix : undefined);
        rule.prelude.children.forEach((selector) => {
          const text = generate(selector);
          try {
            const { A, B, C } = calculate(text);
            if (root.matches(text)) add(root, declarations, [0, A, B, C]);
            root.querySelectorAll(text).forEach((el) => add(el, declarations, [0, A, B, C]));
          } catch { /* Unsupported selectors cannot match. */ }
        });
      });
    } catch { /* Invalid stylesheet is not executable content. */ }
    style.remove();
  }
  for (const el of [...(root !== body ? [root] : []), body, ...Array.from(body.querySelectorAll("*"))]) {
    add(el, templateDeclarations(el.getAttribute("style") ?? "", preserveTokens ? prefix : undefined), [1, 0, 0, 0]);
    const declarations = (ranks.get(el) ?? []).sort((a, b) => compare(a.rank, b.rank));
    // Preserve cascade ordering, including shorthand/longhand interactions.
    // Deduplicate exact properties from the end for a stable second pass.
    const seen = new Set<string>();
    const survivors = declarations.reverse().filter(({ property }) => {
      if (seen.has(property)) return false;
      seen.add(property);
      return true;
    }).reverse();
    if (survivors.length) el.setAttribute("style", survivors.map(({ property, value, important }) =>
      `${property}:${value}${important ? "!important" : ""}`).join(";"));
    else el.removeAttribute("style");
  }
  // Keep document-level formatting without keeping an author-supplied shell.
  if (body.hasAttribute("style")) {
    const wrapper = body.ownerDocument.createElement("div");
    wrapper.setAttribute("style", body.getAttribute("style")!);
    while (body.firstChild) wrapper.appendChild(body.firstChild);
    body.appendChild(wrapper);
  }
  if (root !== body && root.hasAttribute("style")) {
    const wrapper = body.ownerDocument.createElement("div");
    wrapper.setAttribute("style", root.getAttribute("style")!);
    while (body.firstChild) wrapper.appendChild(body.firstChild);
    body.appendChild(wrapper);
  }
  let clean = sanitizeTemplateBody(body.innerHTML, preserveTokens ? prefix : undefined);
  tokens.forEach((token, i) => { clean = clean.split(`${prefix}${i}end`).join(token); });
  return clean;
}