/**
 * The ONE postal letter shell, deliberately import-free for lean boot.
 *
 * Lob's letter design specification (letter_template_updated 4_25.pdf):
 * US Letter, no bleed, 1/16" clear at every edge. Page 1 is overprinted
 * with a 3.15" × 2" address/barcode knockout at (0.6", 0.84").
 * Its lower edge is 2.84"; our body starts at 3". DO NOT reclaim this
 * reserve: content there is covered by the provider, not merely hidden
 * by the envelope. A bottom-left data matrix/serial column also needs
 * clearance; the 1" side margin keeps the body away from page markers.
 *
 * Real Lob test proofs ignore @page margins and repeated headers/footers
 * and can split a line across sheets. Consequently this HTML is NEVER
 * submitted to Lob for rendering: the shared server renderer prints it
 * to PDF with Chromium, which honors the rules below. Both preview and
 * send use that renderer; only the preview adds visible guides.
 */
export const LETTER_PAGE_GEOMETRY = {
  sheetWidthIn: 8.5,
  sheetHeightIn: 11,
  clearSpaceIn: 0.0625,
  addressBlock: { leftIn: 0.6, topIn: 0.84, widthIn: 3.15, heightIn: 2 },
  sideMarginIn: 1,
  topMarginIn: 1,
  bottomMarginIn: 1,
  firstPageBodyTopIn: 3,
} as const;

export const LETTER_PAGE_MARKER = "sirius-letter-page-v2";
const G = LETTER_PAGE_GEOMETRY;

export const LETTER_PAGE_HTML = `<!DOCTYPE html>
<!-- ${LETTER_PAGE_MARKER} -->
<html>
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
  <style>
    @page {
      size: ${G.sheetWidthIn}in ${G.sheetHeightIn}in;
      margin: ${G.topMarginIn}in ${G.sideMarginIn}in ${G.bottomMarginIn}in;
    }
    /* First sheet ONLY: Lob will overprint the reserved band. */
    @page :first { margin-top: ${G.firstPageBodyTopIn}in; }
    html, body { margin: 0; padding: 0; }
    body {
      font-family: 'Liberation Sans', Arial, sans-serif;
      font-size: 12pt;
      line-height: 1.5;
      color: #333;
      overflow-wrap: anywhere;
    }
    p { margin: 0 0 12pt; orphans: 2; widows: 2; }
    h1, h2, h3, h4, h5, h6 { break-after: avoid; }
    table { width: 100%; table-layout: fixed; border-collapse: collapse; }
    th, td { overflow-wrap: anywhere; vertical-align: top; padding: 3pt; }
    thead { display: table-header-group; }
    img { max-width: 100%; height: auto; }
    a { color: inherit; text-decoration: underline; }
    .date { margin-bottom: 24pt; }
    .greeting { margin-bottom: 12pt; }
    .closing { margin-top: 24pt; }
  </style>
</head>
<body>
<div class="letter-body">
{{BODY}}
</div>
</body>
</html>`;

const [PAGE_PREFIX, PAGE_SUFFIX] = LETTER_PAGE_HTML.split("{{BODY}}");

/** Wrapping alone does not sanitize. The server renderer sanitizes the body. */
export function wrapLetterPage(body: string): string {
  return PAGE_PREFIX + body + PAGE_SUFFIX;
}

/** A marker alone is NOT proof of a standard shell. */
export function isLetterPage(file: string): boolean {
  return file.startsWith(PAGE_PREFIX) && file.endsWith(PAGE_SUFFIX);
}

/** Extract only a byte-for-byte standard shell; never trust a supplied marker. */
export function unwrapLetterPage(file: string): string {
  return isLetterPage(file)
    ? file.slice(PAGE_PREFIX.length, -PAGE_SUFFIX.length)
    : file;
}

/** Remote files are already-rendered documents, not composed letter bodies. */
export function isRemoteLetterDocument(file: string): boolean {
  return /^https?:\/\/\S+$/i.test(file.trim());
}

export function ensureLetterPage(
  file: string,
): { ok: true; file: string } | { ok: false; error: string } {
  if (isRemoteLetterDocument(file)) return { ok: true, file: file.trim() };
  const body = unwrapLetterPage(file);
  // Whole documents and body-breaking fragments cannot supply their own shell.
  // The renderer additionally sanitizes every accepted body (including a
  // canonical shell's body), constraining CSS and removing active markup.
  if (/<\/?(?:html|head|body)(?:\s|>)|<!doctype/i.test(body)) {
    return {
      ok: false,
      error: "Send only the letter body, not a whole HTML document. The standard letter page supplies margins and the reserved address area.",
    };
  }
  return { ok: true, file: wrapLetterPage(body) };
}