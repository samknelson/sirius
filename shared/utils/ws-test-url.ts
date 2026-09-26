/** The only relative destination accepted by the admin web-service tester. */
export const DEFAULT_WS_TEST_BASE = "/api/ws/";

export function isLocalWsTestBase(base: string): boolean {
  return base.trim() === DEFAULT_WS_TEST_BASE || base.trim() === "/api/ws";
}

/** The base is a web-service prefix, not a completed operation URL. */
export function normalizeWsTestBase(base: string): string {
  const value = base.trim();
  if (isLocalWsTestBase(value)) return DEFAULT_WS_TEST_BASE;
  if (!value || value.length > 2048) throw new Error("Enter a web service base URL");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Use /api/ws/ or a full HTTP(S) web service URL");
  }
  if (!["http:", "https:"].includes(url.protocol) || !url.hostname
      || url.username || url.password || url.search || url.hash) {
    throw new Error("Use an HTTP(S) URL without credentials, query parameters, or a fragment");
  }
  const path = url.pathname === "/" ? DEFAULT_WS_TEST_BASE : `${url.pathname.replace(/\/+$/, "")}/`;
  return `${url.origin}${path}`;
}

export function buildWsTestUrl(
  base: string,
  service: string,
  operation: string,
  queryParams?: Record<string, string>,
  localOrigin = "",
): string {
  const prefix = normalizeWsTestBase(base);
  const absolutePrefix = prefix === DEFAULT_WS_TEST_BASE && localOrigin
    ? `${localOrigin.replace(/\/+$/, "")}${prefix}`
    : prefix;
  const query = queryParams && Object.keys(queryParams).length
    ? `?${new URLSearchParams(queryParams).toString()}`
    : "";
  return `${absolutePrefix}${encodeURIComponent(service)}/${encodeURIComponent(operation)}${query}`;
}