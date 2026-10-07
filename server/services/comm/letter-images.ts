import { downloadPublicHttpsResource, RemoteResourceError } from "./remote-letter-pdf";
import { assertExternalServiceAllowed, isMaintenanceModeError } from "../maintenance-flag";
import { convertLetterSvg } from "./letter-svg";
import { LetterImageError } from "./letter-image-error";
import {
  getEnvironmentVariable,
  PUBLIC_URL_LOCAL_FALLBACK,
} from "../../config/env-registry";
import { storage } from "../../storage";
import {
  fileSystemService,
  getFileSystemConfig,
  isFileSystemConfigured,
} from "../files";

export const MAX_LETTER_IMAGES = 10;
export const MAX_LETTER_IMAGE_BYTES = 1024 * 1024;
export const MAX_TOTAL_LETTER_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 16_000_000;

function fail(message: string): never {
  throw new LetterImageError("invalid", `Letter image refused: ${message}`);
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
 * a pinned socket for every redirect. External static SVG is rasterized in an
 * isolated worker. Managed uploads remain raster-only; data URLs and all
 * browser-origin credentials are deliberately unsupported.
 */
export async function prepareLetterImages(
  sources: string[],
  onSvgDimensions?: (index: number, width: number, height: number) => void,
): Promise<string[]> {
  if (sources.length > MAX_LETTER_IMAGES) throw new LetterImageError("size", `At most ${MAX_LETTER_IMAGES} letter images are allowed.`, MAX_LETTER_IMAGES + 1);
  if (!sources.length) return [];
  const internalOrigin = getEnvironmentVariable("PUBLIC_URL") ?? PUBLIC_URL_LOCAL_FALLBACK;
  let total = 0;
  const unique = [...new Set(sources)];
  const results: string[] = [];
  // Sequential preparation bounds WASM memory to one converter per lane and
  // stops immediately on failure (no orphan downloads/conversions).
  for (const source of unique) {
    try {
      const managed = managedAssetPath(source, internalOrigin);
      let bytes: Buffer;
      let contentType: string | undefined;
      if (managed) {
        const { fileSystemId, storagePath } = managed;
        if (!isFileSystemConfigured(fileSystemId) ||
            getFileSystemConfig(fileSystemId).access !== "public") {
          fail("managed image is unavailable.");
        }
        const file = await storage.files.getByStoragePath(storagePath, fileSystemId);
        const legacy = file?.entityType === "template-asset" && storagePath.startsWith("letter-template-assets/");
        const owned = file?.entityType === "entity-files:template_asset" && file.entityId &&
          await storage.entityFiles.assetOwnerExists(file.entityId) &&
          await storage.entityFiles.getByFileId("template_asset", file.entityId, file.id);
        if (!file || file.status !== "live" || (!legacy && !owned) ||
            file.size > MAX_LETTER_IMAGE_BYTES) {
          fail("managed image is unavailable or exceeds the 1 MB limit.");
        }
        bytes = await fileSystemService.download(fileSystemId, storagePath);
        if (bytes.length > MAX_LETTER_IMAGE_BYTES) fail("managed image exceeds the 1 MB limit.");
      } else {
        assertExternalServiceAllowed("Lob", "download letter images");
        bytes = await downloadPublicHttpsResource(source, {
          contentTypes: ["image/png", "image/jpeg", "image/svg+xml"],
          maxBytes: MAX_LETTER_IMAGE_BYTES,
          onContentType: (type) => { contentType = type; },
        });
      }
      total += bytes.length;
      if (total > MAX_TOTAL_LETTER_IMAGE_BYTES) throw new LetterImageError("size", "Images exceed the combined 5 MB source/output limit.");
      if (!managed && contentType === "image/svg+xml") {
        const converted = await convertLetterSvg(bytes);
        bytes = converted.bytes;
        // Account for both downloaded SVG and its retained raster output.
        total += bytes.length;
        if (total > MAX_TOTAL_LETTER_IMAGE_BYTES) throw new LetterImageError("size", "Images exceed the combined 5 MB source/output limit.");
        sources.forEach((value, index) => {
          if (value === source) onSvgDimensions?.(index, converted.width, converted.height);
        });
      }
      const type = rasterImageType(bytes);
      if (contentType && contentType !== "image/svg+xml" && type !== contentType) {
        fail("image bytes do not match the response content type.");
      }
      results.push(`data:${type};base64,${bytes.toString("base64")}`);
    } catch (error) {
      if (isMaintenanceModeError(error)) throw error;
      const index = sources.indexOf(source) + 1;
      if (error instanceof LetterImageError) {
        throw new LetterImageError(error.category, error.message, index, error.transportStatus, error.transportCode);
      }
      if (error instanceof RemoteResourceError) {
        throw new LetterImageError("transport", error.message.replace(/^Remote letter PDF refused: /, ""), index, error.status, error.code);
      }
      // No raw SDK/decoder errors, URLs, credentials or signed queries.
      throw new LetterImageError("unavailable", "Image preparation failed unexpectedly. Ask an administrator to check the letter-rendering logs.", index);
    }
  }
  const bySource = new Map(unique.map((source, index) => [source, results[index]]));
  return sources.map((source) => bySource.get(source)!);
}

/**
 * Managed template images are resolved directly from the app's files service.
 * This deliberately recognizes only the stable public-files URL shape and
 * never performs an HTTP request for these images during postal rendering.
 */
function managedAssetPath(
  source: string,
  publicOrigin: string,
): { fileSystemId: string; storagePath: string } | undefined {
  try {
    const url = source.startsWith("/")
      ? new URL(source, publicOrigin)
      : new URL(source);
    if (url.origin !== new URL(publicOrigin).origin) return undefined;
    const match = /^\/public-files\/([^/]+)\/(.+)$/.exec(url.pathname);
    if (!match) return undefined;
    const fileSystemId = decodeURIComponent(match[1]);
    const storagePath = match[2].split("/").map(decodeURIComponent).join("/");
    if (
      !/^[a-z0-9][a-z0-9_-]*$/i.test(fileSystemId) ||
      storagePath.split("/").some((part) => !part || part === "." || part === ".." || part.includes("\\"))
    ) {
      fail("managed image URL is invalid.");
    }
    return { fileSystemId, storagePath };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Letter image refused:")) throw error;
    return undefined;
  }
}