import { getClient } from './transaction-context';
import { helps, type Help, type InsertHelp } from "@shared/schema";
import { eq, asc, sql } from "drizzle-orm";

export interface HelpStorage {
  getAll(): Promise<Help[]>;
  get(id: string): Promise<Help | undefined>;
  create(data: InsertHelp): Promise<Help>;
  update(id: string, data: Partial<InsertHelp>): Promise<Help | undefined>;
  delete(id: string): Promise<boolean>;
  /**
   * Return all help entries whose `paths` patterns match the given URL
   * path. Patterns are SQL LIKE-style with `%` wildcards (e.g.
   * `/config/dispatch-job-type/%/eligibility-plugins`).
   */
  findMatchingForPath(path: string): Promise<Help[]>;
}

export function createHelpStorage(): HelpStorage {
  return {
    async getAll(): Promise<Help[]> {
      const client = getClient();
      return await client.select().from(helps).orderBy(asc(helps.summary));
    },

    async get(id: string): Promise<Help | undefined> {
      const client = getClient();
      const [row] = await client.select().from(helps).where(eq(helps.id, id));
      return row || undefined;
    },

    async create(data: InsertHelp): Promise<Help> {
      const client = getClient();
      const [row] = await client.insert(helps).values(data).returning();
      return row;
    },

    async update(id: string, data: Partial<InsertHelp>): Promise<Help | undefined> {
      const client = getClient();
      const [row] = await client.update(helps).set(data).where(eq(helps.id, id)).returning();
      return row || undefined;
    },

    async delete(id: string): Promise<boolean> {
      const client = getClient();
      const result = await client.delete(helps).where(eq(helps.id, id)).returning({ id: helps.id });
      return result.length > 0;
    },

    async findMatchingForPath(path: string): Promise<Help[]> {
      const client = getClient();
      return await client
        .select()
        .from(helps)
        .where(sql`EXISTS (SELECT 1 FROM unnest(${helps.paths}) AS pattern WHERE ${path} LIKE pattern)`)
        .orderBy(asc(helps.summary));
    },
  };
}
