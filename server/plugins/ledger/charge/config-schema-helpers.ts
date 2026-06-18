import type { JsonSchema } from "@shared/json-schema-form";

/**
 * Shared JSON Schema fragments for charge-plugin `configSchema`s.
 *
 * The `rateHistoryField` builder produces an effective-dated rate ladder
 * rendered by the client's generic `array-table` field (vendor key
 * `x-widget: "array-table"`). Every plugin that historically used the
 * bespoke RateHistorySection now declares this fragment instead, so the
 * server schema is the single source of truth.
 */
export function rateHistoryField(opts?: {
  title?: string;
  description?: string;
  /** When true, each rate must be strictly greater than zero. */
  ratePositive?: boolean;
}): JsonSchema {
  const rate: JsonSchema = {
    type: "number",
    title: "Rate",
  };
  if (opts?.ratePositive) {
    rate.exclusiveMinimum = 0;
  }
  return {
    type: "array",
    title: opts?.title ?? "Rate History",
    description:
      opts?.description ??
      "Effective-dated rates. The most recent entry on or before a given date applies.",
    minItems: 1,
    default: [{ effectiveDate: "", rate: 0 }],
    "x-widget": "array-table",
    "x-sort-desc": "effectiveDate",
    items: {
      type: "object",
      required: ["effectiveDate", "rate"],
      properties: {
        effectiveDate: {
          type: "string",
          title: "Effective Date",
          format: "date",
          pattern: "^\\d{4}-\\d{2}-\\d{2}$",
        },
        rate,
      },
    },
  };
}
