/**
 * HTML → plain text — dependency-free.
 *
 * Pure string/regex implementations so they work in both the browser and
 * Node without a DOM, and so nothing on the production boot path is
 * forced to load a sanitizer. See `./index.ts` for the library overview.
 *
 * Both conversions share ONE entity decode path (`decodeHtmlEntities`),
 * so a character that reads correctly in an email plain-text fallback
 * reads correctly in a one-line template summary too.
 */
import { decodeHtmlEntities } from "./entities";

/**
 * Convert rich-text HTML (the subset our editor allows:
 * strong/b/em/i/u/ul/ol/li/br/p/a, plus headings) into a MULTI-LINE
 * plain-text representation suitable for an email plain-text fallback or
 * for storing in a plain-text body column.
 *
 * Block boundaries become newlines, list items get a bullet prefix, and
 * links keep their destination as `text (url)`.
 */
export function htmlToPlainText(html: string | null | undefined): string {
  if (!html) return "";
  let s = String(html);

  // Normalize line breaks
  s = s.replace(/\r\n?/g, "\n");

  // <br> → newline
  s = s.replace(/<br\s*\/?>/gi, "\n");

  // <li> opening → bullet prefix
  s = s.replace(/<li[^>]*>/gi, "• ");

  // <a href="x">text</a> → "text (x)"  (or just text when href equals text or is empty)
  s = s.replace(
    /<a\b[^>]*\bhref\s*=\s*["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi,
    (_m, href: string, inner: string) => {
      const text = inner.replace(/<[^>]+>/g, "").trim();
      const url = (href || "").trim();
      if (!url) return text;
      if (!text) return url;
      if (text === url) return text;
      return `${text} (${url})`;
    },
  );

  // Closing block-ish tags → newline
  s = s.replace(/<\/(p|li|ul|ol|div|h[1-6])>/gi, "\n");

  // Strip any remaining tags
  s = s.replace(/<[^>]+>/g, "");

  // Decode entities the editor (and its Special Characters menu) might emit.
  s = decodeHtmlEntities(s);

  // Tidy whitespace: trim trailing spaces on lines, collapse 3+ blank lines
  s = s
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n");
  s = s.replace(/\n{3,}/g, "\n\n").trim();

  return s;
}

/**
 * Flatten HTML to readable ONE-LINE text: block boundaries become
 * SPACES (not newlines), remaining tags are dropped, entities decoded.
 *
 * This is the summary-line counterpart of `htmlToPlainText` — used where
 * a tokenized template body has to read like a sentence inside a card.
 * Token braces are untouched, because `{{…}}` is not markup.
 *
 * Note the deliberate difference from `htmlToPlainText`: that one is for
 * a plain-text *document*, this one is for a plain-text *label*. Pick by
 * whether newlines would help or wreck the surface you are rendering to.
 */
export function htmlToInlineText(html: string): string {
  const stripped = html
    .replace(/<\s*(br|\/p|\/div|\/li|\/h[1-6]|\/tr)\s*\/?\s*>/gi, " ")
    .replace(/<[^>]*>/g, "");
  return decodeHtmlEntities(stripped);
}

/** Collapse all whitespace (incl. newlines) into single spaces. */
export function toSingleLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}
