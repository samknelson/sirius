import type { PgTable, TableConfig } from "drizzle-orm/pg-core";
import type { JsonSchema, UiSchema } from "@shared/json-schema-form";
import type { OptionsTypeName } from "./options-declarations";
import type { TransactionClient } from "./transaction-context";

/**
 * Field definition for dynamic form and table rendering
 */
export interface FieldDefinition {
  name: string;
  label: string;
  inputType: 'text' | 'textarea' | 'number' | 'select-self' | 'icon' | 'checkbox' | 'select-options' | 'color' | 'multi-enum' | 'enum' | 'system-roles' | 'worker-ban-plugins';
  required: boolean;
  placeholder?: string;
  helperText?: string;
  showInTable: boolean;
  columnHeader?: string;
  columnWidth?: string;
  dataField?: boolean;
  /**
   * Persist this field at a NESTED path inside the JSONB `data` column
   * instead of a top-level `data` key (e.g. the BAO member-status threshold
   * lives at data.sitespecific.bao.threshold). Serialized into the schema as
   * `x-data-path` so the client hydrates/serializes the same location.
   * Mutually exclusive with `dataField`.
   */
  dataPath?: string[];
  /** For inputType="number": minimum accepted value (schema `minimum`). */
  min?: number;
  selectOptionsType?: OptionsTypeName;
  /** Only offer options whose named field equals this sibling form field. */
  selectOptionsMatchField?: string;
  /** Exclude the row currently being edited from this options picker. */
  selectOptionsExcludeEditing?: boolean;
  /** Exclude closed rows that do not define a default resolution. */
  selectOptionsRequireClosedDefault?: boolean;
  /** For select-options fields whose rows come from a non-options API. */
  selectOptionsEndpoint?: string;
  /** For inputType="multi-enum" or "enum": the allowed string values (and optional human labels). */
  enumOptions?: Array<{ value: string; label?: string }>;
  /**
   * Same thing, computed when the definition is READ rather than when this
   * module is imported. Use it whenever the choices come from a registry that
   * is populated during boot: a static `enumOptions` array would freeze the
   * empty registry into the field and the form would offer nothing.
   * `getDefinition` resolves this into `enumOptions` before serving.
   */
  enumOptionsResolver?: () => Array<{ value: string; label?: string }>;
  /**
   * Optional form default for the generated JSON Schema. Currently honored
   * for `checkbox` fields (otherwise checkboxes default to false). Lets a
   * field opt into a `true` default so newly created rows come in checked.
   */
  default?: boolean;
  /**
   * Gate an individual field behind a component: the definition-serving
   * routes strip the field (from `fields`, `schema`, and `uiSchema`) when the
   * component is disabled, so the form and table never show it.
   */
  requiredComponent?: string;
}

/**
 * Complete options resource definition for frontend consumption.
 *
 * `fields` drives the table (column headers, cell rendering); `schema`
 * + `uiSchema` drive the create/edit form via SchemaFormDialog. The
 * two are derived from the same source-of-truth `FieldDefinition[]`
 * inside `optionsMetadata`.
 */
export interface OptionsResourceDefinition {
  type: OptionsTypeName;
  displayName: string;
  description?: string;
  singularName: string;
  pluralName: string;
  fields: FieldDefinition[];
  schema: JsonSchema;
  uiSchema: UiSchema;
  supportsSequencing: boolean;
  supportsParent: boolean;
  requiredComponent?: string;
}

/**
 * Convert a list of FieldDefinition descriptors to a JSON Schema +
 * uiSchema pair suitable for `SchemaFormDialog`. Field semantics:
 *   - text/textarea → string (textarea via uiSchema)
 *   - number        → integer
 *   - checkbox      → boolean (default false)
 *   - icon/color    → string + `x-widget` vendor key
 *   - select-options→ string + `x-options-resource` vendor key
 *   - select-self   → string (nullable) + `x-options-self` vendor key
 *   - dataField:true→ adds `x-data-field: true` so the storage layer
 *                     splits it into the JSONB `data` column.
 */
