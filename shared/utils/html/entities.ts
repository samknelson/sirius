/**
 * HTML entity decoding — dependency-free.
 *
 * The inverse direction of `./escape.ts`: turns `&amp;` back into `&`.
 * Used by the HTML→text conversions in `./to-text.ts`, which are the
 * only callers that should need it — decoding entities into a string
 * that is then re-inserted into HTML would undo escaping.
 *
 * No imports here either, for the same boot-path reason as `./escape.ts`.
 */

/**
 * The named entities our rich-text editor and its "Special Characters"
 * menu can emit. Intentionally small: this is a decoder for OUR content,
 * not a complete HTML5 entity table.
 *
 * Lookup is case-sensitive, matching HTML5 (`&amp;` is an entity,
 * `&AMP;` is not).
 */
export const HTML_NAMED_ENTITIES: Readonly<Record<string, string>> = {
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

/**
 * Is `code` something `String.fromCodePoint` will actually accept?
 *
 * `Number.isFinite` is NOT this test, and the difference is a thrown
 * exception rather than a wrong character: `String.fromCodePoint` raises
 * `RangeError: Invalid code point` for anything above U+10FFFF, so a
 * stored `&#999999999;` would take down whatever was decoding it. Lone
 * surrogates are excluded too — they are not scalar values, and pasting
 * one into a string produces an unpaired half that breaks later encoding.
 *
 * This function must stay TOTAL: it is called on hostile stored content
 * during render, where the only acceptable outcomes are "decoded" and
 * "left alone", never "threw".
 */
function isUnicodeScalarValue(code: number): boolean {
  return (
    Number.isInteger(code) &&
    code >= 0 &&
    code <= 0x10ffff &&
    !(code >= 0xd800 && code <= 0xdfff)
  );
}

/**
 * Decode the named entities above plus decimal (`&#8212;`) and
 * hexadecimal (`&#x2014;`) numeric references. Anything unrecognized —
 * an unknown name, an out-of-range code point, a surrogate half — is
 * left verbatim, so it survives a round trip instead of silently
 * vanishing or throwing.
 */
export function decodeHtmlEntities(s: string): string {
  return s
    .replace(
      /&([a-zA-Z]+);/g,
      (match, name: string) => HTML_NAMED_ENTITIES[name] ?? match,
    )
    .replace(/&#(\d+);/g, (match, digits: string) => {
      const code = parseInt(digits, 10);
      return isUnicodeScalarValue(code) ? String.fromCodePoint(code) : match;
    })
    .replace(/&#x([0-9a-fA-F]+);/g, (match, hex: string) => {
      const code = parseInt(hex, 16);
      return isUnicodeScalarValue(code) ? String.fromCodePoint(code) : match;
    });
}
