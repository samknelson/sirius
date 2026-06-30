import { createNoopValidator } from './utils/validation';
import { getClient } from './transaction-context';
import { eq, asc, SQL } from "drizzle-orm";
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
  optionsSkills,
  optionsEdlsTasks,
  optionsCertifications,
  optionsWorkerRatings,
  optionsClassifications,
  optionsIndustry,
  optionsWorkerMs,
  optionsWorkerRelationType,
  optionsCommTags,
  optionsGrievanceStatus,
  optionsGrievanceCategory,
  optionsGrievanceSteps,
  optionsGrievanceComplaints,
  optionsGrievanceRemedies,
  optionsGrievanceRoles,
  bulkMediumEnum,
} from "@shared/schema";
import { defineLoggingConfig } from "./middleware/logging";
import type { JsonSchema, UiSchema } from "@shared/json-schema-form";

/**
 * Stub validator - add validation logic here when needed
 */
export const validate = createNoopValidator();

export type OptionsTypeName = 
  | "department"
  | "employer-type"
  | "employer-contact-type"
  | "worker-id-type"
  | "gender"
  | "trust-benefit-type"
  | "trust-provider-type"
  | "worker-ws"
  | "employment-status"
  | "event-type"
  | "dispatch-job-type"
  | "ledger-payment-type"
  | "skill"
  | "edls-task"
  | "certification"
  | "worker-rating"
  | "classification"
  | "industry"
  | "worker-ms"
  | "worker-relation-type"
  | "comm-tag"
  | "grievance-status"
  | "grievance-category"
  | "grievance-step"
  | "grievance-complaint"
  | "grievance-remedy"
  | "grievance-role";

/**
 * Field definition for dynamic form and table rendering
 */
