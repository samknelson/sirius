import { isDeepStrictEqual } from "node:util";

/** Compare only supplied, import-owned fields, never generated row metadata. */
export function importedFieldsDiffer(
  actual: object,
  desired: object,
  excluded: readonly string[] = [],
): boolean {
  const row = actual as Record<string, unknown>;
  return Object.entries(desired).some(([key, value]) =>
    !excluded.includes(key)
    && value !== undefined
    && !isDeepStrictEqual(row[key] ?? null, value ?? null),
  );
}
