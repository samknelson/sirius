import { isDeepStrictEqual } from "node:util";

/** Mirror jsonb_strip_nulls: object nulls disappear, array nulls remain. */
function stripNulls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripNulls);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).filter(([, item]) => item !== null)
        .map(([key, item]) => [key, stripNulls(item)]),
    );
  }
  return value;
}

/** A no-op re-save is still audited, but does not change assignment provenance. */
export function assignmentUpdateMetadataMode(
  before: { data: unknown } | undefined,
  result: { data: unknown } | undefined,
): "modified" | "none" {
  if (!before || !result) return "none";
  return isDeepStrictEqual(stripNulls(before.data ?? {}), stripNulls(result.data ?? {}))
    ? "none"
    : "modified";
}

/** A refused/stale answer did not change the assignment. */
export function assignmentAnswerMetadataMode(recorded: boolean): "modified" | "none" {
  return recorded === true ? "modified" : "none";
}