export function fieldsToJsonSchema(
  fields: FieldDefinition[],
): { schema: JsonSchema; uiSchema: UiSchema } {
  const properties: Record<string, JsonSchema> = {};
  const required: string[] = [];
  const uiSchema: UiSchema = {};

  for (const f of fields) {
    let prop: JsonSchema = { title: f.label };
    if (f.helperText) prop.description = f.helperText;

    switch (f.inputType) {
      case "text":
        prop.type = "string";
        if (f.required) prop.minLength = 1;
        break;
      case "textarea":
        prop.type = "string";
        if (f.required) prop.minLength = 1;
        uiSchema[f.name] = { ...(uiSchema[f.name] as object), "ui:widget": "textarea" };
        break;
      case "number":
        prop.type = "integer";
        if (f.min !== undefined) prop.minimum = f.min;
        break;
      case "checkbox":
        prop.type = "boolean";
        prop.default = f.default ?? false;
        break;
      case "icon":
        prop.type = "string";
        (prop as Record<string, unknown>)["x-widget"] = "icon";
        break;
      case "color":
        prop.type = "string";
        (prop as Record<string, unknown>)["x-widget"] = "color";
        break;
      case "select-options":
        prop.type = "string";
        if (f.selectOptionsType) {
          (prop as Record<string, unknown>)["x-options-resource"] = f.selectOptionsType;
        }
        if (f.selectOptionsEndpoint) {
          (prop as Record<string, unknown>)["x-options-endpoint"] = f.selectOptionsEndpoint;
        }
        if (f.selectOptionsMatchField) {
          (prop as Record<string, unknown>)["x-options-match-field"] = f.selectOptionsMatchField;
        }
        if (f.selectOptionsExcludeEditing) {
          (prop as Record<string, unknown>)["x-options-exclude-editing"] = true;
        }
        if (f.selectOptionsRequireClosedDefault) {
          (prop as Record<string, unknown>)["x-options-require-closed-default"] = true;
        }
        if (f.required) prop.minLength = 1;
        break;
      case "select-self":
        // Nullable: SelfOptionsWidget sends `null` for the "no parent"
        // sentinel, so the schema must accept null in addition to string.
        prop.type = ["string", "null"];
        (prop as Record<string, unknown>)["x-options-self"] = true;
        break;
      case "multi-enum": {
        prop.type = "array";
        prop.uniqueItems = true;
        const values = (f.enumOptions ?? []).map((o) => o.value);
        const items: JsonSchema = { type: "string", enum: values };
        const labels = (f.enumOptions ?? []).map((o) => o.label ?? o.value);
        if (labels.some((l, i) => l !== values[i])) {
          items.enumNames = labels;
        }
        prop.items = items;
        if (f.required) prop.minItems = 1;
        break;
      }
      case "system-roles": {
        // Dynamic multi-select of system roles. The allowed values are
        // the live roles from the access-control roles table (loaded by
        // the SystemRolesField widget at render time), so we cannot bake
        // an enum here. Stored as an array of role-id strings.
        prop.type = "array";
        prop.uniqueItems = true;
        prop.items = { type: "string" };
        (prop as Record<string, unknown>)["x-widget"] = "system-roles";
        if (f.required) prop.minItems = 1;
        break;
      }
      case "worker-ban-plugins": {
        // Dynamic multi-select of registered worker-ban plugins. Like
        // `system-roles`, the allowed values are live (the plugin registry,
        // fetched by the client widget from the worker-ban manifest), so no
        // enum is baked here; the write routes validate against the registry.
        prop.type = "array";
        prop.uniqueItems = true;
        prop.items = { type: "string" };
        (prop as Record<string, unknown>)["x-widget"] = "worker-ban-plugins";
        if (f.required) prop.minItems = 1;
        break;
      }
      case "enum": {
        prop.type = "string";
        const values = (f.enumOptions ?? []).map((o) => o.value);
        prop.enum = values;
        const labels = (f.enumOptions ?? []).map((o) => o.label ?? o.value);
        if (labels.some((l, i) => l !== values[i])) {
          prop.enumNames = labels;
        }
        if (f.required) prop.minLength = 1;
        break;
      }
    }

    if (f.placeholder) {
      uiSchema[f.name] = {
        ...(uiSchema[f.name] as object),
        "ui:placeholder": f.placeholder,
      };
    }

    if (f.dataField) {
      (prop as Record<string, unknown>)["x-data-field"] = true;
    }
    if (f.dataPath) {
      (prop as Record<string, unknown>)["x-data-path"] = f.dataPath;
    }

    properties[f.name] = prop;
    if (f.required) required.push(f.name);
  }

  const schema: JsonSchema = {
    type: "object",
    properties,
    ...(required.length > 0 ? { required } : {}),
  };
  return { schema, uiSchema };
}

/**
 * Materialize a field list for serving: any field whose choices are resolved
 * at read time (see `enumOptionsResolver`) gets a concrete `enumOptions`, so
 * every consumer downstream — the JSON Schema, the table cells, the write
 * routes' enum constraints — sees one shape.
 */
export function resolveFieldChoices(fields: FieldDefinition[]): FieldDefinition[] {
  return fields.map((field) =>
    field.enumOptionsResolver
      ? { ...field, enumOptions: field.enumOptionsResolver() }
      : field,
  );
}

/** Optional resource-owned validation shared by forms, imports, and storage.
 * Apply it BEFORE generic optional blank handling so a clear-to-NULL transform
 * is not silently discarded. Partial writes must preserve omitted properties.
 */
export interface OptionsWriteSchema {
  parse(input: unknown): Record<string, unknown>;
  safeParse(input: unknown):
    | { success: true; data: Record<string, unknown> }
    | { success: false; error: { issues: { message: string }[] } };
  partial(): OptionsWriteSchema;
}

export interface OptionsTableMetadata<T extends PgTable<TableConfig>> {
  table: T;
  displayName: string;
  description?: string;
  singularName: string;
  pluralName: string;
  orderByColumn?: keyof T["_"]["columns"];
  loggingModule: string;
  requiredFields: string[];
  optionalFields: string[];
  supportsParent?: boolean;
  supportsSequencing?: boolean;
  requiredComponent?: string;
  writeSchema?: OptionsWriteSchema;
  beforeWrite?: OptionsBeforeWrite;
  /**
   * Set when this list is administered on its own page instead of the generic
   * options screen — the path of that page. The generic routes still serve the
   * type; this only tells the navigation and the options index where the list
   * really lives, so they don't offer a second, lesser door to it.
   */
  bespokePath?: string;
  fields: FieldDefinition[];
}


/** Server-only validation, awaited inside the same transaction as persistence.
 * Throw to refuse a write. Use client for all locking and historical reads.
 * Values are the submitted storage payload before schema normalization. */
export type OptionsBeforeWrite = (context: {
  client: TransactionClient;
  values: Readonly<Record<string, any>>;
} & ({ operation: "create"; id?: never } | { operation: "update"; id: string })) => Promise<void>;
