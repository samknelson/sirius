import type { JsonSchema } from "@shared/json-schema-form";

/**
 * One-time display sort for `x-widget: "array-table"` arrays inside a
 * settings payload. Each top-level array property declaring `x-sort-asc`
 * or `x-sort-desc` is sorted by the named item column before the form is
 * opened, so e.g. rate history shows newest-effective-date first. The
 * stored order is otherwise irrelevant — runtime pricing logic sorts
 * internally — so this is purely cosmetic and runs at load only.
 */
export function sortArrayTableSettings(
  schema: JsonSchema,
  settings: Record<string, unknown>,
): Record<string, unknown> {
  const props = schema.properties;
  if (!props || !settings || typeof settings !== "object") return settings;
  const out: Record<string, unknown> = { ...settings };
  for (const [name, sub] of Object.entries(props)) {
    const subAny = sub as Record<string, unknown>;
    if (subAny["x-widget"] !== "array-table") continue;
    const arr = out[name];
    if (!Array.isArray(arr)) continue;
    const asc = subAny["x-sort-asc"] as string | undefined;
    const desc = subAny["x-sort-desc"] as string | undefined;
    const key = asc ?? desc;
    if (!key) continue;
    const dir = desc ? -1 : 1;
    out[name] = [...arr].sort((a, b) => {
      const av = (a as Record<string, unknown>)?.[key];
      const bv = (b as Record<string, unknown>)?.[key];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
  }
  return out;
}
