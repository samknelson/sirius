import { getClient } from './transaction-context';
import { eq } from "drizzle-orm";
import { tableExists as tableExistsUtil } from "./utils";
import { 
  sitespecificBtuSchoolAttributes,
  type BtuSchoolAttributes, 
  type InsertBtuSchoolAttributes 
} from "../../shared/schema/sitespecific/btu/schema";
import { getTableName } from "drizzle-orm";

export type { BtuSchoolAttributes, InsertBtuSchoolAttributes };

export interface BtuSchoolAttributesStorage {
  getAll(): Promise<BtuSchoolAttributes[]>;
  get(id: string): Promise<BtuSchoolAttributes | undefined>;
  getByEmployerId(employerId: string): Promise<BtuSchoolAttributes | undefined>;
  create(record: InsertBtuSchoolAttributes): Promise<BtuSchoolAttributes>;
  update(id: string, record: Partial<InsertBtuSchoolAttributes>): Promise<BtuSchoolAttributes | undefined>;
  delete(id: string): Promise<boolean>;
  tableExists(): Promise<boolean>;
}

const tableName = getTableName(sitespecificBtuSchoolAttributes);

export function createBtuSchoolAttributesStorage(): BtuSchoolAttributesStorage {
  return {
    async tableExists(): Promise<boolean> {
      return tableExistsUtil(tableName);
    },

    async getAll(): Promise<BtuSchoolAttributes[]> {
      if (!(await this.tableExists())) {
        throw new Error("COMPONENT_TABLE_NOT_FOUND");
      }
      const client = getClient();
      return client
        .select()
        .from(sitespecificBtuSchoolAttributes);
    },

    async get(id: string): Promise<BtuSchoolAttributes | undefined> {
      if (!(await this.tableExists())) {
        throw new Error("COMPONENT_TABLE_NOT_FOUND");
      }
      const client = getClient();
      const results = await client
        .select()
        .from(sitespecificBtuSchoolAttributes)
        .where(eq(sitespecificBtuSchoolAttributes.id, id));
      return results[0];
    },

    async getByEmployerId(employerId: string): Promise<BtuSchoolAttributes | undefined> {
      if (!(await this.tableExists())) {
        throw new Error("COMPONENT_TABLE_NOT_FOUND");
      }
      const client = getClient();
      const results = await client
        .select()
        .from(sitespecificBtuSchoolAttributes)
        .where(eq(sitespecificBtuSchoolAttributes.employerId, employerId));
      return results[0];
    },

    async create(record: InsertBtuSchoolAttributes): Promise<BtuSchoolAttributes> {
      if (!(await this.tableExists())) {
        throw new Error("COMPONENT_TABLE_NOT_FOUND");
      }
      const client = getClient();
      const results = await client
        .insert(sitespecificBtuSchoolAttributes)
        .values(record)
        .returning();
      return results[0];
    },

    async update(id: string, record: Partial<InsertBtuSchoolAttributes>): Promise<BtuSchoolAttributes | undefined> {
      if (!(await this.tableExists())) {
        throw new Error("COMPONENT_TABLE_NOT_FOUND");
      }
      const client = getClient();
      const results = await client
        .update(sitespecificBtuSchoolAttributes)
        .set(record)
        .where(eq(sitespecificBtuSchoolAttributes.id, id))
        .returning();
      return results[0];
    },

    async delete(id: string): Promise<boolean> {
      if (!(await this.tableExists())) {
        throw new Error("COMPONENT_TABLE_NOT_FOUND");
      }
      const client = getClient();
      const results = await client
        .delete(sitespecificBtuSchoolAttributes)
        .where(eq(sitespecificBtuSchoolAttributes.id, id))
        .returning({ id: sitespecificBtuSchoolAttributes.id });
      return results.length > 0;
    },
  };
}
