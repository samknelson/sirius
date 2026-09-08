import {
  splitPayloadByDataField,
  type JsonSchema,
} from "@shared/json-schema-form";

/**
 * Convert flat generated-form data into the options API payload. On edits,
 * optional values that existed initially but disappeared from RJSF are sent as
 * explicit nulls so the server clears them instead of treating them as absent.
 */
export function formDataToPayload(
  formData: Record<string, unknown>,
  schema: JsonSchema,
  initialData?: Record<string, unknown>,
): Record<string, unknown> {
  const normalized = { ...formData };
  const required = new Set(schema.required ?? []);
  for (const key of Object.keys(initialData ?? {})) {
    if (!required.has(key) && normalized[key] === undefined) {
      normalized[key] = null;
    }
  }

  const { columnFields, dataFields } = splitPayloadByDataField(schema, normalized);
  const payload: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(columnFields)) {
    if ((typeof value === "string" && value.trim() === "") || value === undefined) {
      payload[key] = null;
    } else {
      payload[key] = value;
    }
  }
  if (Object.keys(dataFields).length > 0) {
    payload.data = dataFields;
  }
  return payload;
}