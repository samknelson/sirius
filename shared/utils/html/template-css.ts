import { generate, lexer, parse, walk, type CssNode } from "css-tree";

// Deliberately excludes positioning, transforms, generated content, external
// resources, custom properties and page geometry. Imported CSS cannot move a
// letter into the provider's reserved address area.
const PROPERTIES = new Set((
  "color background background-color font font-family font-size font-weight font-style font-variant " +
  "line-height letter-spacing word-spacing text-align text-decoration text-transform " +
  "text-indent white-space overflow-wrap word-wrap word-break vertical-align " +
  "margin margin-top margin-right margin-bottom margin-left padding padding-top " +
  "padding-right padding-bottom padding-left width height min-width max-width " +
  "min-height max-height border border-top border-right border-bottom border-left " +
  "border-width border-style border-color border-top-width border-right-width " +
  "border-bottom-width border-left-width border-top-style border-right-style " +
  "border-bottom-style border-left-style border-top-color border-right-color " +
  "border-bottom-color border-left-color border-collapse border-spacing table-layout " +
  "caption-side empty-cells list-style-type list-style-position break-before " +
  "break-after break-inside page-break-before page-break-after page-break-inside " +
  "orphans widows display"
).split(/\s+/));

export interface TemplateDeclaration {
  property: string;
  value: string;
  important: boolean;
}

export function templateDeclarations(css: string, tokenPrefix?: string): TemplateDeclaration[] {
  const result: TemplateDeclaration[] = [];
  let ast: CssNode;
  try { ast = parse(css, { context: "declarationList" }); } catch { return result; }
  walk(ast, (node) => {
    if (node.type !== "Declaration") return;
    const property = node.property.toLowerCase();
    if (!PROPERTIES.has(property)) return;
    const value = generate(node.value);
    let unsafe = false;
    walk(node.value, (part) => {
      if (part.type === "Url" || part.type === "Raw") unsafe = true;
      // No functions means no obfuscated URLs, expression, var(), attr(),
      // calc() negative offsets, or future browser-specific active values.
      if (part.type === "Function" && !["rgb", "rgba", "hsl", "hsla"].includes(part.name.toLowerCase())) unsafe = true;
      if (["Dimension", "Number", "Percentage"].includes(part.type) &&
          Number((part as { value: string }).value) < 0) unsafe = true;
    });
    if (unsafe || /[\\<>]/.test(value)) return;
    if (property === "display" && !/^(?:none|block|inline|inline-block|table|inline-table|table-row|table-cell|table-row-group|table-header-group|table-footer-group|table-column|table-column-group|table-caption|list-item)$/.test(value)) return;
    const tokenized = tokenPrefix && value.includes(tokenPrefix);
    if (!tokenized && lexer.matchProperty(property, node.value).error) return;
    result.push({ property, value, important: !!node.important });
  });
  return result;
}

export function cleanTemplateStyle(css: string): string {
  return templateDeclarations(css).map(({ property, value, important }) =>
    `${property}:${value}${important ? "!important" : ""}`).join(";");
}