import { createNoopValidator } from './utils/validation';
import { getClient } from './transaction-context';
import { eq, asc, getTableName, SQL } from "drizzle-orm";
import { PgTable, TableConfig } from "drizzle-orm/pg-core";
import { 
  optionsGender, 
  optionsWorkerIdType, 
  optionsTrustBenefitType, 
  optionsLedgerPaymentType,
  optionsEmployerContactType,
  optionsEmployerType,
  optionsDepartment,
  optionsTrustProviderType,
  optionsWorkerWs,
  optionsEmploymentStatus,
  optionsEventType,
  optionsDispatchJobType,
  optionsEdlsTasks,
  optionsEdlsShowStatus,
  optionsClassifications,
  optionsIndustry,
  optionsWorkerMs,
  optionsCommTags,
  optionsWorkerBanType,
  optionsNoteType,
  optionsFileType,
  bulkMediumEnum,
} from "@shared/schema";
import { listEntityNoteContexts } from "../services/entity-notes/registry";
import { listEntityFileContexts } from "../services/entity-files/registry";
import { defineLoggingConfig, withStorageLogging } from "./middleware/logging";
import type { JsonSchema, UiSchema } from "@shared/json-schema-form";

/**
 * Stub validator - add validation logic here when needed
 */
export const validate = createNoopValidator();

/**
 * Every declared options list. A component that declares a whole list of its
 * own adds its type here by interface augmentation (`declare module`) and
 * registers the definition with `registerOptionsContribution`.
 */
export interface OptionsTypeNames {
  "department": true;
  "employer-type": true;
  "employer-contact-type": true;
  "worker-id-type": true;
  "gender": true;
  "trust-benefit-type": true;
  "trust-provider-type": true;
  "worker-ws": true;
  "employment-status": true;
  "event-type": true;
  "dispatch-job-type": true;
  "ledger-payment-type": true;
  "edls-task": true;
  "edls-show-status": true;
  "classification": true;
  "industry": true;
  "worker-ms": true;
  "comm-tag": true;
  "worker-ban-type": true;
  "note-type": true;
  "file-type": true;
}

export type OptionsTypeName = keyof OptionsTypeNames & string;

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
  selectOptionsType?: OptionsTypeName;
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
  /**
   * Set when this list is administered on its own page instead of the generic
   * options screen — the path of that page. The generic routes still serve the
   * type; this only tells the navigation and the options index where the list
   * really lives, so they don't offer a second, lesser door to it.
   */
  bespokePath?: string;
  fields: FieldDefinition[];
}

