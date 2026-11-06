import { getClient } from '../../transaction-context';
import { eq } from "drizzle-orm";
import { tableExists as tableExistsUtil } from "../../utils";
import { 
  btuTerritories,
  btuTerritoryReps,
  type BtuTerritory, 
  type InsertBtuTerritory 
} from "../../../../shared/schema/sitespecific/btu/schema";
import { contacts } from "@shared/schema";
import { getTableName } from "drizzle-orm";

export type { BtuTerritory, InsertBtuTerritory };

export interface BtuTerritoriesStorage {
  getAll(): Promise<BtuTerritory[]>;
  getFieldRepOptions(): Promise<Array<{ id: string; name: string }>>;
  get(id: string): Promise<BtuTerritory | undefined>;
  create(record: InsertBtuTerritory): Promise<BtuTerritory>;
  update(id: string, record: Partial<InsertBtuTerritory>): Promise<BtuTerritory | undefined>;
  delete(id: string): Promise<boolean>;
  tableExists(): Promise<boolean>;
}

const tableName = getTableName(btuTerritories);

export function createBtuTerritoriesStorage(): BtuTerritoriesStorage {
  return {
    async getFieldRepOptions() {
      const rows = await getClient()
        .selectDistinct({ id: contacts.id, name: contacts.displayName })
        .from(btuTerritoryReps)
        .innerJoin(contacts, eq(contacts.id, btuTerritoryReps.contactId))
        .orderBy(contacts.displayName, contacts.id);
      return rows.map(row => ({ id: row.id, name: row.name || row.id }));
    },
    async tableExists(): Promise<boolean> {
      return tableExistsUtil(tableName);
    },

    async getAll(): Promise<BtuTerritory[]> {
      if (!(await this.tableExists())) {
        throw new Error("COMPONENT_TABLE_NOT_FOUND");
      }
      const client = getClient();
      return client
        .select()
        .from(btuTerritories)
        .orderBy(btuTerritories.name);
    },

    async get(id: string): Promise<BtuTerritory | undefined> {
      if (!(await this.tableExists())) {
        throw new Error("COMPONENT_TABLE_NOT_FOUND");
      }
      const client = getClient();
      const results = await client
        .select()
        .from(btuTerritories)
        .where(eq(btuTerritories.id, id));
      return results[0];
    },

    async create(record: InsertBtuTerritory): Promise<BtuTerritory> {
      if (!(await this.tableExists())) {
        throw new Error("COMPONENT_TABLE_NOT_FOUND");
      }
      const client = getClient();
      const results = await client
        .insert(btuTerritories)
        .values(record)
        .returning();
      return results[0];
    },

    async update(id: string, record: Partial<InsertBtuTerritory>): Promise<BtuTerritory | undefined> {
      if (!(await this.tableExists())) {
        throw new Error("COMPONENT_TABLE_NOT_FOUND");
      }
      const client = getClient();
      const results = await client
        .update(btuTerritories)
        .set(record)
        .where(eq(btuTerritories.id, id))
        .returning();
      return results[0];
    },

    async delete(id: string): Promise<boolean> {
      if (!(await this.tableExists())) {
        throw new Error("COMPONENT_TABLE_NOT_FOUND");
      }
      const client = getClient();
      const results = await client
        .delete(btuTerritories)
        .where(eq(btuTerritories.id, id))
        .returning({ id: btuTerritories.id });
      return results.length > 0;
    },
  };
}
