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
} from "@shared/schema";
import { type StorageLoggingConfig } from "./middleware/logging";

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
  | "worker-ms";

/**
 * Field definition for dynamic form and table rendering
 */
export interface FieldDefinition {
  name: string;
  label: string;
  inputType: 'text' | 'textarea' | 'number' | 'select-self' | 'icon' | 'checkbox' | 'select-options' | 'color';
  required: boolean;
  placeholder?: string;
  helperText?: string;
  showInTable: boolean;
  columnHeader?: string;
  columnWidth?: string;
  dataField?: boolean;
  selectOptionsType?: OptionsTypeName;
}

/**
 * Complete options resource definition for frontend consumption
 */
export interface OptionsResourceDefinition {
  type: OptionsTypeName;
  displayName: string;
  description?: string;
  singularName: string;
  pluralName: string;
  fields: FieldDefinition[];
  supportsSequencing: boolean;
  supportsParent: boolean;
  requiredComponent?: string;
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
    optionalFields: ["sequence", "validator", "data"],
    supportsSequencing: true,
    fields: [
      { name: "name", label: "Name", inputType: "text", required: true, placeholder: "ID type name", showInTable: true, columnHeader: "Name" },
      { name: "validator", label: "Validator", inputType: "text", required: false, placeholder: "Validation pattern", showInTable: false },
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
    optionalFields: ["description", "sequence", "data"],
    supportsSequencing: true,
    fields: [
      { name: "name", label: "Name", inputType: "text", required: true, placeholder: "Benefit type name", showInTable: true, columnHeader: "Name" },
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
    optionalFields: ["description", "sequence", "data"],
    supportsSequencing: true,
    fields: [
      { name: "name", label: "Name", inputType: "text", required: true, placeholder: "Member status name", showInTable: true, columnHeader: "Name" },
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
      
      return {
        type,
        displayName: metadata.displayName,
        description: metadata.description,
        singularName: metadata.singularName,
        pluralName: metadata.pluralName,
        fields: metadata.fields,
        supportsSequencing: metadata.supportsSequencing ?? false,
        supportsParent: metadata.supportsParent ?? false,
        requiredComponent: metadata.requiredComponent,
      };
    },

    getAllDefinitions(): OptionsResourceDefinition[] {
      return (Object.keys(optionsMetadata) as OptionsTypeName[]).map(type => {
        const metadata = optionsMetadata[type];
        return {
          type,
          displayName: metadata.displayName,
          description: metadata.description,
          singularName: metadata.singularName,
          pluralName: metadata.pluralName,
          fields: metadata.fields,
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

export const unifiedOptionsLoggingConfig: StorageLoggingConfig<UnifiedOptionsStorage> = {
  module: "options",
  methods: {
    create: {
      enabled: true,
      getEntityId: (args: any[]) => args[1]?.name || `new ${args[0]}`,
      after: async (args: any[], result: any) => result,
    },
    update: {
      enabled: true,
      getEntityId: (args: any[]) => args[1],
      before: async (args: any[], storage: UnifiedOptionsStorage) => {
        return await storage.get(args[0] as OptionsTypeName, args[1] as string);
      },
      after: async (args: any[], result: any) => result,
    },
    delete: {
      enabled: true,
      getEntityId: (args: any[]) => args[1],
      before: async (args: any[], storage: UnifiedOptionsStorage) => {
        return await storage.get(args[0] as OptionsTypeName, args[1] as string);
      },
    },
  },
};

export function createUnifiedOptionsStorage(): UnifiedOptionsStorage {
  return createUnifiedOptionsStorageImpl();
}

export { optionsMetadata };
