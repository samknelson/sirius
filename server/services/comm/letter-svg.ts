import { Worker } from "node:worker_threads";
import { createRequire } from "node:module";
import { SaxesParser } from "saxes";
import { LetterImageError } from "./letter-image-error";

const SVG_NS = "http://www.w3.org/2000/svg";
const XLINK_NS = "http://www.w3.org/1999/xlink";
const MAX_SOURCE_BYTES = 1024 * 1024;
const MAX_PNG_BYTES = 1024 * 1024;
const SCALE = 300 / 96;
export const SVG_CONVERSION_TIMEOUT_MS = 5_000;
const elements = new Set([
  "svg", "g", "defs", "path", "rect", "circle", "ellipse", "line",
  "polyline", "polygon", "clipPath", "mask", "linearGradient", "radialGradient", "stop", "title", "desc",
]);
const attributes = new Set([
  "id", "data-name", "version", "width", "height", "viewBox", "preserveAspectRatio",
  "x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry", "fx", "fy",
  "d", "points", "transform", "gradientTransform", "gradientUnits", "spreadMethod",
  "offset", "stop-color", "stop-opacity", "fill", "fill-opacity", "fill-rule",
  "stroke", "stroke-width", "stroke-opacity", "stroke-linecap", "stroke-linejoin",
  "stroke-miterlimit", "stroke-dasharray", "stroke-dashoffset", "opacity",
  "clip-path", "clip-rule", "clipPathUnits", "mask", "maskUnits", "maskContentUnits",
  "color", "display", "visibility", "style", "href",
]);
const styleProperties = new Set([
  "fill", "fill-opacity", "fill-rule", "stroke", "stroke-width", "stroke-opacity",
  "stroke-linecap", "stroke-linejoin", "stroke-miterlimit", "stroke-dasharray",
  "stroke-dashoffset", "opacity", "stop-color", "stop-opacity", "clip-path",
  "clip-rule", "mask", "color", "display", "visibility",
]);

function refuse(category: ConstructorParameters<typeof LetterImageError>[0], message: string): never {
  throw new LetterImageError(category, message);
}

function dimension(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const match = /^(\d+(?:\.\d+)?)(px|in|cm|mm|pt|pc)?$/.exec(value.trim());
  if (!match) refuse("dimensions", "SVG dimensions must be explicit positive lengths or a viewBox.");
  const units: Record<string, number> = { px: 1, in: 96, cm: 96 / 2.54, mm: 96 / 25.4, pt: 96 / 72, pc: 16 };
  return Number(match[1]) * (units[match[2] ?? "px"]);
}

/** Fail-closed static, path-based SVG subset. No CSS sheets, fonts, images,
 * use expansion, filters, foreign markup, entities, or resource loaders. */
