import { db } from "../db";
import { 
  edlsCrews, 
  type EdlsCrew, 
  type InsertEdlsCrew
} from "@shared/schema";
import { eq, sql } from "drizzle-orm";

export interface EdlsCrewsStorage {
  getBySheetId(sheetId: string): Promise<EdlsCrew[]>;
  get(id: string): Promise<EdlsCrew | undefined>;
  create(crew: InsertEdlsCrew): Promise<EdlsCrew>;
  update(id: string, crew: Partial<InsertEdlsCrew>): Promise<EdlsCrew | undefined>;
  delete(id: string): Promise<boolean>;
  deleteBySheetId(sheetId: string): Promise<number>;
  getCrewsTotalWorkerCount(sheetId: string): Promise<number>;
  validateCrewsWorkerCount(sheetId: string, expectedTotal: number): Promise<boolean>;
}

export function createEdlsCrewsStorage(): EdlsCrewsStorage {
  return {
    async getBySheetId(sheetId: string): Promise<EdlsCrew[]> {
      return db.select().from(edlsCrews).where(eq(edlsCrews.sheetId, sheetId));
    },

    async get(id: string): Promise<EdlsCrew | undefined> {
      const [crew] = await db.select().from(edlsCrews).where(eq(edlsCrews.id, id));
      return crew || undefined;
    },

    async create(insertCrew: InsertEdlsCrew): Promise<EdlsCrew> {
      const [crew] = await db.insert(edlsCrews).values(insertCrew).returning();
      return crew;
    },

    async update(id: string, crewUpdate: Partial<InsertEdlsCrew>): Promise<EdlsCrew | undefined> {
      const [crew] = await db
        .update(edlsCrews)
        .set(crewUpdate)
        .where(eq(edlsCrews.id, id))
        .returning();
      return crew || undefined;
    },

    async delete(id: string): Promise<boolean> {
      const result = await db.delete(edlsCrews).where(eq(edlsCrews.id, id)).returning();
      return result.length > 0;
    },

    async deleteBySheetId(sheetId: string): Promise<number> {
      const result = await db.delete(edlsCrews).where(eq(edlsCrews.sheetId, sheetId)).returning();
      return result.length;
    },

    async getCrewsTotalWorkerCount(sheetId: string): Promise<number> {
      const [result] = await db
        .select({ total: sql<number>`COALESCE(SUM(${edlsCrews.workerCount}), 0)::int` })
        .from(edlsCrews)
        .where(eq(edlsCrews.sheetId, sheetId));
      return result?.total || 0;
    },

    async validateCrewsWorkerCount(sheetId: string, expectedTotal: number): Promise<boolean> {
      const total = await this.getCrewsTotalWorkerCount(sheetId);
      return total === expectedTotal;
    }
  };
}
