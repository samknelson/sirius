const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Whether a value has the canonical hyphenated UUID shape.
 *
 * This intentionally validates shape only. It accepts every UUID version and
 * variant, including the nil UUID, to preserve the existing callers' rules.
 */
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

/**
 * Put a canonical UUID's first three groups on one line and its final two
 * groups on the next. Non-UUID strings are returned unchanged so callers can
 * still render unexpected legacy values safely.
 */
export function formatUuidForDisplay(value: string): string {
  if (!isUuid(value)) return value;
  return `${value.slice(0, 19)}\n${value.slice(19)}`;
}