// Component-declared lists are added to this map at registration (see
// server/modules/options-contributions.ts), so readers must not cache its keys.
const optionsMetadata = {
  "department": {
    table: optionsDepartment,
    displayName: "Department",
    description: "Manage organizational departments",
    singularName: "Department",
    pluralName: "Departments",
    orderByColumn: "name" as const,
    loggingModule: "options.departments",
    requiredFields: ["name"],
    optionalFields: ["description", "data"],
    supportsSequencing: false,
    fields: [
      { name: "name", label: "Name", inputType: "text", required: true, placeholder: "Department name", showInTable: true, columnHeader: "Name" },
      { name: "description", label: "Description", inputType: "textarea", required: false, placeholder: "Optional description", showInTable: true, columnHeader: "Description" },
    ],
  },
  "employer-type": {
    table: optionsEmployerType,
    displayName: "Employer Type",
    description: "Manage employer classification types",
    singularName: "Employer Type",
    pluralName: "Employer Types",
    orderByColumn: "sequence" as const,
    loggingModule: "options.employerTypes",
    requiredFields: ["name"],
    optionalFields: ["description", "data", "sequence"],
    supportsSequencing: true,
    fields: [
      { name: "name", label: "Name", inputType: "text", required: true, placeholder: "Employer type name", showInTable: true, columnHeader: "Name" },
      { name: "description", label: "Description", inputType: "textarea", required: false, placeholder: "Optional description", showInTable: true, columnHeader: "Description" },
    ],
  },
  "employer-contact-type": {
    table: optionsEmployerContactType,
    displayName: "Employer Contact Type",
    description: "Manage types of employer contacts",
    singularName: "Employer Contact Type",
    pluralName: "Employer Contact Types",
    orderByColumn: "name" as const,
    loggingModule: "options.employerContactTypes",
    requiredFields: ["name"],
    optionalFields: ["description", "data"],
    supportsSequencing: false,
    fields: [
      { name: "name", label: "Name", inputType: "text", required: true, placeholder: "Contact type name", showInTable: true, columnHeader: "Name" },
      { name: "icon", label: "Icon", inputType: "icon", required: false, placeholder: "Select an icon", showInTable: true, columnHeader: "Icon", columnWidth: "80px", dataField: true },
      { name: "description", label: "Description", inputType: "textarea", required: false, placeholder: "Optional description", showInTable: true, columnHeader: "Description" },
    ],
  },
  "worker-id-type": {
    table: optionsWorkerIdType,
    displayName: "Worker ID Type",
    description: "Manage types of worker identification",
    singularName: "Worker ID Type",
    pluralName: "Worker ID Types",
    orderByColumn: "sequence" as const,
    loggingModule: "options.workerIdTypes",
    requiredFields: ["name"],
    optionalFields: ["siriusId", "sequence", "validator", "data"],
    supportsSequencing: true,
    fields: [
      { name: "name", label: "Name", inputType: "text", required: true, placeholder: "ID type name", showInTable: true, columnHeader: "Name" },
      { name: "siriusId", label: "Sirius ID", inputType: "text", required: false, placeholder: "External ID", showInTable: true, columnHeader: "Sirius ID" },
      { name: "validator", label: "Validator", inputType: "text", required: false, placeholder: "Validation pattern", showInTable: false },
      { name: "showOnLists", label: "Show on Lists", inputType: "checkbox", required: false, helperText: "Display this ID type on Worker List, Card Check report, and other list views", showInTable: true, columnHeader: "Show on Lists", dataField: true },
    ],
  },
  "gender": {
    table: optionsGender,
    displayName: "Gender",
    description: "Manage gender options for worker profiles",
    singularName: "Gender",
    pluralName: "Genders",
    orderByColumn: "sequence" as const,
    loggingModule: "options.gender",
    requiredFields: ["name", "code"],
    optionalFields: ["nota", "sequence", "data"],
    supportsSequencing: true,
    fields: [
      { name: "name", label: "Name", inputType: "text", required: true, placeholder: "Gender name", showInTable: true, columnHeader: "Name" },
      { name: "code", label: "Code", inputType: "text", required: true, placeholder: "Short code (e.g., M, F)", showInTable: true, columnHeader: "Code" },
      { name: "nota", label: "Not Applicable", inputType: "checkbox", required: false, helperText: "Mark if this represents a non-answer", showInTable: false },
    ],
  },
  "trust-benefit-type": {
    table: optionsTrustBenefitType,
    displayName: "Trust Benefit Type",
    description: "Manage types of trust benefits",
    singularName: "Trust Benefit Type",
    pluralName: "Trust Benefit Types",
    orderByColumn: "sequence" as const,
    loggingModule: "options.trustBenefitTypes",
    requiredFields: ["name"],
    optionalFields: ["siriusId", "description", "sequence", "data"],
    supportsSequencing: true,
    fields: [
      { name: "name", label: "Name", inputType: "text", required: true, placeholder: "Benefit type name", showInTable: true, columnHeader: "Name" },
      { name: "siriusId", label: "Sirius ID", inputType: "text", required: false, placeholder: "Optional Sirius ID", showInTable: true, columnHeader: "Sirius ID" },
      { name: "description", label: "Description", inputType: "textarea", required: false, placeholder: "Optional description", showInTable: true, columnHeader: "Description" },
    ],
  },
  "trust-provider-type": {
    table: optionsTrustProviderType,
    displayName: "Trust Provider Type",
    description: "Manage types of trust providers",
    singularName: "Trust Provider Type",
    pluralName: "Trust Provider Types",
    orderByColumn: "name" as const,
    loggingModule: "options.trustProviderTypes",
    requiredFields: ["name"],
    optionalFields: ["description"],
    supportsSequencing: false,
    fields: [
      { name: "name", label: "Name", inputType: "text", required: true, placeholder: "Provider type name", showInTable: true, columnHeader: "Name" },
      { name: "description", label: "Description", inputType: "textarea", required: false, placeholder: "Optional description", showInTable: true, columnHeader: "Description" },
    ],
  },
  "worker-ws": {
    table: optionsWorkerWs,
    displayName: "Worker Work Status",
    description: "Manage worker status options",
    singularName: "Worker Work Status",
    pluralName: "Worker Work Statuses",
    orderByColumn: "sequence" as const,
    loggingModule: "options.workerWs",
    requiredFields: ["name"],
    optionalFields: ["shortName", "description", "sequence", "data"],
    supportsSequencing: true,
    fields: [
      { name: "name", label: "Name", inputType: "text", required: true, placeholder: "Status name", showInTable: true, columnHeader: "Name" },
      { name: "shortName", label: "Short Name", inputType: "text", required: false, placeholder: "Abbreviated name", showInTable: true, columnHeader: "Short Name" },
      { name: "description", label: "Description", inputType: "textarea", required: false, placeholder: "Optional description", showInTable: false },
    ],
  },
  "worker-ms": {
    table: optionsWorkerMs,
    displayName: "Worker Member Status",
    description: "Manage worker member status options",
    singularName: "Worker Member Status",
    pluralName: "Worker Member Statuses",
    orderByColumn: "sequence" as const,
    loggingModule: "options.workerMs",
    requiredFields: ["name", "industryId"],
    optionalFields: ["code", "siriusId", "description", "sequence", "data"],
    supportsSequencing: true,
    fields: [
      { name: "name", label: "Name", inputType: "text", required: true, placeholder: "Member status name", showInTable: true, columnHeader: "Name" },
      { name: "code", label: "Code", inputType: "text", required: false, placeholder: "Optional code", showInTable: true, columnHeader: "Code" },
      { name: "siriusId", label: "Sirius ID", inputType: "text", required: false, placeholder: "Optional Sirius ID", showInTable: true, columnHeader: "Sirius ID" },
      { name: "industryId", label: "Industry", inputType: "select-options", required: true, selectOptionsType: "industry", showInTable: true, columnHeader: "Industry" },
      { name: "description", label: "Description", inputType: "textarea", required: false, placeholder: "Optional description", showInTable: false },
    ],
  },
  "employment-status": {
    table: optionsEmploymentStatus,
    displayName: "Employment Status",
    description: "Manage employment status options",
    singularName: "Employment Status",
    pluralName: "Employment Statuses",
    orderByColumn: "sequence" as const,
    loggingModule: "options.employmentStatus",
    requiredFields: ["name", "code"],
    optionalFields: ["description", "sequence", "data", "employed"],
    supportsSequencing: true,
    fields: [
      { name: "name", label: "Name", inputType: "text", required: true, placeholder: "Status name", showInTable: true, columnHeader: "Name" },
      { name: "code", label: "Code", inputType: "text", required: true, placeholder: "Short code (e.g., FT, PT)", showInTable: true, columnHeader: "Code" },
      { name: "employed", label: "Employed", inputType: "checkbox", required: false, helperText: "Consider this status as employed", showInTable: true, columnHeader: "Employed" },
      { name: "color", label: "Color", inputType: "color", required: false, dataField: true, showInTable: true, columnHeader: "Color" },
      { name: "description", label: "Description", inputType: "textarea", required: false, placeholder: "Optional description", showInTable: false },
    ],
  },
  "event-type": {
    table: optionsEventType,
    displayName: "Event Type",
    description: "Manage types of events",
    singularName: "Event Type",
    pluralName: "Event Types",
    orderByColumn: "name" as const,
    loggingModule: "options.eventTypes",
    bespokePath: "/config/event-types",
    requiredFields: ["name"],
    optionalFields: ["description", "data", "siriusId", "category", "config"],
    supportsSequencing: false,
    fields: [
      { name: "name", label: "Name", inputType: "text", required: true, placeholder: "Event type name", showInTable: true, columnHeader: "Name" },
      { name: "description", label: "Description", inputType: "textarea", required: false, placeholder: "Optional description", showInTable: true, columnHeader: "Description" },
    ],
  },
  "dispatch-job-type": {
    table: optionsDispatchJobType,
    displayName: "Dispatch Job Type",
    description: "Manage types of dispatch jobs",
    singularName: "Dispatch Job Type",
    pluralName: "Dispatch Job Types",
    orderByColumn: "name" as const,
    loggingModule: "options.dispatchJobTypes",
    bespokePath: "/config/dispatch-job-types",
    requiredFields: ["name"],
    optionalFields: ["description", "data"],
    supportsSequencing: false,
    fields: [
      { name: "name", label: "Name", inputType: "text", required: true, placeholder: "Job type name", showInTable: true, columnHeader: "Name" },
      { name: "description", label: "Description", inputType: "textarea", required: false, placeholder: "Optional description", showInTable: true, columnHeader: "Description" },
    ],
  },
  "ledger-payment-type": {
    table: optionsLedgerPaymentType,
    displayName: "Ledger Payment Type",
    description: "Manage payment type options for ledger entries",
    singularName: "Ledger Payment Type",
    pluralName: "Ledger Payment Types",
    orderByColumn: "sequence" as const,
    loggingModule: "options.ledgerPaymentTypes",
    bespokePath: "/config/ledger/payment-types",
    requiredFields: ["name", "category"],
    optionalFields: ["description", "sequence", "currencyCode", "data"],
    supportsSequencing: true,
    fields: [
      { name: "name", label: "Name", inputType: "text", required: true, placeholder: "Payment type name", showInTable: true, columnHeader: "Name" },
      { name: "category", label: "Category", inputType: "text", required: true, placeholder: "Payment category", showInTable: true, columnHeader: "Category" },
      { name: "description", label: "Description", inputType: "textarea", required: false, placeholder: "Optional description", showInTable: false },
      { name: "currencyCode", label: "Currency Code", inputType: "text", required: false, placeholder: "e.g., USD", showInTable: true, columnHeader: "Currency" },
    ],
  },







  "worker-ban-type": {
    table: optionsWorkerBanType,
    displayName: "Worker Ban Type",
    description: "Ban types available on the worker bans page. Each type applies one or more ban behaviors (what the ban prohibits).",
    singularName: "Worker Ban Type",
    pluralName: "Worker Ban Types",
    orderByColumn: "name" as const,
    loggingModule: "options.workerBanType",
    requiredFields: ["name"],
    optionalFields: ["description", "siriusId", "data"],
    supportsSequencing: false,
    requiredComponent: "dispatch",
    fields: [
      { name: "name", label: "Name", inputType: "text", required: true, placeholder: "e.g., Dispatch, Facility Ban", showInTable: true, columnHeader: "Name" },
      { name: "description", label: "Description", inputType: "textarea", required: false, placeholder: "Optional description of this ban type", showInTable: true, columnHeader: "Description" },
      { name: "pluginIds", label: "Ban Behaviors", inputType: "worker-ban-plugins", required: true, helperText: "What a ban of this type prohibits. Bans of this type apply every selected behavior.", showInTable: false, dataField: true },
      { name: "defaultDurationDays", label: "Default duration (days)", inputType: "number", required: false, placeholder: "e.g., 7", helperText: "When set, new bans of this type pre-fill their end date to start date + this many days. Leave empty for no default (indefinite).", showInTable: true, columnHeader: "Default Duration", dataField: true },
      { name: "siriusId", label: "Sirius ID", inputType: "text", required: false, placeholder: "External ID", showInTable: true, columnHeader: "Sirius ID" },
    ],
  },
  "note-type": {
    table: optionsNoteType,
    displayName: "Note Type",
    description: "Types available when staff add a note to a record. Each type declares which record types it applies to.",
    singularName: "Note Type",
    pluralName: "Note Types",
    orderByColumn: "name" as const,
    loggingModule: "options.noteType",
    requiredFields: ["name"],
    optionalFields: ["description", "siriusId", "data"],
    supportsSequencing: false,
    fields: [
      { name: "name", label: "Name", inputType: "text", required: true, placeholder: "e.g., Phone Call, Review", showInTable: true, columnHeader: "Name" },
      { name: "description", label: "Description", inputType: "textarea", required: false, placeholder: "Optional description of this note type", showInTable: true, columnHeader: "Description" },
      // Choices come from the shared note-entity registry so this list and the
      // API's entity-type validation cannot drift.
      // Same key as the file-type list: what a type applies to is a context
      // id in both frameworks.
      { name: "contextIds", label: "Applies To", inputType: "multi-enum", required: true, helperText: "Record types that can use this note type.", showInTable: true, columnHeader: "Applies To", dataField: true, enumOptionsResolver: () => listEntityNoteContexts().map((c) => ({ value: c.id, label: c.recordLabel })) },
      { name: "siriusId", label: "Sirius ID", inputType: "text", required: false, placeholder: "External ID", showInTable: true, columnHeader: "Sirius ID" },
    ],
  },
  "file-type": {
    table: optionsFileType,
    displayName: "File Type",
    description: "Types available when staff attach a file to a record. Each type declares which record types it applies to. Choosing a type is optional.",
    singularName: "File Type",
    pluralName: "File Types",
    orderByColumn: "name" as const,
    loggingModule: "options.fileType",
    requiredFields: ["name"],
    optionalFields: ["description", "siriusId", "data"],
    supportsSequencing: false,
    fields: [
      { name: "name", label: "Name", inputType: "text", required: true, placeholder: "e.g., Contract, Photo ID", showInTable: true, columnHeader: "Name" },
      { name: "description", label: "Description", inputType: "textarea", required: false, placeholder: "Optional description of this file type", showInTable: true, columnHeader: "Description" },
      // Choices come from the entity-file context registry so this list and
      // the API's context validation cannot drift.
      { name: "contextIds", label: "Applies To", inputType: "multi-enum", required: true, helperText: "Record types that can use this file type.", showInTable: true, columnHeader: "Applies To", dataField: true, enumOptionsResolver: () => listEntityFileContexts().map((c) => ({ value: c.id, label: c.recordLabel })) },
      { name: "siriusId", label: "Sirius ID", inputType: "text", required: false, placeholder: "External ID", showInTable: true, columnHeader: "Sirius ID" },
    ],
  },
  "edls-task": {
    table: optionsEdlsTasks,
    displayName: "EDLS Task",
    description: "Manage tasks for the Employer Day Labor Scheduler",
    singularName: "EDLS Task",
    pluralName: "EDLS Tasks",
    orderByColumn: "name" as const,
    loggingModule: "options.edlsTasks",
    bespokePath: "/config/edls/tasks",
    requiredFields: ["name", "departmentId"],
    optionalFields: ["siriusId", "data"],
    supportsSequencing: false,
    fields: [
      { name: "name", label: "Name", inputType: "text", required: true, placeholder: "Task name", showInTable: true, columnHeader: "Name" },
      { name: "departmentId", label: "Department", inputType: "select-options", required: true, showInTable: true, columnHeader: "Department", selectOptionsType: "department" },
      { name: "siriusId", label: "Sirius ID", inputType: "text", required: false, placeholder: "External ID", showInTable: true, columnHeader: "Sirius ID" },
    ],
  },
  "edls-show-status": {
    table: optionsEdlsShowStatus,
    displayName: "EDLS Show Status",
    description: "Manage show statuses for EDLS sheets",
    singularName: "EDLS Show Status",
    pluralName: "EDLS Show Statuses",
    orderByColumn: "sequence" as const,
    loggingModule: "options.edlsShowStatuses",
    requiredComponent: "edls",
    requiredFields: ["name"],
    optionalFields: ["siriusId", "sequence", "data"],
    supportsSequencing: true,
    fields: [
      { name: "name", label: "Name", inputType: "text", required: true, placeholder: "Show status name", showInTable: true, columnHeader: "Name" },
      { name: "siriusId", label: "Sirius ID", inputType: "text", required: false, placeholder: "External ID", showInTable: true, columnHeader: "Sirius ID" },
    ],
  },
  "classification": {
    table: optionsClassifications,
    displayName: "Worker Classification",
    description: "Manage worker classification options",
    singularName: "Worker Classification",
    pluralName: "Worker Classifications",
    orderByColumn: "sequence" as const,
    loggingModule: "options.classifications",
    requiredFields: ["name"],
    optionalFields: ["code", "siriusId", "sequence", "data"],
    supportsSequencing: true,
    fields: [
      { name: "name", label: "Name", inputType: "text", required: true, placeholder: "Classification name", showInTable: true, columnHeader: "Name" },
      { name: "code", label: "Code", inputType: "text", required: false, placeholder: "Short code", showInTable: true, columnHeader: "Code" },
      { name: "siriusId", label: "Sirius ID", inputType: "text", required: false, placeholder: "External ID", showInTable: true, columnHeader: "Sirius ID" },
    ],
  },
  "industry": {
    table: optionsIndustry,
    displayName: "Industry",
    description: "Manage industry options for workers",
    singularName: "Industry",
    pluralName: "Industries",
    orderByColumn: "name" as const,
    loggingModule: "options.industries",
    requiredFields: ["name"],
    optionalFields: ["code", "siriusId", "data"],
    supportsSequencing: false,
    fields: [
      { name: "name", label: "Name", inputType: "text", required: true, placeholder: "Industry name", showInTable: true, columnHeader: "Name" },
      { name: "code", label: "Code", inputType: "text", required: false, placeholder: "Short code", showInTable: true, columnHeader: "Code" },
      { name: "siriusId", label: "Sirius ID", inputType: "text", required: false, placeholder: "External ID", showInTable: true, columnHeader: "Sirius ID" },
    ],
  },
  "comm-tag": {
    table: optionsCommTags,
    displayName: "Comm Tag",
    description: "Tags that can be applied to communications, scoped to specific comm media.",
    singularName: "Comm Tag",
    pluralName: "Comm Tags",
    orderByColumn: "name" as const,
    loggingModule: "options.commTags",
    requiredFields: ["name"],
    optionalFields: ["description", "siriusId", "data"],
    supportsSequencing: false,
    fields: [
      { name: "icon", label: "Icon", inputType: "icon", required: false, placeholder: "Select an icon", showInTable: true, columnHeader: "Icon", columnWidth: "80px", dataField: true },
      { name: "name", label: "Name", inputType: "text", required: true, placeholder: "Tag name", showInTable: true, columnHeader: "Name" },
      { name: "description", label: "Description", inputType: "textarea", required: false, placeholder: "Optional description", showInTable: true, columnHeader: "Description" },
      {
        name: "applicableCommTypes",
        label: "Applicable Comm Types",
        inputType: "multi-enum",
        required: false,
        helperText: "Restrict this tag to specific communication media. Leave empty to allow all.",
        showInTable: true,
        columnHeader: "Applies To",
        dataField: true,
        enumOptions: (bulkMediumEnum.enumValues as readonly string[]).map((v) => ({
          value: v,
          label: v === "sms" ? "SMS" : v === "email" ? "Email" : v === "inapp" ? "In-App" : v === "postal" ? "Postal" : v,
        })),
      },
      { name: "siriusId", label: "Sirius ID", inputType: "text", required: false, placeholder: "External ID", showInTable: true, columnHeader: "Sirius ID" },
    ],
  },
} as unknown as Record<OptionsTypeName, OptionsTableMetadata<any>>; // component-declared types are installed at registration

