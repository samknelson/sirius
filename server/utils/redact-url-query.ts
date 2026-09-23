const SENSITIVE_QUERY_KEYS = new Set(["token"]);
const REDACTED = "(redacted)";

/**
 * Preserve a request URL for diagnostics without persisting link credentials.
 * Accepts relative request URLs as well as absolute URLs.
 */
export function redactSensitiveUrlQuery(rawUrl: string): string {
  try {
    const absolute = /^[a-z][a-z0-9+.-]*:\/\//i.test(rawUrl);
    const parsed = new URL(rawUrl, "http://request.local");
    for (const key of Array.from(parsed.searchParams.keys())) {
      if (SENSITIVE_QUERY_KEYS.has(key.toLowerCase())) {
        parsed.searchParams.set(key, REDACTED);
      }
    }
    return absolute
      ? parsed.toString()
      : `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return rawUrl.replace(
      /([?&]token=)[^&#]*/gi,
      `$1${encodeURIComponent(REDACTED)}`,
    );
  }
}