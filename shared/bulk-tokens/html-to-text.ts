/**
 * Convert sanitized rich-text HTML (the subset our editor allows:
 * strong/b/em/i/u/ul/ol/li/br/p/a) into a plain-text representation
 * suitable for an email plain-text fallback or for storing in a
 * plain-text body column.
 *
 * Pure string/regex implementation so it works in both the browser
 * and Node without a DOM dependency.
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
  const namedEntities: Record<string, string> = {
    nbsp: " ",
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    copy: "©",
    reg: "®",
    trade: "™",
    bull: "•",
    ndash: "–",
    mdash: "—",
    hellip: "…",
    sect: "§",
    para: "¶",
    deg: "°",
    ldquo: "\u201C",
    rdquo: "\u201D",
    lsquo: "\u2018",
    rsquo: "\u2019",
  };
  s = s.replace(/&([a-zA-Z]+);/g, (m, name: string) => namedEntities[name] ?? m);
  // Numeric entities (decimal and hex)
  s = s.replace(/&#(\d+);/g, (_m, n: string) => {
    const code = parseInt(n, 10);
    return Number.isFinite(code) ? String.fromCodePoint(code) : _m;
  });
  s = s.replace(/&#x([0-9a-fA-F]+);/g, (_m, n: string) => {
    const code = parseInt(n, 16);
    return Number.isFinite(code) ? String.fromCodePoint(code) : _m;
  });

  // Tidy whitespace: trim trailing spaces on lines, collapse 3+ blank lines
  s = s
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n");
  s = s.replace(/\n{3,}/g, "\n\n").trim();

  return s;
}