export type OptionsMetadataMap = typeof optionsMetadata;

export interface UnifiedOptionsStorage {
  list(type: OptionsTypeName): Promise<any[]>;
  get(type: OptionsTypeName, id: string): Promise<any | undefined>;
  create(type: OptionsTypeName, data: Record<string, any>): Promise<any>;
  update(type: OptionsTypeName, id: string, data: Record<string, any>): Promise<any | undefined>;
  delete(type: OptionsTypeName, id: string): Promise<boolean>;
  getMetadata(type: OptionsTypeName): typeof optionsMetadata[OptionsTypeName] | undefined;
  getDefinition(type: OptionsTypeName): OptionsResourceDefinition | undefined;
  getAllDefinitions(): OptionsResourceDefinition[];
  getAllTypes(): OptionsTypeName[];
}

function getTable(type: OptionsTypeName) {
  const metadata = optionsMetadata[type];
  if (!metadata) {
    throw new Error(`Unknown options type: ${type}`);
  }
  return metadata;
}

function createUnifiedOptionsStorageImpl(): UnifiedOptionsStorage {
  return {
    async list(type: OptionsTypeName): Promise<any[]> {
      const client = getClient();
      const { table, orderByColumn } = getTable(type);
      const tableAny = table as any;
      
      if (orderByColumn && tableAny[orderByColumn]) {
        return client.select().from(table).orderBy(asc(tableAny[orderByColumn]));
      }
      return client.select().from(table);
    },

    async get(type: OptionsTypeName, id: string): Promise<any | undefined> {
      const client = getClient();
      const { table } = getTable(type);
      const tableAny = table as any;
      const [result] = await client.select().from(table).where(eq(tableAny.id, id));
      return result || undefined;
    },

    async create(type: OptionsTypeName, data: Record<string, any>): Promise<any> {
      validate.validateOrThrow(type);
      const metadata = getTable(type) as any;
      if (metadata.writeSchema) data = metadata.writeSchema.parse(data);
      
      if (metadata.supportsParent && data.parent) {
        const allItems = await this.list(type);
        const parentExists = allItems.some((item: any) => item.id === data.parent);
        if (!parentExists) {
          throw new Error("Parent does not exist");
        }
      }
      
      const client = getClient();
      const { table } = getTable(type);
      const [result] = (await client.insert(table as any).values(data as any).returning()) as any[];
      return result;
    },

    async update(type: OptionsTypeName, id: string, data: Record<string, any>): Promise<any | undefined> {
      validate.validateOrThrow(type);
      const metadata = getTable(type) as any;
      if (metadata.writeSchema) data = metadata.writeSchema.partial().parse(data);
      
      if (metadata.supportsParent && data.parent !== undefined) {
        if (data.parent === id) {
          throw new Error("An item cannot be its own parent");
        }
        
        if (data.parent !== null) {
          const allItems = await this.list(type);
          const parentExists = allItems.some((item: any) => item.id === data.parent);
          if (!parentExists) {
            throw new Error("Parent does not exist");
          }
          
          const wouldCreateCycle = (targetId: string, newParentId: string): boolean => {
            const itemMap = new Map(allItems.map((item: any) => [item.id, item]));
            itemMap.set(targetId, { ...itemMap.get(targetId), parent: newParentId });
            
            let current = newParentId;
            const visited = new Set<string>();
            while (current) {
              if (visited.has(current)) return true;
              if (current === targetId) return true;
              visited.add(current);
              const item = itemMap.get(current);
              current = item?.parent || null;
            }
            return false;
          };
          
          if (wouldCreateCycle(id, data.parent)) {
            throw new Error("This change would create a circular reference");
          }
        }
      }
      
      const client = getClient();
      const { table } = metadata;
      const tableAny = table as any;
      const [result] = await client
        .update(table)
        .set(data as any)
        .where(eq(tableAny.id, id))
        .returning();
      return result || undefined;
    },

    async delete(type: OptionsTypeName, id: string): Promise<boolean> {
      const client = getClient();
      const { table } = getTable(type);
      const tableAny = table as any;
      const result = (await client.delete(tableAny).where(eq(tableAny.id, id)).returning()) as any[];
      return result.length > 0;
    },

    getMetadata(type: OptionsTypeName) {
      return optionsMetadata[type];
    },

    getDefinition(type: OptionsTypeName): OptionsResourceDefinition | undefined {
      const metadata = optionsMetadata[type];
      if (!metadata) return undefined;
      const fields = resolveFieldChoices(metadata.fields);
      const { schema, uiSchema } = fieldsToJsonSchema(fields);
      return {
        type,
        displayName: metadata.displayName,
        description: metadata.description,
        singularName: metadata.singularName,
        pluralName: metadata.pluralName,
        fields,
        schema,
        uiSchema,
        supportsSequencing: metadata.supportsSequencing ?? false,
        supportsParent: metadata.supportsParent ?? false,
        requiredComponent: metadata.requiredComponent,
      };
    },

    getAllDefinitions(): OptionsResourceDefinition[] {
      return (Object.keys(optionsMetadata) as OptionsTypeName[]).map(type => {
        const metadata = optionsMetadata[type];
        const fields = resolveFieldChoices(metadata.fields);
        const { schema, uiSchema } = fieldsToJsonSchema(fields);
        return {
          type,
          displayName: metadata.displayName,
          description: metadata.description,
          singularName: metadata.singularName,
          pluralName: metadata.pluralName,
          fields,
          schema,
          uiSchema,
          supportsSequencing: metadata.supportsSequencing ?? false,
          supportsParent: metadata.supportsParent ?? false,
          requiredComponent: metadata.requiredComponent,
        };
      });
    },

    getAllTypes(): OptionsTypeName[] {
      return Object.keys(optionsMetadata) as OptionsTypeName[];
    },
  };
}

