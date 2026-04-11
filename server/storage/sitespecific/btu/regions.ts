import { getClient } from '../../transaction-context';
import { eq } from "drizzle-orm";
import { tableExists as tableExistsUtil } from "../../utils";
import { 
  sitespecificBtuRegions,
  type BtuRegion, 
  type InsertBtuRegion 
} from "../../../../shared/schema/sitespecific/btu/schema";
import { getTableName } from "drizzle-orm";

export type { BtuRegion, InsertBtuRegion };

export interface BtuRegionsStorage {
  getAll(): Promise<BtuRegion[]>;
  get(id: string): Promise<BtuRegion | undefined>;
  create(record: InsertBtuRegion): Promise<BtuRegion>;
  update(id: string, record: Partial<InsertBtuRegion>): Promise<BtuRegion | undefined>;
  delete(id: string): Promise<boolean>;
  tableExists(): Promise<boolean>;
}

const tableName = getTableName(sitespecificBtuRegions);

export function createBtuRegionsStorage(): BtuRegionsStorage {
  return {
    async tableExists(): Promise<boolean> {
      return tableExistsUtil(tableName);
    },

    async getAll(): Promise<BtuRegion[]> {
      if (!(await this.tableExists())) {
        throw new Error("COMPONENT_TABLE_NOT_FOUND");
      }
      const client = getClient();
      return client
        .select()
        .from(sitespecificBtuRegions)
        .orderBy(sitespecificBtuRegions.name);
    },

    async get(id: string): Promise<BtuRegion | undefined> {
      if (!(await this.tableExists())) {
        throw new Error("COMPONENT_TABLE_NOT_FOUND");
      }
      const client = getClient();
      const results = await client
        .select()
        .from(sitespecificBtuRegions)
        .where(eq(sitespecificBtuRegions.id, id));
      return results[0];
    },

    async create(record: InsertBtuRegion): Promise<BtuRegion> {
      if (!(await this.tableExists())) {
        throw new Error("COMPONENT_TABLE_NOT_FOUND");
      }
      const client = getClient();
      const results = await client
        .insert(sitespecificBtuRegions)
        .values(record)
        .returning();
      return results[0];
    },

    async update(id: string, record: Partial<InsertBtuRegion>): Promise<BtuRegion | undefined> {
      if (!(await this.tableExists())) {
        throw new Error("COMPONENT_TABLE_NOT_FOUND");
      }
      const client = getClient();
      const results = await client
        .update(sitespecificBtuRegions)
        .set(record)
        .where(eq(sitespecificBtuRegions.id, id))
        .returning();
      return results[0];
    },

    async delete(id: string): Promise<boolean> {
      if (!(await this.tableExists())) {
        throw new Error("COMPONENT_TABLE_NOT_FOUND");
      }
      const client = getClient();
      const results = await client
        .delete(sitespecificBtuRegions)
        .where(eq(sitespecificBtuRegions.id, id))
        .returning({ id: sitespecificBtuRegions.id });
      return results.length > 0;
    },
  };
}
