import { 
  edlsSheets,
  employers,
  users,
  optionsDepartment,
  type EdlsSheet, 
  type InsertEdlsSheet,
  type EdlsCrew,
  type InsertEdlsCrew
} from "@shared/schema";
import { eq, desc, sql, and, gte, lte, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { StorageLoggingConfig } from "./middleware/logging";
import { getClient, runInTransaction } from "./transaction-context";
import { storage } from "./index";

export interface EdlsSheetWithCrews extends EdlsSheet {
  crews: EdlsCrew[];
}

export interface EdlsSheetWithRelations extends EdlsSheet {
  employer?: { id: string; name: string };
  department?: { id: string; name: string };
  supervisorUser?: { id: string; firstName: string | null; lastName: string | null; email: string };
  assigneeUser?: { id: string; firstName: string | null; lastName: string | null; email: string };
}

export interface PaginatedEdlsSheets {
  data: EdlsSheetWithRelations[];
  total: number;
  page: number;
  limit: number;
}

export type CrewInput = Omit<InsertEdlsCrew, 'sheetId'> & { id?: string };

export interface EdlsSheetsFilterOptions {
  employerId?: string;
  dateFrom?: string;
  dateTo?: string;
}

export interface EdlsSheetsStorage {
  getAll(): Promise<EdlsSheet[]>;
  getPaginated(page: number, limit: number, filters?: EdlsSheetsFilterOptions): Promise<PaginatedEdlsSheets>;
  get(id: string): Promise<EdlsSheet | undefined>;
  getWithRelations(id: string): Promise<EdlsSheetWithRelations | undefined>;
  getByEmployer(employerId: string): Promise<EdlsSheet[]>;
  create(sheet: InsertEdlsSheet): Promise<EdlsSheet>;
  createWithCrews(sheet: InsertEdlsSheet, crews: Omit<InsertEdlsCrew, 'sheetId'>[]): Promise<EdlsSheetWithCrews>;
  update(id: string, sheet: Partial<InsertEdlsSheet>): Promise<EdlsSheet | undefined>;
  updateWithCrews(id: string, sheet: Partial<InsertEdlsSheet>, crews: CrewInput[]): Promise<EdlsSheetWithCrews | undefined>;
  delete(id: string): Promise<boolean>;
}

export function createEdlsSheetsStorage(): EdlsSheetsStorage {
  return {
    async getAll(): Promise<EdlsSheet[]> {
      const client = getClient();
      return client.select().from(edlsSheets).orderBy(desc(edlsSheets.date));
    },

    async getPaginated(page: number, limit: number, filters?: EdlsSheetsFilterOptions): Promise<PaginatedEdlsSheets> {
      const client = getClient();
      
      const conditions: SQL[] = [];
      if (filters?.employerId) {
        conditions.push(eq(edlsSheets.employerId, filters.employerId));
      }
      if (filters?.dateFrom) {
        conditions.push(gte(edlsSheets.date, filters.dateFrom));
      }
      if (filters?.dateTo) {
        conditions.push(lte(edlsSheets.date, filters.dateTo));
      }
      
      const whereCondition = conditions.length > 0 ? and(...conditions) : undefined;
      
      const countQuery = client
        .select({ count: sql<number>`count(*)::int` })
        .from(edlsSheets);
      
      const [countResult] = whereCondition 
        ? await countQuery.where(whereCondition)
        : await countQuery;
      
      const total = countResult?.count || 0;
      
      const baseQuery = client
        .select({
          sheet: edlsSheets,
          employer: {
            id: employers.id,
            name: employers.name,
          },
        })
        .from(edlsSheets)
        .leftJoin(employers, eq(edlsSheets.employerId, employers.id));
      
      const rows = whereCondition
        ? await baseQuery.where(whereCondition).orderBy(desc(edlsSheets.date)).limit(limit).offset(page * limit)
        : await baseQuery.orderBy(desc(edlsSheets.date)).limit(limit).offset(page * limit);
      
      const data: EdlsSheetWithRelations[] = rows.map(row => ({
        ...row.sheet,
        employer: row.employer || undefined,
      }));
      
      return { data, total, page, limit };
    },

    async get(id: string): Promise<EdlsSheet | undefined> {
      const client = getClient();
      const [sheet] = await client.select().from(edlsSheets).where(eq(edlsSheets.id, id));
      return sheet || undefined;
    },

    async getWithRelations(id: string): Promise<EdlsSheetWithRelations | undefined> {
      const client = getClient();
      const supervisorUsers = alias(users, 'supervisor_user');
      const assigneeUsers = alias(users, 'assignee_user');
      
      const [row] = await client
        .select({
          sheet: edlsSheets,
          employer: {
            id: employers.id,
            name: employers.name,
          },
          department: {
            id: optionsDepartment.id,
            name: optionsDepartment.name,
          },
          supervisorUser: {
            id: supervisorUsers.id,
            firstName: supervisorUsers.firstName,
            lastName: supervisorUsers.lastName,
            email: supervisorUsers.email,
          },
          assigneeUser: {
            id: assigneeUsers.id,
            firstName: assigneeUsers.firstName,
            lastName: assigneeUsers.lastName,
            email: assigneeUsers.email,
          },
        })
        .from(edlsSheets)
        .leftJoin(employers, eq(edlsSheets.employerId, employers.id))
        .leftJoin(optionsDepartment, eq(edlsSheets.departmentId, optionsDepartment.id))
        .leftJoin(supervisorUsers, eq(edlsSheets.supervisor, supervisorUsers.id))
        .leftJoin(assigneeUsers, eq(edlsSheets.assignee, assigneeUsers.id))
        .where(eq(edlsSheets.id, id));
      
      if (!row) return undefined;
      
      return {
        ...row.sheet,
        employer: row.employer || undefined,
        department: row.department || undefined,
        supervisorUser: row.supervisorUser?.id ? row.supervisorUser : undefined,
        assigneeUser: row.assigneeUser?.id ? row.assigneeUser : undefined,
      };
    },

    async getByEmployer(employerId: string): Promise<EdlsSheet[]> {
      const client = getClient();
      return client.select().from(edlsSheets)
        .where(eq(edlsSheets.employerId, employerId))
        .orderBy(desc(edlsSheets.date));
    },

    async create(insertSheet: InsertEdlsSheet): Promise<EdlsSheet> {
      const client = getClient();
      const [sheet] = await client.insert(edlsSheets).values(insertSheet).returning();
      return sheet;
    },

    async createWithCrews(insertSheet: InsertEdlsSheet, crews: Omit<InsertEdlsCrew, 'sheetId'>[]): Promise<EdlsSheetWithCrews> {
      return runInTransaction(async () => {
        const client = getClient();
        const [sheet] = await client.insert(edlsSheets).values(insertSheet).returning();
        
        const crewsWithSheetId = crews.map((c, index) => ({ ...c, sheetId: sheet.id, sequence: index }));
        const createdCrews = await storage.edlsCrews.createMany(crewsWithSheetId);
        
        return { ...sheet, crews: createdCrews };
      });
    },

    async update(id: string, sheetUpdate: Partial<InsertEdlsSheet>): Promise<EdlsSheet | undefined> {
      const client = getClient();
      const [sheet] = await client
        .update(edlsSheets)
        .set(sheetUpdate)
        .where(eq(edlsSheets.id, id))
        .returning();
      return sheet || undefined;
    },

    async updateWithCrews(id: string, sheetUpdate: Partial<InsertEdlsSheet>, crews: CrewInput[]): Promise<EdlsSheetWithCrews | undefined> {
      return runInTransaction(async () => {
        const client = getClient();
        
        const [existingSheet] = await client.select().from(edlsSheets).where(eq(edlsSheets.id, id));
        if (!existingSheet) return undefined;
        
        const [updatedSheet] = Object.keys(sheetUpdate).length > 0
          ? await client.update(edlsSheets).set(sheetUpdate).where(eq(edlsSheets.id, id)).returning()
          : [existingSheet];
        
        const existingCrews = await storage.edlsCrews.getBySheetId(id);
        const existingCrewMap = new Map(existingCrews.map(c => [c.id, c]));
        
        const incomingCrewIds = new Set(crews.filter(c => c.id).map(c => c.id!));
        
        const crewIdsToDelete = existingCrews.filter(c => !incomingCrewIds.has(c.id)).map(c => c.id);
        
        for (const crewId of crewIdsToDelete) {
          await storage.edlsCrews.delete(crewId);
        }
        
        for (let i = 0; i < crews.length; i++) {
          const crew = crews[i];
          if (crew.id && existingCrewMap.has(crew.id)) {
            const { id: crewId, ...crewData } = crew;
            await storage.edlsCrews.update(crewId!, { ...crewData, sheetId: id, sequence: i });
          }
        }
        
        const crewsToCreate = crews
          .map((c, index) => ({ crew: c, sequence: index }))
          .filter(({ crew }) => !crew.id);
        
        const newCrewsWithSheetId = crewsToCreate.map(({ crew, sequence }) => {
          const { id: _, ...crewData } = crew;
          return { ...crewData, sheetId: id, sequence };
        });
        await storage.edlsCrews.createMany(newCrewsWithSheetId);
        
        const allCrews = await storage.edlsCrews.getBySheetId(id);
        
        return { ...updatedSheet, crews: allCrews };
      });
    },

    async delete(id: string): Promise<boolean> {
      const client = getClient();
      const result = await client.delete(edlsSheets).where(eq(edlsSheets.id, id)).returning();
      return result.length > 0;
    }
  };
}

export const edlsSheetsLoggingConfig: StorageLoggingConfig<EdlsSheetsStorage> = {
  module: 'edls-sheets',
  methods: {
    create: {
      enabled: true,
      getEntityId: (args, result) => result?.id || 'new sheet',
      getHostEntityId: (args, result) => result?.id,
      getDescription: async (args, result) => {
        const title = result?.title || args[0]?.title || 'Untitled';
        const date = result?.date || args[0]?.date || 'Unknown';
        return `Created sheet [${title}] [${date}]`;
      },
      after: async (args, result) => {
        return {
          sheet: result,
          metadata: {
            sheetId: result?.id,
            title: result?.title,
            date: result?.date,
          }
        };
      }
    },
    createWithCrews: {
      enabled: true,
      getEntityId: (args, result) => result?.id || 'new sheet',
      getHostEntityId: (args, result) => result?.id,
      getDescription: async (args, result) => {
        const title = result?.title || args[0]?.title || 'Untitled';
        const date = result?.date || args[0]?.date || 'Unknown';
        return `Created sheet [${title}] [${date}]`;
      },
      after: async (args, result) => {
        return {
          sheet: result,
          crews: result?.crews,
          metadata: {
            sheetId: result?.id,
            title: result?.title,
            date: result?.date,
            crewCount: result?.crews?.length,
          }
        };
      }
    },
    update: {
      enabled: true,
      getEntityId: (args) => args[0],
      getHostEntityId: (args) => args[0],
      before: async (args, storage) => {
        return await storage.get(args[0]);
      },
      getDescription: async (args, result, beforeState) => {
        const title = result?.title || beforeState?.title || 'Untitled';
        const date = result?.date || beforeState?.date || 'Unknown';
        return `Updated sheet [${title}] [${date}]`;
      },
      after: async (args, result) => {
        return result;
      }
    },
    updateWithCrews: {
      enabled: true,
      getEntityId: (args) => args[0],
      getHostEntityId: (args) => args[0],
      before: async (args, storage) => {
        return await storage.get(args[0]);
      },
      getDescription: async (args, result, beforeState) => {
        const title = result?.title || beforeState?.title || 'Untitled';
        const date = result?.date || beforeState?.date || 'Unknown';
        return `Updated sheet [${title}] [${date}]`;
      },
      after: async (args, result) => {
        return {
          sheet: result,
          crews: result?.crews,
          metadata: {
            sheetId: result?.id,
            title: result?.title,
            crewCount: result?.crews?.length,
          }
        };
      }
    },
    delete: {
      enabled: true,
      getEntityId: (args) => args[0],
      getHostEntityId: (args) => args[0],
      before: async (args, storage) => {
        return await storage.get(args[0]);
      },
      getDescription: async (args, result, beforeState) => {
        const title = beforeState?.title || 'Untitled';
        const date = beforeState?.date || 'Unknown';
        return `Deleted sheet [${title}] [${date}]`;
      }
    }
  }
};
