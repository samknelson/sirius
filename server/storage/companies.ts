import { getClient } from './transaction-context';
import { companies, type Company, type InsertCompany, employerCompanies, type EmployerCompany, type InsertEmployerCompany } from "@shared/schema/employer/company-schema";
import { eq } from "drizzle-orm";

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
