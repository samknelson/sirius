// These are I/O boundaries only. Never replace Puppeteer, browser evaluation,
// sanitization, defaults composition, preview handlers, queue, or PDF handling.
export const boundaries = [
  "server/config/env-registry", "server/logger", "server/storage",
  "server/services/access-policy-evaluator", "server/modules/masquerade",
  "server/flood/service", "server/flood/events", "server/services/comm/letter-images",
];
export async function resolve(specifier, context, nextResolve) {
  const normalized = new URL(specifier, context.parentURL ?? import.meta.url).pathname.replace(/\.(ts|js)$/, "");
  if (boundaries.some((path) => normalized.endsWith(`/${path}`))) {
    return { url: new URL("./postal-runtime-stubs.mjs", import.meta.url).href, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
