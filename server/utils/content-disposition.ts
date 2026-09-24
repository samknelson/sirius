/**
 * Build a safe Content-Disposition header value for downloads.
 *
 * File names can contain double quotes, control characters (including CR/LF,
 * which would allow header splitting), or non-ASCII unicode that older
 * header-encoding paths mangle. This helper emits both a conservative ASCII
 * `filename` fallback and an RFC 5987 `filename*` parameter so modern
 * browsers restore the original (sanitized) unicode name.
 */
export function buildContentDisposition(
  disposition: "attachment" | "inline",
  rawName: string,
): string {
  // Strip control characters (0x00-0x1F, 0x7F) outright — they are never
  // legitimate in a file name and are the header-splitting vector.
  // eslint-disable-next-line no-control-regex
  let name = rawName.replace(/[\x00-\x1f\x7f]/g, "").trim();
  if (!name) name = "download";

  // ASCII fallback: replace quotes/backslashes and any non-ASCII char.
  const asciiFallback =
    name
      .replace(/[^\x20-\x7e]/g, "_")
      .replace(/["\\]/g, "_")
      .trim() || "download";

  // RFC 5987 percent-encoded UTF-8 form.
  const encoded = encodeRfc5987(name);

  return `${disposition}; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
}

function encodeRfc5987(value: string): string {
  return encodeURIComponent(value)
    // encodeURIComponent leaves these unescaped, but RFC 5987 attr-char
    // does not include them.
    .replace(/['()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}
