/**
 * An unfilled hours cell means zero, including whitespace-only spreadsheet
 * cells and a standalone "-" placeholder. Preserve other nonblank values so
 * normal numeric validation can reject bad input rather than hiding it.
 */
export function defaultBlankHours<T>(value: T): T | 0 {
  return value === null || value === undefined ||
    (typeof value === "string" && (value.trim() === "" || value.trim() === "-")) ? 0 : value;
}