export function validateLetterSvg(bytes: Buffer): { svg: string; width: number; height: number } {
  if (bytes.length > MAX_SOURCE_BYTES) refuse("size", "SVG exceeds the 1 MB source limit.");
  let svg: string;
  try { svg = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { return refuse("invalid", "SVG must be valid UTF-8 XML."); }
  if (/<!DOCTYPE|<!ENTITY/i.test(svg)) refuse("unsafe-svg", "SVG document types and entities are not allowed.");
  const parser = new SaxesParser({ xmlns: true });
  let depth = 0;
  let nodes = 0;
  let numbers = 0;
  let referenceCount = 0;
  let root: Record<string, string> | undefined;
  const ids = new Set<string>();
  const edges = new Map<string, string[]>();
  const owners: string[] = [];
  const references: string[] = [];
  parser.on("doctype", () => refuse("unsafe-svg", "SVG document types are not allowed."));
  parser.on("processinginstruction", () => refuse("unsafe-svg", "SVG processing instructions are not allowed."));
  parser.on("error", () => refuse("invalid", "SVG is malformed XML."));
  parser.on("opentag", (tag) => {
    depth++;
    if (++nodes > 2000 || depth > 32) refuse("complexity", "SVG has too many elements or nesting levels.");
    if (tag.uri !== SVG_NS || !elements.has(tag.local) || (nodes === 1 && tag.local !== "svg") ||
        (nodes !== 1 && tag.local === "svg")) {
      refuse("unsafe-svg", "SVG contains an unsupported or active element.");
    }
    const values: Record<string, string> = {};
    for (const attr of Object.values(tag.attributes)) {
      if (attr.uri === "http://www.w3.org/2000/xmlns/") {
        if (![SVG_NS, XLINK_NS].includes(attr.value)) refuse("unsafe-svg", "SVG has an unsupported namespace.");
        continue;
      }
      if ((attr.uri && !(attr.uri === XLINK_NS && attr.local === "href")) || !attributes.has(attr.local)) {
        refuse("unsafe-svg", "SVG contains an unsupported or active attribute.");
      }
      values[attr.local] = attr.value;
    }
    if (values.id) {
      if (!/^[A-Za-z_][\w.-]{0,127}$/.test(values.id) || ids.has(values.id)) refuse("invalid", "SVG has invalid or duplicate identifiers.");
      ids.add(values.id);
    }
    const owner = values.id ?? owners[owners.length - 1] ?? "$root";
    owners.push(owner);
    const checkValue = (name: string, value: string) => {
      if (value.length > 128_000) refuse("complexity", "SVG attribute complexity exceeds the limit.");
      if (name === "id" || name === "data-name") return;
      // Disallow CSS escapes/comments/control characters; no obfuscated URLs.
      if (/[\\<>\u0000-\u0008\u000b\u000c\u000e-\u001f]|\/\*|@/u.test(value)) refuse("unsafe-svg", "SVG contains unsafe attribute syntax.");
      const addReference = (id: string) => {
        if (++referenceCount > 2000) refuse("complexity", "SVG has too many local references.");
        references.push(id);
        edges.set(owner, [...(edges.get(owner) ?? []), id]);
      };
      if (name === "href") {
        if (!["linearGradient", "radialGradient"].includes(tag.local) || !/^#[A-Za-z_][\w.-]*$/.test(value)) {
          refuse("unsafe-svg", "SVG may reference only local gradient fragments.");
        }
        addReference(value.slice(1));
      } else if (/url\s*\(/i.test(value)) {
        const match = /^url\(\s*#([A-Za-z_][\w.-]*)\s*\)$/.exec(value);
        if (!match || !["fill", "stroke", "clip-path", "mask"].includes(name)) refuse("unsafe-svg", "SVG external resources are not allowed.");
        addReference(match[1]);
      } else if (/:|https?|file|data\s*\(/i.test(value)) {
        refuse("unsafe-svg", "SVG external resources are not allowed.");
      }
      for (const numeric of value.matchAll(/[-+]?(?:\d*\.)?\d+(?:e[-+]?\d+)?/gi)) {
        if (++numbers > 60_000 || Math.abs(Number(numeric[0])) > 1_000_000) refuse("complexity", "SVG geometry complexity exceeds the limit.");
      }
    };
    for (const [name, value] of Object.entries(values)) {
      if (name === "style") {
        for (const declaration of value.split(";").filter((part) => part.trim())) {
          const match = /^\s*([a-z-]+)\s*:\s*([^:]+)\s*$/.exec(declaration);
          if (!match || !styleProperties.has(match[1])) refuse("unsafe-svg", "SVG contains unsupported inline styles.");
          checkValue(match[1], match[2].trim());
        }
      } else checkValue(name, value);
    }
    if (nodes === 1) root = values;
  });
  parser.on("closetag", () => { depth--; owners.pop(); });
  parser.write(svg).close();
  if (!root) refuse("invalid", "SVG has no root element.");
  if (references.some((id) => !ids.has(id))) refuse("invalid", "SVG refers to a missing local fragment.");
  let visits = 0;
  const walk = (id: string, path: Set<string>) => {
    if (++visits > 5000 || path.size > 32) refuse("complexity", "SVG reference complexity exceeds the limit.");
    if (path.has(id)) refuse("unsafe-svg", "SVG contains circular local references.");
    const next = new Set(path).add(id);
    for (const target of edges.get(id) ?? []) walk(target, next);
  };
  for (const id of edges.keys()) walk(id, new Set());
  const box = root.viewBox?.trim().split(/[\s,]+/).map(Number);
  if (box && (box.length !== 4 || box.some((v) => !Number.isFinite(v)) || box[2] <= 0 || box[3] <= 0)) refuse("dimensions", "SVG viewBox is invalid.");
  let width = dimension(root.width);
  let height = dimension(root.height);
  if (width === undefined && height !== undefined && box) width = height * box[2] / box[3];
  if (height === undefined && width !== undefined && box) height = width * box[3] / box[2];
  width ??= box?.[2];
  height ??= box?.[3];
  if (!width || !height || !Number.isFinite(width + height) ||
      Math.ceil(width * SCALE) > 8192 || Math.ceil(height * SCALE) > 8192 ||
      Math.ceil(width * SCALE) * Math.ceil(height * SCALE) > 16_000_000) {
    refuse("dimensions", "SVG dimensions exceed the 300 DPI / 16 megapixel / 8192 pixel limit.");
  }
  return { svg, width, height };
}

// WASM has no filesystem/network imports. The trusted host loads only the
// package's fixed wasm binary, never an SVG-selected path or font.
const workerCode = `
const { parentPort, workerData } = require("node:worker_threads");
const { readFileSync } = require("node:fs");
(async () => {
  try {
    const { initWasm, Resvg } = require(workerData.modulePath);
    await initWasm(readFileSync(workerData.wasmPath));
    const renderer = new Resvg(workerData.svg, {
      font: { loadSystemFonts: false }, fitTo: { mode: "zoom", value: ${SCALE} }
    });
    if (renderer.imagesToResolve().length) throw new Error("secondary resource");
    if (renderer.width > 8192 || renderer.height > 8192 || renderer.width * renderer.height > 16000000) throw new Error("dimensions");
    const image = renderer.render();
    const png = image.asPng();
    if (png.length > ${MAX_PNG_BYTES}) { parentPort.postMessage({ category: "size" }); }
    else parentPort.postMessage({ png });
    image.free(); renderer.free();
  } catch { parentPort.postMessage({ category: "conversion" }); }
})();
`;

/** Separate V8 isolate: termination interrupts WASM, not just the caller's wait.
 * Await worker exit on every outcome, so queue capacity cannot leak workers. */
export async function convertLetterSvg(bytes: Buffer): Promise<{ bytes: Buffer; width: number; height: number }> {
  const { svg, width, height } = validateLetterSvg(bytes);
  const require = createRequire(import.meta.url);
  const worker = new Worker(workerCode, {
    eval: true,
    execArgv: [],
    workerData: {
      svg, modulePath: require.resolve("@resvg/resvg-wasm"),
      wasmPath: require.resolve("@resvg/resvg-wasm/index_bg.wasm"),
    },
    resourceLimits: { maxOldGenerationSizeMb: 64, maxYoungGenerationSizeMb: 16 },
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const png = await new Promise<Buffer>((resolve, reject) => {
      timer = setTimeout(() => reject(new LetterImageError("timeout", "SVG conversion timed out. Simplify the image and try again.")), SVG_CONVERSION_TIMEOUT_MS);
      worker.once("message", (result: { png?: Uint8Array; category?: string }) => {
        if (result.png) resolve(Buffer.from(result.png));
        else reject(new LetterImageError(result.category === "size" ? "size" : "conversion",
          result.category === "size" ? "Converted SVG exceeds the 1 MB PNG limit." : "SVG could not be converted to a valid image."));
      });
      worker.once("error", () => reject(new LetterImageError("conversion", "SVG converter failed.")));
      worker.once("exit", () => reject(new LetterImageError("conversion", "SVG converter exited before producing an image.")));
    });
    return { bytes: png, width, height };
  } finally {
    clearTimeout(timer);
    await worker.terminate();
  }
}
