import { db } from "../db";
import { eq, desc } from "drizzle-orm";
import { tableExists as tableExistsUtil } from "./utils";
import { 
  sitespecificBtuCsg,
  BTU_CSG_TABLE_NAME,
  type BtuCsgRecord, 
  type InsertBtuCsgRecord 
} from "../../shared/schema/sitespecific/btu/schema";

export type { BtuCsgRecord, InsertBtuCsgRecord };

export interface BtuCsgStorage {
  getAll(): Promise<BtuCsgRecord[]>;
  get(id: string): Promise<BtuCsgRecord | undefined>;
  create(record: InsertBtuCsgRecord): Promise<BtuCsgRecord>;
  update(id: string, record: Partial<InsertBtuCsgRecord>): Promise<BtuCsgRecord | undefined>;
  delete(id: string): Promise<boolean>;
  tableExists(): Promise<boolean>;
}

export function createBtuCsgStorage(): BtuCsgStorage {
  return {
    async tableExists(): Promise<boolean> {
      return tableExistsUtil(BTU_CSG_TABLE_NAME);
    },

    async getAll(): Promise<BtuCsgRecord[]> {
      if (!(await this.tableExists())) {
        throw new Error("COMPONENT_TABLE_NOT_FOUND");
      }
      return db
        .select()
        .from(sitespecificBtuCsg)
        .orderBy(desc(sitespecificBtuCsg.createdAt));
    },

    async get(id: string): Promise<BtuCsgRecord | undefined> {
      if (!(await this.tableExists())) {
        throw new Error("COMPONENT_TABLE_NOT_FOUND");
      }
      const results = await db
        .select()
        .from(sitespecificBtuCsg)
        .where(eq(sitespecificBtuCsg.id, id));
      return results[0];
    },

    async create(record: InsertBtuCsgRecord): Promise<BtuCsgRecord> {
      if (!(await this.tableExists())) {
        throw new Error("COMPONENT_TABLE_NOT_FOUND");
      }
      const results = await db
        .insert(sitespecificBtuCsg)
        .values(record)
        .returning();
      return results[0];
    },

    async update(id: string, record: Partial<InsertBtuCsgRecord>): Promise<BtuCsgRecord | undefined> {
      if (!(await this.tableExists())) {
        throw new Error("COMPONENT_TABLE_NOT_FOUND");
      }
      const results = await db
        .update(sitespecificBtuCsg)
        .set(record)
        .where(eq(sitespecificBtuCsg.id, id))
        .returning();
      return results[0];
    },

    async delete(id: string): Promise<boolean> {
      if (!(await this.tableExists())) {
        throw new Error("COMPONENT_TABLE_NOT_FOUND");
      }
      const results = await db
        .delete(sitespecificBtuCsg)
        .where(eq(sitespecificBtuCsg.id, id))
        .returning({ id: sitespecificBtuCsg.id });
      return results.length > 0;
    },
  };
}