export interface FieldDefinition {
  name: string;
  label: string;
  inputType: 'text' | 'textarea' | 'number' | 'select-self' | 'icon' | 'checkbox' | 'select-options' | 'color' | 'multi-enum' | 'enum' | 'system-roles';
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
   * Optional form default for the generated JSON Schema. Currently honored
   * for `checkbox` fields (otherwise checkboxes default to false). Lets a
   * field opt into a `true` default so newly created rows come in checked.
   */
  default?: boolean;
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

interface OptionsTableMetadata<T extends PgTable<TableConfig>> {
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
  fields: FieldDefinition[];
}

const optionsMetadata: Record<OptionsTypeName, OptionsTableMetadata<any>> = {
  "department": {
    table: optionsDepartment,
    displayName: "Departments",
    description: "Manage organizational departments",
    singularName: "Department",
    pluralName: "Departments",
    orderByColumn: "name" as const,
    loggingModule: "options.departments",
    requiredFields: ["name"],
    optionalFields: ["description"],
    supportsSequencing: false,
    fields: [
      { name: "name", label: "Name", inputType: "text", required: true, placeholder: "Department name", showInTable: true, columnHeader: "Name" },
      { name: "description", label: "Description", inputType: "textarea", required: false, placeholder: "Optional description", showInTable: true, columnHeader: "Description" },
    ],
  },
  "employer-type": {
    table: optionsEmployerType,
    displayName: "Employer Types",
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
    displayName: "Employer Contact Types",
    description: "Manage types of employer contacts",
    singularName: "Employer Contact Type",
    pluralName: "Employer Contact Types",
    orderByColumn: "name" as const,
    loggingModule: "options.employerContactTypes",
    requiredFields: ["name"],
    optionalFields: ["description"],
    supportsSequencing: false,
    fields: [
      { name: "name", label: "Name", inputType: "text", required: true, placeholder: "Contact type name", showInTable: true, columnHeader: "Name" },
      { name: "description", label: "Description", inputType: "textarea", required: false, placeholder: "Optional description", showInTable: true, columnHeader: "Description" },
    ],
  },
  "worker-id-type": {
    table: optionsWorkerIdType,
    displayName: "Worker ID Types",
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
    displayName: "Gender Options",
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
    displayName: "Trust Benefit Types",
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
    displayName: "Trust Provider Types",
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
    displayName: "Work Statuses",
    description: "Manage worker status options",
    singularName: "Work Status",
    pluralName: "Work Statuses",
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
    displayName: "Member Statuses",
    description: "Manage worker member status options",
    singularName: "Member Status",
    pluralName: "Member Statuses",
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
    displayName: "Employment Statuses",
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
    displayName: "Event Types",
    description: "Manage types of events",
    singularName: "Event Type",
    pluralName: "Event Types",
    orderByColumn: "name" as const,
    loggingModule: "options.eventTypes",
    requiredFields: ["name"],
    optionalFields: ["description", "data"],
    supportsSequencing: false,
    fields: [
      { name: "name", label: "Name", inputType: "text", required: true, placeholder: "Event type name", showInTable: true, columnHeader: "Name" },
      { name: "description", label: "Description", inputType: "textarea", required: false, placeholder: "Optional description", showInTable: true, columnHeader: "Description" },
    ],
  },
  "dispatch-job-type": {
    table: optionsDispatchJobType,
    displayName: "Dispatch Job Types",
    description: "Manage types of dispatch jobs",
    singularName: "Dispatch Job Type",
    pluralName: "Dispatch Job Types",
    orderByColumn: "name" as const,
    loggingModule: "options.dispatchJobTypes",
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
    displayName: "Ledger Payment Types",
    description: "Manage payment type options for ledger entries",
    singularName: "Payment Type",
    pluralName: "Payment Types",
    orderByColumn: "sequence" as const,
    loggingModule: "options.ledgerPaymentTypes",
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
  "grievance-status": {
    table: optionsGrievanceStatus,
    displayName: "Grievance Status Options",
    description: "Manage status options for grievances",
    singularName: "Status Option",
    pluralName: "Status Options",
    orderByColumn: "sequence" as const,
    loggingModule: "options.grievanceStatus",
    requiredFields: ["name"],
    optionalFields: ["description", "siriusId", "open", "sequence", "data"],
    supportsSequencing: true,
    requiredComponent: "grievance",
    fields: [
      { name: "icon", label: "Icon", inputType: "icon", required: false, showInTable: true, columnHeader: "Icon", columnWidth: "80px", dataField: true },
      { name: "name", label: "Name", inputType: "text", required: true, placeholder: "e.g., Open, In Review, Resolved", showInTable: true, columnHeader: "Name" },
      { name: "description", label: "Description", inputType: "textarea", required: false, placeholder: "Optional description of this status", showInTable: true, columnHeader: "Description" },
      { name: "siriusId", label: "Sirius ID", inputType: "text", required: false, placeholder: "External ID", showInTable: true, columnHeader: "Sirius ID" },
      { name: "open", label: "Open", inputType: "checkbox", required: false, default: true, helperText: "Marks whether this status represents an open grievance state", showInTable: true, columnHeader: "Open" },
    ],
  },
  "grievance-category": {
    table: optionsGrievanceCategory,
    displayName: "Grievance Category Options",
    description: "Manage category options for grievances",
    singularName: "Category Option",
    pluralName: "Category Options",
    orderByColumn: "name" as const,
    loggingModule: "options.grievanceCategory",
    requiredFields: ["name"],
    optionalFields: ["description", "data"],
    supportsSequencing: false,
    requiredComponent: "grievance",
    fields: [
      { name: "icon", label: "Icon", inputType: "icon", required: false, showInTable: true, columnHeader: "Icon", columnWidth: "80px", dataField: true },
      { name: "name", label: "Name", inputType: "text", required: true, placeholder: "e.g., Discipline, Pay, Safety", showInTable: true, columnHeader: "Name" },
      { name: "description", label: "Description", inputType: "textarea", required: false, placeholder: "Optional description of this category", showInTable: true, columnHeader: "Description" },
    ],
  },
  "grievance-step": {
    table: optionsGrievanceSteps,
    displayName: "Grievance Step Options",
    description: "Manage step options for grievances",
    singularName: "Step Option",
    pluralName: "Step Options",
    orderByColumn: "sequence" as const,
    loggingModule: "options.grievanceStep",
    requiredFields: ["name", "actor"],
    optionalFields: ["description", "siriusId", "sequence", "data"],
    supportsSequencing: true,
    requiredComponent: "grievance",
    fields: [
      { name: "icon", label: "Icon", inputType: "icon", required: false, showInTable: true, columnHeader: "Icon", columnWidth: "80px", dataField: true },
      { name: "name", label: "Name", inputType: "text", required: true, placeholder: "e.g., Step 1, Mediation", showInTable: true, columnHeader: "Name" },
      { name: "description", label: "Description", inputType: "textarea", required: false, placeholder: "Optional description of this step", showInTable: true, columnHeader: "Description" },
      { name: "actor", label: "Actor", inputType: "enum", required: true, enumOptions: [{ value: "union", label: "Union" }, { value: "employer", label: "Employer" }], showInTable: true, columnHeader: "Actor" },
      { name: "siriusId", label: "Sirius ID", inputType: "text", required: false, placeholder: "External ID", showInTable: true, columnHeader: "Sirius ID" },
    ],
  },
  "grievance-complaint": {
    table: optionsGrievanceComplaints,
    displayName: "Grievance Complaint Options",
    description: "Manage complaint options for grievances",
    singularName: "Complaint Option",
    pluralName: "Complaint Options",
    orderByColumn: "sequence" as const,
    loggingModule: "options.grievanceComplaint",
    requiredFields: ["name"],
    optionalFields: ["description", "siriusId", "sequence", "data"],
    supportsSequencing: true,
    requiredComponent: "grievance",
    fields: [
      { name: "icon", label: "Icon", inputType: "icon", required: false, showInTable: true, columnHeader: "Icon", columnWidth: "80px", dataField: true },
      { name: "name", label: "Name", inputType: "text", required: true, placeholder: "e.g., Wrongful Termination, Pay Dispute", showInTable: true, columnHeader: "Name" },
      { name: "description", label: "Description", inputType: "textarea", required: false, placeholder: "Optional description of this complaint", showInTable: true, columnHeader: "Description" },
      { name: "siriusId", label: "Sirius ID", inputType: "text", required: false, placeholder: "External ID", showInTable: true, columnHeader: "Sirius ID" },
    ],
  },
  "grievance-remedy": {
    table: optionsGrievanceRemedies,
    displayName: "Grievance Remedy Options",
    description: "Manage remedy options for grievances",
    singularName: "Remedy Option",
    pluralName: "Remedy Options",
    orderByColumn: "sequence" as const,
    loggingModule: "options.grievanceRemedy",
    requiredFields: ["name"],
    optionalFields: ["description", "siriusId", "sequence", "data"],
    supportsSequencing: true,
    requiredComponent: "grievance",
    fields: [
      { name: "icon", label: "Icon", inputType: "icon", required: false, showInTable: true, columnHeader: "Icon", columnWidth: "80px", dataField: true },
      { name: "name", label: "Name", inputType: "text", required: true, placeholder: "e.g., Reinstatement, Back Pay", showInTable: true, columnHeader: "Name" },
      { name: "description", label: "Description", inputType: "textarea", required: false, placeholder: "Optional description of this remedy", showInTable: true, columnHeader: "Description" },
      { name: "siriusId", label: "Sirius ID", inputType: "text", required: false, placeholder: "External ID", showInTable: true, columnHeader: "Sirius ID" },
    ],
  },
  "grievance-role": {
    table: optionsGrievanceRoles,
    displayName: "Grievance Role Options",
    description: "Manage role options for grievances",
    singularName: "Role Option",
    pluralName: "Role Options",
    orderByColumn: "sequence" as const,
    loggingModule: "options.grievanceRole",
    requiredFields: ["name"],
    optionalFields: ["description", "siriusId", "sequence", "data"],
    supportsSequencing: true,
    requiredComponent: "grievance",
    fields: [
      { name: "icon", label: "Icon", inputType: "icon", required: false, showInTable: true, columnHeader: "Icon", columnWidth: "80px", dataField: true },
      { name: "name", label: "Name", inputType: "text", required: true, placeholder: "e.g., Grievant, Steward, Witness", showInTable: true, columnHeader: "Name" },
      { name: "description", label: "Description", inputType: "textarea", required: false, placeholder: "Optional description of this role", showInTable: true, columnHeader: "Description" },
      { name: "permittedSystemRoleIds", label: "Permitted System Roles", inputType: "system-roles", required: false, helperText: "Only users holding one of these system roles can be assigned this grievance role. Leave empty to allow any user.", showInTable: false, dataField: true },
      { name: "siriusId", label: "Sirius ID", inputType: "text", required: false, placeholder: "External ID", showInTable: true, columnHeader: "Sirius ID" },
    ],
  },
  "skill": {
    table: optionsSkills,
    displayName: "Skills",
    description: "Manage skills and qualifications that can be assigned to workers",
    singularName: "Skill",
    pluralName: "Skills",
    orderByColumn: "name" as const,
    loggingModule: "options.skills",
    requiredFields: ["name"],
    optionalFields: ["description", "data"],
    supportsSequencing: false,
    requiredComponent: "worker.skills",
    fields: [
      { name: "icon", label: "Icon", inputType: "icon", required: false, showInTable: true, columnHeader: "Icon", dataField: true },
      { name: "name", label: "Name", inputType: "text", required: true, placeholder: "e.g., Welding, Plumbing, Electrical", showInTable: true, columnHeader: "Name" },
      { name: "description", label: "Description", inputType: "textarea", required: false, placeholder: "Optional description of this skill", showInTable: true, columnHeader: "Description" },
    ],
  },
  "edls-task": {
    table: optionsEdlsTasks,
    displayName: "EDLS Tasks",
    description: "Manage tasks for the Employer Day Labor Scheduler",
    singularName: "EDLS Task",
    pluralName: "EDLS Tasks",
    orderByColumn: "name" as const,
    loggingModule: "options.edlsTasks",
    requiredFields: ["name", "departmentId"],
    optionalFields: ["siriusId", "data"],
    supportsSequencing: false,
    fields: [
      { name: "name", label: "Name", inputType: "text", required: true, placeholder: "Task name", showInTable: true, columnHeader: "Name" },
      { name: "departmentId", label: "Department", inputType: "select-options", required: true, showInTable: true, columnHeader: "Department", selectOptionsType: "department" },
      { name: "siriusId", label: "Sirius ID", inputType: "text", required: false, placeholder: "External ID", showInTable: true, columnHeader: "Sirius ID" },
    ],
  },
  "certification": {
    table: optionsCertifications,
    displayName: "Certifications",
    description: "Manage certification types that can be assigned to workers",
    singularName: "Certification",
    pluralName: "Certifications",
    orderByColumn: "name" as const,
    loggingModule: "options.certifications",
    requiredFields: ["name"],
    optionalFields: ["siriusId", "data"],
    supportsSequencing: false,
    requiredComponent: "worker.certifications",
    fields: [
      { name: "name", label: "Name", inputType: "text", required: true, placeholder: "Certification name", showInTable: true, columnHeader: "Name" },
      { name: "icon", label: "Icon", inputType: "icon", required: false, placeholder: "Select an icon", showInTable: true, columnHeader: "Icon", columnWidth: "80px", dataField: true },
      { name: "skills", label: "Auto-Grant Skills", inputType: "select-options", required: false, helperText: "Skills to automatically grant when this certification is active", showInTable: false, selectOptionsType: "skill", dataField: true },
      { name: "defaultDuration", label: "Default Duration (months)", inputType: "number", required: false, placeholder: "e.g., 12", helperText: "Default validity period in months", showInTable: true, columnHeader: "Duration", dataField: true },
      { name: "siriusId", label: "Sirius ID", inputType: "text", required: false, placeholder: "External ID", showInTable: true, columnHeader: "Sirius ID" },
    ],
  },
  "worker-rating": {
    table: optionsWorkerRatings,
    displayName: "Rating Types",
    description: "Manage rating types for evaluating workers. Ratings can have parent ratings to create a hierarchy.",
    singularName: "Rating Type",
    pluralName: "Rating Types",
    orderByColumn: "name" as const,
    loggingModule: "options.workerRatings",
    requiredFields: ["name"],
    optionalFields: ["parent", "data"],
    supportsParent: true,
    requiredComponent: "worker.ratings",
    supportsSequencing: false,
    fields: [
      { name: "name", label: "Name", inputType: "text", required: true, placeholder: "e.g., Quality, Attendance, Teamwork", showInTable: true, columnHeader: "Name" },
      { name: "parent", label: "Parent Rating", inputType: "select-self", required: false, helperText: "Select a parent to create a hierarchy", showInTable: true, columnHeader: "Parent" },
    ],
  },
  "classification": {
    table: optionsClassifications,
    displayName: "Classifications",
    description: "Manage worker classification options",
    singularName: "Classification",
    pluralName: "Classifications",
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
    displayName: "Industries",
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
    displayName: "Comm Tags",
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
  "worker-relation-type": {
    table: optionsWorkerRelationType,
    displayName: "Relationship Types",
    description: "Manage relationship types used between workers (e.g. spouse, parent, sibling).",
    singularName: "Relationship Type",
    pluralName: "Relationship Types",
    orderByColumn: "name" as const,
    loggingModule: "options.workerRelationType",
    requiredFields: ["name"],
    optionalFields: ["siriusId", "description", "data"],
    requiredComponent: "worker.relations",
    supportsSequencing: false,
    fields: [
      { name: "name", label: "Name", inputType: "text", required: true, placeholder: "e.g., Spouse, Parent, Sibling", showInTable: true, columnHeader: "Name" },
      { name: "icon", label: "Icon", inputType: "icon", required: false, placeholder: "Select an icon", showInTable: true, columnHeader: "Icon", columnWidth: "80px", dataField: true },
      { name: "description", label: "Description", inputType: "text", required: false, placeholder: "Short description of this relationship type", showInTable: true, columnHeader: "Description" },
      { name: "siriusId", label: "Sirius ID", inputType: "text", required: false, placeholder: "External ID", showInTable: true, columnHeader: "Sirius ID" },
    ],
  },
};

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
      
      if (metadata.supportsParent && data.parent) {
        const allItems = await this.list(type);
        const parentExists = allItems.some((item: any) => item.id === data.parent);
        if (!parentExists) {
          throw new Error("Parent does not exist");
        }
      }
      
      const client = getClient();
      const { table } = getTable(type);
      const [result] = await client.insert(table).values(data as any).returning();
      return result;
    },

    async update(type: OptionsTypeName, id: string, data: Record<string, any>): Promise<any | undefined> {
      validate.validateOrThrow(type);
      const metadata = getTable(type) as any;
      
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
      const result = await client.delete(table).where(eq(tableAny.id, id)).returning();
      return result.length > 0;
    },

    getMetadata(type: OptionsTypeName) {
      return optionsMetadata[type];
    },

    getDefinition(type: OptionsTypeName): OptionsResourceDefinition | undefined {
      const metadata = optionsMetadata[type];
      if (!metadata) return undefined;
      const { schema, uiSchema } = fieldsToJsonSchema(metadata.fields);
      return {
        type,
        displayName: metadata.displayName,
        description: metadata.description,
        singularName: metadata.singularName,
        pluralName: metadata.pluralName,
        fields: metadata.fields,
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
        const { schema, uiSchema } = fieldsToJsonSchema(metadata.fields);
        return {
          type,
          displayName: metadata.displayName,
          description: metadata.description,
          singularName: metadata.singularName,
          pluralName: metadata.pluralName,
          fields: metadata.fields,
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
  methods: {
    create: {
      getEntityId: (args) => args[1]?.name || `new ${args[0]}`,
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
  return createUnifiedOptionsStorageImpl();
}

export { optionsMetadata };
