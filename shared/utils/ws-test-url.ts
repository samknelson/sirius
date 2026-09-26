/** The only destination used by the admin web-service tester. */
export const DEFAULT_WS_TEST_BASE = "/api/ws/";

export function buildWsTestUrl(
  service: string,
  operation: string,
  queryParams?: Record<string, string>,
): string {
  if ([".", ".."].includes(service) || [".", ".."].includes(operation)) {
    throw new Error("Invalid web service address");
  }
  const query = queryParams && Object.keys(queryParams).length
    ? `?${new URLSearchParams(queryParams).toString()}`
    : "";
  return `${DEFAULT_WS_TEST_BASE}${encodeURIComponent(service)}/${encodeURIComponent(operation)}${query}`;
}