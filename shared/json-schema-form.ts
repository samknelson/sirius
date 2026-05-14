/**
 * JSON Schema vendor extensions used across the application's
 * descriptor-driven forms (plugin config, unified-options admin, etc).
 *
 * These keys ride along on a standard JSON Schema property and instruct
 * the SchemaForm renderer (client/src/components/json-schema-form) to
 * substitute one of our custom widgets for the default RJSF widget.
 *
 * They are also passed through to the server unchanged so storage
 * helpers can decide where a value lives (top-level column vs JSONB
 * `data` blob).
 */

export const VendorExtensions = {
  /** Render a select that loads its choices from /api/options/:type. */
  optionsResource: "x-options-resource",
  /**
   * Render a select for picking another row of the SAME options
   * resource (parent picker for hierarchical types). The widget reads
   * the candidate list and the editing-id from form context.
   */
  optionsSelf: "x-options-self",
  /**
   * Marks a field whose value should be persisted into the row's JSONB
   * `data` blob rather than its own column. Server storage helpers walk
   * the schema and split the payload accordingly.
   */
  dataField: "x-data-field",
} as const;

/** Allowed JSON Schema primitive type names. */
export type JsonSchemaTypeName =
  | "object"
  | "string"
  | "number"
  | "integer"
  | "boolean"
  | "array"
  | "null";

/** Minimal JSON Schema type we use throughout the app. */
export type JsonSchema = {
  /**
   * Single type or a union of types (`["string", "null"]` is the
   * standard JSON-Schema way to express a nullable string). RJSF and
   * AJV both accept either form.
   */
  type?: JsonSchemaTypeName | JsonSchemaTypeName[];
  title?: string;
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  enum?: unknown[];
  enumNames?: string[];
  items?: JsonSchema;
  default?: unknown;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  format?: string;
  pattern?: string;
  uniqueItems?: boolean;
  minItems?: number;
  maxItems?: number;
  additionalProperties?: boolean | JsonSchema;
  oneOf?: JsonSchema[];
  anyOf?: JsonSchema[];
  allOf?: JsonSchema[];
  $ref?: string;
  /** Vendor extension keys (see VendorExtensions). */
  [key: `x-${string}`]: unknown;
};

/** RJSF UI Schema we accept (subset; intentionally untyped values). */
export type UiSchema = Record<string, unknown>;

/**
 * Recursively collect every property in a schema, returning the
 * property name, its sub-schema, and the dotted path. Useful for
 * extracting x-data-field markers when splitting a payload into
 * top-level vs JSONB data.
 */
export function walkSchemaProperties(
  schema: JsonSchema,
  path: string[] = [],
): Array<{ name: string; schema: JsonSchema; path: string[] }> {
  const out: Array<{ name: string; schema: JsonSchema; path: string[] }> = [];
  if (!schema.properties) return out;
  for (const [name, sub] of Object.entries(schema.properties)) {
    const here = [...path, name];
    out.push({ name, schema: sub, path: here });
    if (sub.type === "object") {
      out.push(...walkSchemaProperties(sub, here));
    }
  }
  return out;
}

/**
 * Split a flat form payload into { columnFields, dataFields } based on
 * which top-level schema properties are tagged `x-data-field: true`.
 * Properties not present in the schema are ignored.
 */
export function splitPayloadByDataField(
  schema: JsonSchema,
  payload: Record<string, unknown>,
): { columnFields: Record<string, unknown>; dataFields: Record<string, unknown> } {
  const columnFields: Record<string, unknown> = {};
  const dataFields: Record<string, unknown> = {};
  if (!schema.properties) return { columnFields, dataFields };
  for (const [name, sub] of Object.entries(schema.properties)) {
    if (!(name in payload)) continue;
    const v = payload[name];
    if (sub[VendorExtensions.dataField] === true) {
      dataFields[name] = v;
    } else {
      columnFields[name] = v;
    }
  }
  return { columnFields, dataFields };
}
