import { getClient } from './transaction-context';
import { companies, type Company, type InsertCompany, employerCompanies, type EmployerCompany, type InsertEmployerCompany } from "@shared/schema/employer/company-schema";
import { eq } from "drizzle-orm";
import { type StorageLoggingConfig } from "./middleware/logging";

export interface CompanyStorage {
  getAll(): Promise<Company[]>;
  get(id: string): Promise<Company | undefined>;
  create(company: InsertCompany): Promise<Company>;
  update(id: string, company: Partial<InsertCompany>): Promise<Company | undefined>;
  delete(id: string): Promise<boolean>;
}

export interface EmployerCompanyStorage {
  getByCompanyId(companyId: string): Promise<EmployerCompany[]>;
  getByEmployerId(employerId: string): Promise<EmployerCompany | undefined>;
  create(ec: InsertEmployerCompany): Promise<EmployerCompany>;
  delete(id: string): Promise<boolean>;
}

export function createCompanyStorage(): CompanyStorage {
  return {
    async getAll(): Promise<Company[]> {
      const client = getClient();
      return await client.select().from(companies).orderBy(companies.name);
    },

    async get(id: string): Promise<Company | undefined> {
      const client = getClient();
      const [company] = await client.select().from(companies).where(eq(companies.id, id));
      return company || undefined;
    },

    async create(company: InsertCompany): Promise<Company> {
      const client = getClient();
      const [created] = await client.insert(companies).values(company).returning();
      return created;
    },

    async update(id: string, company: Partial<InsertCompany>): Promise<Company | undefined> {
      const client = getClient();
      const [updated] = await client.update(companies).set(company).where(eq(companies.id, id)).returning();
      return updated || undefined;
    },

    async delete(id: string): Promise<boolean> {
      const client = getClient();
      const result = await client.delete(companies).where(eq(companies.id, id)).returning();
      return result.length > 0;
    },
  };
}

export function createEmployerCompanyStorage(): EmployerCompanyStorage {
  return {
    async getByCompanyId(companyId: string): Promise<EmployerCompany[]> {
      const client = getClient();
      return await client.select().from(employerCompanies).where(eq(employerCompanies.companyId, companyId));
    },

    async getByEmployerId(employerId: string): Promise<EmployerCompany | undefined> {
      const client = getClient();
      const [ec] = await client.select().from(employerCompanies).where(eq(employerCompanies.employerId, employerId));
      return ec || undefined;
    },

    async create(ec: InsertEmployerCompany): Promise<EmployerCompany> {
      const client = getClient();
      const [created] = await client.insert(employerCompanies).values(ec).returning();
      return created;
    },

    async delete(id: string): Promise<boolean> {
      const client = getClient();
      const result = await client.delete(employerCompanies).where(eq(employerCompanies.id, id)).returning();
      return result.length > 0;
    },
  };
}

export const companyLoggingConfig: StorageLoggingConfig<CompanyStorage> = {
  module: 'companies',
  methods: {
    create: {
      enabled: true,
      getEntityId: (args, result) => result?.id || args[0]?.name || 'new company',
      getHostEntityId: (args, result) => result?.id,
      after: async (args, result) => result,
    },
    update: {
      enabled: true,
      getEntityId: (args) => args[0],
      getHostEntityId: (args) => args[0],
      before: async (args, storage) => await storage.get(args[0]),
      after: async (args, result) => result,
    },
    delete: {
      enabled: true,
      getEntityId: (args) => args[0],
      getHostEntityId: (args, result, beforeState) => beforeState?.id || args[0],
      before: async (args, storage) => await storage.get(args[0]),
    },
  },
};

export const employerCompanyLoggingConfig: StorageLoggingConfig<EmployerCompanyStorage> = {
  module: 'employer-companies',
  methods: {
    create: {
      enabled: true,
      getEntityId: (args, result) => result?.id || 'new employer-company',
      getHostEntityId: (args, result) => result?.employerId || args[0]?.employerId,
      after: async (args, result) => result,
    },
    delete: {
      enabled: true,
      getEntityId: (args) => args[0],
      before: async (args, storage) => {
        return undefined;
      },
    },
  },
};
