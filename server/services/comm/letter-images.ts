import { downloadPublicHttpsResource } from "./remote-letter-pdf";
import { assertExternalServiceAllowed } from "../maintenance-flag";

export const MAX_LETTER_IMAGES = 10;
const MAX_IMAGE_BYTES = 1024 * 1024;
const MAX_TOTAL_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 16_000_000;

function fail(message: string): never {
  throw new Error(`Letter image refused: ${message}`);
}

/** Read dimensions before a decoder can allocate unbounded pixel buffers. */
export function rasterImageType(bytes: Buffer): "image/png" | "image/jpeg" {
  let width = 0;
  let height = 0;
  let type: "image/png" | "image/jpeg";
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    type = "image/png";
    if (bytes.toString("ascii", 12, 16) !== "IHDR") fail("invalid PNG header.");
    width = bytes.readUInt32BE(16);
    height = bytes.readUInt32BE(20);
  } else if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    type = "image/jpeg";
    let offset = 2;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset++] !== 0xff) fail("invalid JPEG marker.");
      while (bytes[offset] === 0xff) offset++;
      if (offset + 3 > bytes.length) fail("truncated JPEG marker.");
      const marker = bytes[offset++];
      if (marker === 0xda || marker === 0xd9) break;
      const length = bytes.readUInt16BE(offset);
      if (length < 2 || offset + length > bytes.length) fail("invalid JPEG segment.");
      if ([0xc0, 0xc1, 0xc2].includes(marker)) {
        if (length < 8) fail("invalid JPEG dimensions.");
        height = bytes.readUInt16BE(offset + 3);
        width = bytes.readUInt16BE(offset + 5);
        break;
      }
      offset += length;
    }
  } else {
    return fail("only PNG and JPEG raster images are supported.");
  }
  if (!width || !height || width > 8192 || height > 8192 || width * height > MAX_IMAGE_PIXELS) {
    fail("image dimensions are invalid or exceed the 16 megapixel / 8192 pixel limit.");
  }
  return type;
}

/**
 * Resolve images outside Chromium. HTTPS uses public IPv4 DNS validation and
 * a pinned socket for every redirect. Relative URLs, SVG, data URLs and all
 * browser-origin credentials are deliberately unsupported.
 */
export async function prepareLetterImages(sources: string[]): Promise<string[]> {
  if (sources.length > MAX_LETTER_IMAGES) fail(`at most ${MAX_LETTER_IMAGES} images are allowed.`);
  if (!sources.length) return [];
  assertExternalServiceAllowed("Lob", "download letter images");
  let total = 0;
  const unique = [...new Set(sources)];
  const results = await Promise.all(unique.map(async (source) => {
    try {
      const bytes = await downloadPublicHttpsResource(source, {
        contentTypes: ["image/png", "image/jpeg"],
        maxBytes: MAX_IMAGE_BYTES,
      });
      total += bytes.length;
      if (total > MAX_TOTAL_IMAGE_BYTES) fail("images exceed the combined 5 MB limit.");
      const type = rasterImageType(bytes);
      return `data:${type};base64,${bytes.toString("base64")}`;
    } catch (error) {
      // Do not expose query strings that may contain a signed resource token.
      throw new Error(`Could not load letter image ${unique.indexOf(source) + 1}: ${error instanceof Error ? error.message : "download failed"}`);
    }
  }));
  const bySource = new Map(unique.map((source, index) => [source, results[index]]));
  return sources.map((source) => bySource.get(source)!);
}