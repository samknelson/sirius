import type { JsonSchema } from "@shared/json-schema-form";
import { SchemaView } from "@/components/json-schema-form";

export interface ChargeConfigSummaryProps {
  configSchema?: JsonSchema;
  settings: Record<string, unknown>;
  configId: string;
}

/**
 * Generic, schema-driven summary for a charge plugin configuration row.
 * Scalar / enum / remote-option fields are rendered by `SchemaView`
 * (which resolves option ids to labels). Array-table fields (rate
 * history, price ladders) are summarised as a count line rather than
 * dumped row-by-row. Replaces the old per-plugin Summary.tsx components.
 */
export function ChargeConfigSummary({
  configSchema,
  settings,
  configId,
}: ChargeConfigSummaryProps) {
  const props = configSchema?.properties ?? {};
  const arrayTableKeys: string[] = [];
  for (const [key, sub] of Object.entries(props)) {
    if ((sub as Record<string, unknown>)["x-widget"] === "array-table") {
      arrayTableKeys.push(key);
    }
  }

  if (!configSchema) return null;

  return (
    <div className="space-y-1" data-testid={`summary-${configId}`}>
      <SchemaView
        schema={configSchema}
        value={settings}
        omitKeys={arrayTableKeys}
        hideEmpty
        testIdPrefix={`summary-${configId}`}
      />
      {arrayTableKeys.map((key) => {
        const sub = props[key] as JsonSchema;
        const value = settings?.[key];
        const count = Array.isArray(value) ? value.length : 0;
        if (count === 0) return null;
        return (
          <p key={key} data-testid={`summary-${configId}-${key}`}>
            <strong>{sub.title || key}:</strong> {count}{" "}
            {count === 1 ? "entry" : "entries"}
          </p>
        );
      })}
    </div>
  );
}
