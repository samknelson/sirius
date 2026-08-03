import DOMPurify from "isomorphic-dompurify";

// Mirrors the tag/attribute whitelist of SimpleHtmlEditor
// (client/src/components/ui/simple-html-editor.tsx). Keep in sync.
const ALLOWED_TAGS = [
  "strong", "b", "em", "i", "u", "ul", "ol", "li", "br", "p", "a",
  "h1", "h2", "h3", "h4", "h5", "h6",
  "table", "thead", "tbody", "tfoot", "tr", "th", "td",
];
const ALLOWED_ATTR = ["href", "target", "rel", "colspan", "rowspan", "scope"];

export function sanitizeHelpHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOWED_URI_REGEXP: /^(?:https?|mailto|tel):|^[/#]|^[^:]*$/i,
  });
}
