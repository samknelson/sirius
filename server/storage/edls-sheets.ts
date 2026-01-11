import { db } from './db';
import { 
  edlsSheets,
  edlsCrews,
  employers,
  users,
  optionsDepartment,
  type EdlsSheet, 
  type InsertEdlsSheet,
  type EdlsCrew,
  type InsertEdlsCrew
} from "@shared/schema";
import { eq, desc, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { StorageLoggingConfig } from "./middleware/logging";
import { storageLogger } from "../logger";
import { getRequestContext } from "../middleware/request-context";

export interface EdlsSheetWithCrews extends EdlsSheet {
  crews: EdlsCrew[];
}

async function getEmployerName(employerId: string | null | undefined): Promise<string> {
  if (!employerId) return 'Unknown';
  const [employer] = await db.select({ name: employers.name }).from(employers).where(eq(employers.id, employerId));
  return employer?.name || 'Unknown';
}

function emitCrewLogEntry(
  operation: 'create' | 'delete',
  crew: EdlsCrew,
  sheetId: string
): void {
  setImmediate(() => {
    const context = getRequestContext();
    const description = operation === 'create'
      ? `Created EDLS Crew #${crew.crewNumber} with ${crew.workerCount} workers`
      : `Deleted EDLS Crew #${crew.crewNumber}`;
    
    storageLogger.info(`Storage operation: edls-crews.${operation}`, {
      module: 'edls-crews',
      operation,
      entity_id: crew.id,
      host_entity_id: sheetId,
      description,
      user_id: context?.userId,
      user_email: context?.userEmail,
      ip_address: context?.ipAddress,
      meta: { 
        crew,
        metadata: {
          crewId: crew.id,
          sheetId,
          crewNumber: crew.crewNumber,
          workerCount: crew.workerCount,
        }
      },
    });
  });
}

function emitBulkCrewDeleteLogEntry(sheetId: string, deletedCount: number): void {
  setImmediate(() => {
    const context = getRequestContext();
    storageLogger.info(`Storage operation: edls-crews.deleteBySheetId`, {
      module: 'edls-crews',
      operation: 'deleteBySheetId',
      entity_id: 'bulk delete',
      host_entity_id: sheetId,
      description: `Deleted all crews for sheet (${deletedCount} crews removed)`,
      user_id: context?.userId,
      user_email: context?.userEmail,
      ip_address: context?.ipAddress,
      meta: { deletedCount },
    });
  });
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

export interface EdlsSheetsStorage {
  getAll(): Promise<EdlsSheet[]>;
  getPaginated(page: number, limit: number, employerId?: string): Promise<PaginatedEdlsSheets>;
  get(id: string): Promise<EdlsSheet | undefined>;
  getWithRelations(id: string): Promise<EdlsSheetWithRelations | undefined>;
  getByEmployer(employerId: string): Promise<EdlsSheet[]>;
  create(sheet: InsertEdlsSheet): Promise<EdlsSheet>;
  createWithCrews(sheet: InsertEdlsSheet, crews: Omit<InsertEdlsCrew, 'sheetId'>[]): Promise<EdlsSheetWithCrews>;
  update(id: string, sheet: Partial<InsertEdlsSheet>): Promise<EdlsSheet | undefined>;
  updateWithCrews(id: string, sheet: Partial<InsertEdlsSheet>, crews: Omit<InsertEdlsCrew, 'sheetId'>[]): Promise<EdlsSheetWithCrews | undefined>;
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
      const supervisorUsers = alias(users, 'supervisor_user');
      const assigneeUsers = alias(users, 'assignee_user');
      
      const [row] = await db
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
      return db.select().from(edlsSheets)
        .where(eq(edlsSheets.employerId, employerId))
        .orderBy(desc(edlsSheets.date));
    },

    async create(insertSheet: InsertEdlsSheet): Promise<EdlsSheet> {
      const [sheet] = await db.insert(edlsSheets).values(insertSheet).returning();
      return sheet;
    },

    async createWithCrews(insertSheet: InsertEdlsSheet, crews: Omit<InsertEdlsCrew, 'sheetId'>[]): Promise<EdlsSheetWithCrews> {
      const result = await db.transaction(async (tx) => {
        const [sheet] = await tx.insert(edlsSheets).values(insertSheet).returning();
        
        const createdCrews = await Promise.all(
          crews.map(crewData => 
            tx.insert(edlsCrews).values({ ...crewData, sheetId: sheet.id }).returning()
          )
        );
        
        return { ...sheet, crews: createdCrews.map(c => c[0]) };
      });
      
      for (const crew of result.crews) {
        emitCrewLogEntry('create', crew, result.id);
      }
      
      return result;
    },

    async update(id: string, sheetUpdate: Partial<InsertEdlsSheet>): Promise<EdlsSheet | undefined> {
      const [sheet] = await db
        .update(edlsSheets)
        .set(sheetUpdate)
        .where(eq(edlsSheets.id, id))
        .returning();
      return sheet || undefined;
    },

    async updateWithCrews(id: string, sheetUpdate: Partial<InsertEdlsSheet>, crews: Omit<InsertEdlsCrew, 'sheetId'>[]): Promise<EdlsSheetWithCrews | undefined> {
      const result = await db.transaction(async (tx) => {
        const deletedCrews = await tx.delete(edlsCrews).where(eq(edlsCrews.sheetId, id)).returning();
        
        const [existingSheet] = await tx.select().from(edlsSheets).where(eq(edlsSheets.id, id));
        if (!existingSheet) return undefined;
        
        const [updatedSheet] = Object.keys(sheetUpdate).length > 0
          ? await tx.update(edlsSheets).set(sheetUpdate).where(eq(edlsSheets.id, id)).returning()
          : [existingSheet];
        
        const createdCrews = await Promise.all(
          crews.map(crewData => 
            tx.insert(edlsCrews).values({ ...crewData, sheetId: id }).returning()
          )
        );
        
        return { 
          sheet: updatedSheet, 
          crews: createdCrews.map(c => c[0]),
          deletedCount: deletedCrews.length
        };
      });
      
      if (!result) return undefined;
      
      emitBulkCrewDeleteLogEntry(id, result.deletedCount);
      
      for (const crew of result.crews) {
        emitCrewLogEntry('create', crew, id);
      }
      
      return { ...result.sheet, crews: result.crews };
    },

    async delete(id: string): Promise<boolean> {
      const result = await db.delete(edlsSheets).where(eq(edlsSheets.id, id)).returning();
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
        const date = result?.date || args[0]?.date || 'Unknown';
        const employerName = await getEmployerName(result?.employerId || args[0]?.employerId);
        return `Created EDLS Sheet [${date}] for ${employerName}`;
      },
      after: async (args, result) => {
        return {
          sheet: result,
          metadata: {
            sheetId: result?.id,
            date: result?.date,
            employerId: result?.employerId,
          }
        };
      }
    },
    createWithCrews: {
      enabled: true,
      getEntityId: (args, result) => result?.id || 'new sheet',
      getHostEntityId: (args, result) => result?.id,
      getDescription: async (args, result) => {
        const date = result?.date || args[0]?.date || 'Unknown';
        const employerName = await getEmployerName(result?.employerId || args[0]?.employerId);
        const crewCount = result?.crews?.length || args[1]?.length || 0;
        return `Created EDLS Sheet [${date}] for ${employerName} with ${crewCount} crew(s)`;
      },
      after: async (args, result) => {
        return {
          sheet: result,
          crews: result?.crews,
          metadata: {
            sheetId: result?.id,
            date: result?.date,
            employerId: result?.employerId,
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
        const date = result?.date || beforeState?.date || 'Unknown';
        const employerName = await getEmployerName(result?.employerId || beforeState?.employerId);
        return `Updated EDLS Sheet [${date}] for ${employerName}`;
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
        const date = result?.date || beforeState?.date || 'Unknown';
        const employerName = await getEmployerName(result?.employerId || beforeState?.employerId);
        const crewCount = result?.crews?.length || args[2]?.length || 0;
        return `Updated EDLS Sheet [${date}] for ${employerName} with ${crewCount} crew(s)`;
      },
      after: async (args, result) => {
        return {
          sheet: result,
          crews: result?.crews,
          metadata: {
            sheetId: result?.id,
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
        const date = beforeState?.date || 'Unknown';
        const employerName = await getEmployerName(beforeState?.employerId);
        return `Deleted EDLS Sheet [${date}] for ${employerName}`;
      }
    }
  }
};