export const unifiedOptionsLoggingConfig = defineLoggingConfig<UnifiedOptionsStorage>({
  module: "options",
  // One storage over every options table: the type argument names which.
  table: (args) => {
    const metadata = optionsMetadata[args[0] as OptionsTypeName];
    return metadata ? getTableName(metadata.table) : undefined;
  },
  methods: {
    create: {
      getEntityId: (args) => args[1]?.name || `new ${args[0]}`,
      metadataEntityId: (_args, result) => result?.id,
    },
    update: {
      getEntityId: (args) => args[1],
      before: async (args, storage) =>
        storage.get(args[0] as OptionsTypeName, args[1] as string),
    },
    delete: {
      getEntityId: (args) => args[1],
      before: async (args, storage) =>
        storage.get(args[0] as OptionsTypeName, args[1] as string),
    },
  },
});

export function createUnifiedOptionsStorage(): UnifiedOptionsStorage {
  // Wrapped so every option row written through this storage — by hand on
  // the List tab or in bulk by the JSON importer — lands in the admin log
  // viewer as its own entry. `withStorageLogging` invokes the underlying
  // method with `this` bound to the unwrapped implementation, so internal
  // `this.list()` / `this.get()` calls are unaffected.
  return withStorageLogging(createUnifiedOptionsStorageImpl(), unifiedOptionsLoggingConfig);
}

/**
 * `optionsMetadata` is the one place an options list is declared, and its keys
 * are the one list of what exists. Two things project it and neither is
 * downstream of the other: the type registry in ../modules/options-registry.ts
 * builds a config per key, and ./unified-options-catalog.ts publishes the
 * descriptive half as the `options-lists` shared catalog.
 */
export { optionsMetadata };
