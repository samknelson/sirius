// Deliberately no database, provider, or application boot dependencies.
import { existsSync } from "node:fs";
export const saved = new Map([
  ["message_defaults:postal", { letterheadHtml: "<p>SAVEDHEAD</p>", footerHtml: "<p>SAVEDFOOT</p>", showPageCount: true }],
]);
export const logs = [];
export const logger = { error: (...args) => logs.push(args), warn: (...args) => logs.push(args) };
export const storageLogger = logger;
export const storage = { variables: {
  getByName: async (name) => ({ value: structuredClone(saved.get(name)) }),
  setByName: async () => { throw new Error("Preview must never write"); },
} };
export const getEnvironmentVariable = (name) => name === "CHROMIUM_EXECUTABLE_PATH"
  ? ["/repl/tools/bin/chromium", "/usr/bin/chromium"].find(existsSync) : undefined;
export const PUBLIC_URL_LOCAL_FALLBACK = "http://localhost:5000";
export const requireAccess = () => (_req, _res, next) => next();
export const getEffectiveUser = async () => ({ dbUser: { id: "fixture" } });
export const checkFlood = async () => ({ allowed: true });
export const recordFloodEvent = async () => {};
export const POSTAL_PDF_PREVIEW_FLOOD_EVENT = "fixture-postal-preview";
export const prepareLetterImages = async (sources, onDimensions) => sources.map((_, index) => {
  onDimensions(index, 1, 1);
  return "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9ioAAAAASUVORK5CYII=";
});
