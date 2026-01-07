import { db } from "../db";
import { 
  edlsSheets, 
  employers,
  type EdlsSheet, 
  type InsertEdlsSheet
} from "@shared/schema";
import { eq, desc, sql } from "drizzle-orm";

export interface EdlsSheetWithRelations extends EdlsSheet {
  employer?: { id: string; name: string };
}

export interface PaginatedEdlsSheets {
  data: EdlsSheetWithRelations[];
  total: number;
  page: number;
  limit: number;
}

export interface EdlsSheetsStorage {
  getAll(): Promise<EdlsSheet[]>;
  getPaginated(page: number, limit: number, employerId?: string): Promise<PaginatedEdlsSheets>;
  get(id: string): Promise<EdlsSheet | undefined>;
  getWithRelations(id: string): Promise<EdlsSheetWithRelations | undefined>;
  getByEmployer(employerId: string): Promise<EdlsSheet[]>;
  create(sheet: InsertEdlsSheet): Promise<EdlsSheet>;
  update(id: string, sheet: Partial<InsertEdlsSheet>): Promise<EdlsSheet | undefined>;
  delete(id: string): Promise<boolean>;
}

export function createEdlsSheetsStorage(): EdlsSheetsStorage {
  return {
    async getAll(): Promise<EdlsSheet[]> {
      return db.select().from(edlsSheets).orderBy(desc(edlsSheets.date));
    },

    async getPaginated(page: number, limit: number, employerId?: string): Promise<PaginatedEdlsSheets> {
      const baseCondition = employerId ? eq(edlsSheets.employerId, employerId) : undefined;
      
      const countQuery = db
        .select({ count: sql<number>`count(*)::int` })
        .from(edlsSheets);
      
      const [countResult] = baseCondition 
        ? await countQuery.where(baseCondition)
        : await countQuery;
      
      const total = countResult?.count || 0;
      
      const baseQuery = db
        .select({
          sheet: edlsSheets,
          employer: {
            id: employers.id,
            name: employers.name,
          },
        })
        .from(edlsSheets)
        .leftJoin(employers, eq(edlsSheets.employerId, employers.id));
      
      const rows = baseCondition
        ? await baseQuery.where(baseCondition).orderBy(desc(edlsSheets.date)).limit(limit).offset(page * limit)
        : await baseQuery.orderBy(desc(edlsSheets.date)).limit(limit).offset(page * limit);
      
      const data: EdlsSheetWithRelations[] = rows.map(row => ({
        ...row.sheet,
        employer: row.employer || undefined,
      }));
      
      return { data, total, page, limit };
    },

    async get(id: string): Promise<EdlsSheet | undefined> {
      const [sheet] = await db.select().from(edlsSheets).where(eq(edlsSheets.id, id));
      return sheet || undefined;
    },

    async getWithRelations(id: string): Promise<EdlsSheetWithRelations | undefined> {
      const [row] = await db
        .select({
          sheet: edlsSheets,
          employer: {
            id: employers.id,
            name: employers.name,
          },
        })
        .from(edlsSheets)
        .leftJoin(employers, eq(edlsSheets.employerId, employers.id))
        .where(eq(edlsSheets.id, id));
      
      if (!row) return undefined;
      
      return {
        ...row.sheet,
        employer: row.employer || undefined,
      };
    },

    async getByEmployer(employerId: string): Promise<EdlsSheet[]> {
      return db.select().from(edlsSheets)
        .where(eq(edlsSheets.employerId, employerId))
        .orderBy(desc(edlsSheets.date));
    },

    async create(insertSheet: InsertEdlsSheet): Promise<EdlsSheet> {
      const [sheet] = await db.insert(edlsSheets).values(insertSheet).returning();
      return sheet;
    },

    async update(id: string, sheetUpdate: Partial<InsertEdlsSheet>): Promise<EdlsSheet | undefined> {
      const [sheet] = await db
        .update(edlsSheets)
        .set(sheetUpdate)
        .where(eq(edlsSheets.id, id))
        .returning();
      return sheet || undefined;
    },

    async delete(id: string): Promise<boolean> {
      const result = await db.delete(edlsSheets).where(eq(edlsSheets.id, id)).returning();
      return result.length > 0;
    }
  };
}
