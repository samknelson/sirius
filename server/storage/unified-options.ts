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
} from "@shared/schema";
import { type StorageLoggingConfig } from "./middleware/logging";

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
  | "edls-task";

interface OptionsTableMetadata<T extends PgTable<TableConfig>> {
  table: T;
  displayName: string;
  orderByColumn?: keyof T["_"]["columns"];
  loggingModule: string;
  requiredFields: string[];
  optionalFields: string[];
}

const optionsMetadata = {
  "department": {
    table: optionsDepartment,
    displayName: "Department",
    orderByColumn: "name" as const,
    loggingModule: "options.departments",
    requiredFields: ["name"],
    optionalFields: ["description"],
  },
  "employer-type": {
    table: optionsEmployerType,
    displayName: "Employer Type",
    orderByColumn: "sequence" as const,
    loggingModule: "options.employerTypes",
    requiredFields: ["name"],
    optionalFields: ["description", "data", "sequence"],
  },
  "employer-contact-type": {
    table: optionsEmployerContactType,
    displayName: "Employer Contact Type",
    orderByColumn: "name" as const,
    loggingModule: "options.employerContactTypes",
    requiredFields: ["name"],
    optionalFields: ["description"],
  },
  "worker-id-type": {
    table: optionsWorkerIdType,
    displayName: "Worker ID Type",
    orderByColumn: "sequence" as const,
    loggingModule: "options.workerIdTypes",
    requiredFields: ["name"],
    optionalFields: ["sequence", "validator", "data"],
  },
  "gender": {
    table: optionsGender,
    displayName: "Gender",
    orderByColumn: "sequence" as const,
    loggingModule: "options.gender",
    requiredFields: ["name", "code"],
    optionalFields: ["nota", "sequence", "data"],
  },
  "trust-benefit-type": {
    table: optionsTrustBenefitType,
    displayName: "Trust Benefit Type",
    orderByColumn: "sequence" as const,
    loggingModule: "options.trustBenefitTypes",
    requiredFields: ["name"],
    optionalFields: ["description", "sequence", "data"],
  },
  "trust-provider-type": {
    table: optionsTrustProviderType,
    displayName: "Trust Provider Type",
    orderByColumn: "name" as const,
    loggingModule: "options.trustProviderTypes",
    requiredFields: ["name"],
    optionalFields: ["description"],
  },
  "worker-ws": {
    table: optionsWorkerWs,
    displayName: "Work Status",
    orderByColumn: "sequence" as const,
    loggingModule: "options.workerWs",
    requiredFields: ["name"],
    optionalFields: ["shortName", "description", "sequence", "data"],
  },
  "employment-status": {
    table: optionsEmploymentStatus,
    displayName: "Employment Status",
    orderByColumn: "sequence" as const,
    loggingModule: "options.employmentStatus",
    requiredFields: ["name"],
    optionalFields: ["description", "sequence", "data"],
  },
  "event-type": {
    table: optionsEventType,
    displayName: "Event Type",
    orderByColumn: "name" as const,
    loggingModule: "options.eventTypes",
    requiredFields: ["name"],
    optionalFields: ["description", "data"],
  },
  "dispatch-job-type": {
    table: optionsDispatchJobType,
    displayName: "Dispatch Job Type",
    orderByColumn: "name" as const,
    loggingModule: "options.dispatchJobTypes",
    requiredFields: ["name"],
    optionalFields: ["description", "data"],
  },
  "ledger-payment-type": {
    table: optionsLedgerPaymentType,
    displayName: "Ledger Payment Type",
    orderByColumn: "sequence" as const,
    loggingModule: "options.ledgerPaymentTypes",
    requiredFields: ["name", "category"],
    optionalFields: ["description", "sequence", "currencyCode", "data"],
  },
  "skill": {
    table: optionsSkills,
    displayName: "Skill",
    orderByColumn: "name" as const,
    loggingModule: "options.skills",
    requiredFields: ["name"],
    optionalFields: ["description", "data"],
  },
  "edls-task": {
    table: optionsEdlsTasks,
    displayName: "EDLS Task",
    orderByColumn: "name" as const,
    loggingModule: "options.edlsTasks",
    requiredFields: ["name", "departmentId"],
    optionalFields: ["siriusId", "data"],
  },
} as const;

export type OptionsMetadataMap = typeof optionsMetadata;

export interface UnifiedOptionsStorage {
  list(type: OptionsTypeName): Promise<any[]>;
  get(type: OptionsTypeName, id: string): Promise<any | undefined>;
  create(type: OptionsTypeName, data: Record<string, any>): Promise<any>;
  update(type: OptionsTypeName, id: string, data: Record<string, any>): Promise<any | undefined>;
  delete(type: OptionsTypeName, id: string): Promise<boolean>;
  getMetadata(type: OptionsTypeName): typeof optionsMetadata[OptionsTypeName] | undefined;
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
      const client = getClient();
      const { table } = getTable(type);
      const [result] = await client.insert(table).values(data as any).returning();
      return result;
    },

    async update(type: OptionsTypeName, id: string, data: Record<string, any>): Promise<any | undefined> {
      const client = getClient();
      const { table } = getTable(type);
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
