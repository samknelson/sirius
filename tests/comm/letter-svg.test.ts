import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import { convertLetterSvg, validateLetterSvg } from "../../server/services/comm/letter-svg";
import { letterFailureContext } from "../../server/services/comm/letter-image-error";

const wrap = (body: string, attrs = 'width="240" height="56.75"') =>
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${body}</svg>`);

describe("bounded static letter SVG", () => {
  it("converts the actual path/group/transform logo with transparent background at 300 DPI", async () => {
    const svg = readFileSync(new URL("./fixtures/benefits11-logo.svg", import.meta.url));
    expect(validateLetterSvg(svg)).toMatchObject({ width: 240, height: 56.75 });
    const converted = await convertLetterSvg(svg);
    const png = converted.bytes;
    expect(png.readUInt32BE(16)).toBe(750);
    expect(png.readUInt32BE(20)).toBeGreaterThanOrEqual(177);
    expect(png.readUInt32BE(20)).toBeLessThanOrEqual(178);
    // resvg emits RGBA PNG; first scanline pixel is transparent. IDAT is real.
    expect(png[25]).toBe(6);
    const chunks: Buffer[] = [];
    for (let offset = 8; offset < png.length;) {
      const size = png.readUInt32BE(offset);
      if (png.toString("ascii", offset + 4, offset + 8) === "IDAT") chunks.push(png.subarray(offset + 8, offset + 8 + size));
      offset += size + 12;
    }
    const raw = inflateSync(Buffer.concat(chunks));
    expect(raw[0]).toBeLessThanOrEqual(4);
    // For the first pixel of the first row, all PNG predictors are zero.
    expect(raw[4]).toBe(0);
    expect(raw.some((value) => value !== 0)).toBe(true);
  });

  it("preserves local gradients, clips, masks and ordinary inline presentation styles", async () => {
    const svg = wrap(`<defs>
      <linearGradient id="base"><stop offset="0" stop-color="#ff0000"/><stop offset="1" stop-color="#0000ff"/></linearGradient>
      <linearGradient id="paint" href="#base"/>
      <clipPath id="clip"><rect width="200" height="40"/></clipPath>
      <mask id="mask"><rect width="240" height="56" fill="white"/></mask>
      </defs><rect width="240" height="56" style="fill:url(#paint);opacity:0.9" clip-path="url(#clip)" mask="url(#mask)"/>`);
    expect((await convertLetterSvg(svg)).bytes.length).toBeGreaterThan(100);
  });

  it.each([
    "<script>alert(1)</script>",
    '<g onclick="alert(1)"/>',
    '<foreignObject><div xmlns="http://www.w3.org/1999/xhtml">active</div></foreignObject>',
    '<image href="https://secondary.example/image.png"/>',
    '<image href="file:///etc/passwd"/>',
    '<image href="data:image/png;base64,AAAA"/>',
    '<use href="#x"/>',
    '<animate attributeName="x" dur="1s"/>',
    '<text font-family="private-font">font</text>',
    '<style>@import "https://secondary.example/style.css";</style>',
    '<rect style="fill:url(https://secondary.example/image)"/>',
    '<rect style="fill:u\\72l(https://secondary.example/image)"/>',
    '<rect fill="url(&#104;ttps://secondary.example/image)"/>',
    '<rect fill="url(file:///etc/passwd)"/>',
    '<rect xml:base="https://secondary.example/"/>',
    '<filter id="huge"><feGaussianBlur stdDeviation="999999"/></filter>',
    '<linearGradient id="a" href="#b"/><linearGradient id="b" href="#a"/>',
    '<rect fill="url(#missing)"/>',
    '<?xml-stylesheet href="https://secondary.example/style.css"?>',
  ])("rejects active or secondary-resource content before conversion: %s", async (body) => {
    await expect(convertLetterSvg(wrap(body))).rejects.toThrow();
  });

  it.each([
    '<!DOCTYPE svg SYSTEM "file:///etc/passwd">',
    '<!DOCTYPE svg [<!ENTITY x SYSTEM "https://secondary.example/secret">]>',
    '<!DOCTYPE svg [<!ENTITY a "large"><!ENTITY b "&a;&a;&a;">]>',
  ])("rejects XML entities and DTDs", (prefix) => {
    expect(() => validateLetterSvg(Buffer.concat([Buffer.from(prefix), wrap("")]))).toThrow("entities");
  });

  it("rejects malformed XML, byte/pixel/geometry/nesting/element bombs", () => {
    for (const svg of [
      Buffer.from("<svg>"),
      wrap("", 'width="0" height="10"'),
      wrap("", 'width="999999" height="999999"'),
      wrap("", 'viewBox="0 0 1e300 1e300"'),
      wrap('<path d="M1e999 0"/>'),
      wrap("<g>".repeat(33) + "</g>".repeat(33)),
      wrap("<rect/>".repeat(2001)),
      wrap(`<path d="M${"1 1 ".repeat(31000)}"/>`),
      Buffer.alloc(1024 * 1024 + 1),
      Buffer.from([0xff, 0xfe, 0x00]),
    ]) expect(() => validateLetterSvg(svg)).toThrow();
  });

  it("supports viewBox-only and physical dimensions", () => {
    expect(validateLetterSvg(wrap("", 'viewBox="0 0 240 56.75"'))).toMatchObject({ width: 240, height: 56.75 });
    expect(validateLetterSvg(wrap("", 'width="2.5in" height="42.5625pt"'))).toMatchObject({ width: 240, height: 56.75 });
  });

  it("logs only fixed diagnostic fields, never arbitrary error text", () => {
    expect(JSON.stringify(letterFailureContext(new Error("https://user:password@example/a?signature=canary"), "browser")))
      .toBe('{"stage":"browser","category":"unexpected"}');
  });
});
