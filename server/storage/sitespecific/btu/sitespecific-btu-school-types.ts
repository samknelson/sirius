import { getClient } from '../../transaction-context';
import { eq } from "drizzle-orm";
import { tableExists as tableExistsUtil } from "../../utils";
import { 
  sitespecificBtuSchoolTypes,
  type BtuSchoolType, 
  type InsertBtuSchoolType 
} from "../../../../shared/schema/sitespecific/btu/schema";
import { getTableName } from "drizzle-orm";

export type { BtuSchoolType, InsertBtuSchoolType };

export interface BtuSchoolTypesStorage {
  getAll(): Promise<BtuSchoolType[]>;
  get(id: string): Promise<BtuSchoolType | undefined>;
  create(record: InsertBtuSchoolType): Promise<BtuSchoolType>;
  update(id: string, record: Partial<InsertBtuSchoolType>): Promise<BtuSchoolType | undefined>;
  delete(id: string): Promise<boolean>;
  tableExists(): Promise<boolean>;
}

const tableName = getTableName(sitespecificBtuSchoolTypes);

export function createBtuSchoolTypesStorage(): BtuSchoolTypesStorage {
  return {
    async tableExists(): Promise<boolean> {
      return tableExistsUtil(tableName);
    },

    async getAll(): Promise<BtuSchoolType[]> {
      if (!(await this.tableExists())) {
        throw new Error("COMPONENT_TABLE_NOT_FOUND");
      }
      const client = getClient();
      return client
        .select()
        .from(sitespecificBtuSchoolTypes)
        .orderBy(sitespecificBtuSchoolTypes.name);
    },

    async get(id: string): Promise<BtuSchoolType | undefined> {
      if (!(await this.tableExists())) {
        throw new Error("COMPONENT_TABLE_NOT_FOUND");
      }
      const client = getClient();
      const results = await client
        .select()
        .from(sitespecificBtuSchoolTypes)
        .where(eq(sitespecificBtuSchoolTypes.id, id));
      return results[0];
    },

    async create(record: InsertBtuSchoolType): Promise<BtuSchoolType> {
      if (!(await this.tableExists())) {
        throw new Error("COMPONENT_TABLE_NOT_FOUND");
      }
      const client = getClient();
      const results = await client
        .insert(sitespecificBtuSchoolTypes)
        .values(record)
        .returning();
      return results[0];
    },

    async update(id: string, record: Partial<InsertBtuSchoolType>): Promise<BtuSchoolType | undefined> {
      if (!(await this.tableExists())) {
        throw new Error("COMPONENT_TABLE_NOT_FOUND");
      }
      const client = getClient();
      const results = await client
        .update(sitespecificBtuSchoolTypes)
        .set(record)
        .where(eq(sitespecificBtuSchoolTypes.id, id))
        .returning();
      return results[0];
    },

    async delete(id: string): Promise<boolean> {
      if (!(await this.tableExists())) {
        throw new Error("COMPONENT_TABLE_NOT_FOUND");
      }
      const client = getClient();
      const results = await client
        .delete(sitespecificBtuSchoolTypes)
        .where(eq(sitespecificBtuSchoolTypes.id, id))
        .returning({ id: sitespecificBtuSchoolTypes.id });
      return results.length > 0;
    },
  };
}
