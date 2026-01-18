import { 
  createAsyncStorageValidator, 
  type ValidationError,
  type AsyncStorageValidator 
} from './utils/validation';
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
import { eq, ne, desc, sql, and, gte, lte, type SQL } from "drizzle-orm";
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

/**
 * Input type for sheet validation that includes optional crews context.
 * - _crews: Pass crews directly (on create, or when updating crews)
 * - If _crews is not provided on update, validator loads existing crews from DB
 */
export interface EdlsSheetValidationInput extends Partial<InsertEdlsSheet> {
  _crews?: Array<{ workerCount: number }>;
}

/**
 * Validates EDLS sheets:
 * - Ensures workerCount equals the sum of crew workerCounts
 * - Smart loading: if _crews not provided but validation is needed, loads from DB
 * - Skips crew validation only when neither workerCount nor crews are changing
 */
export const validate: AsyncStorageValidator<EdlsSheetValidationInput, EdlsSheet, {}> = createAsyncStorageValidator<EdlsSheetValidationInput, EdlsSheet, {}>(
  async (data, existing) => {
    const errors: ValidationError[] = [];
    
    const isChangingWorkerCount = 'workerCount' in data;
    const isProvidingCrews = '_crews' in data;
    
    // Only validate crew counts if crews are provided OR workerCount is changing
    if (isProvidingCrews || isChangingWorkerCount) {
      // Determine crews to validate against
      let crews: Array<{ workerCount: number }>;
      if (isProvidingCrews) {
        crews = data._crews ?? [];
      } else if (existing?.id) {
        // Load existing crews from database
        crews = await storage.edlsCrews.getBySheetId(existing.id);
      } else {
        // No existing record and no crews provided - can't validate
        crews = [];
      }
      
      const workerCount = data.workerCount ?? existing?.workerCount ?? 0;
      const crewsTotal = crews.reduce((sum, crew) => sum + (crew.workerCount || 0), 0);
      
      if (workerCount !== crewsTotal) {
        errors.push({
          field: 'workerCount',
          code: 'WORKER_COUNT_MISMATCH',
          message: `Sheet worker count (${workerCount}) must equal sum of crew worker counts (${crewsTotal})`
        });
      }
    }
    
    if (errors.length > 0) {
      return { ok: false, errors };
    }
    
    return { ok: true, value: {} };
  }
);

export interface EdlsSheetsFilterOptions {
  employerId?: string;
  dateFrom?: string;
  dateTo?: string;
  status?: string;
}

export interface EdlsSheetsStorage {
  getAll(): Promise<EdlsSheet[]>;
  getPaginated(page: number, limit: number, filters?: EdlsSheetsFilterOptions): Promise<PaginatedEdlsSheets>;
  get(id: string): Promise<EdlsSheet | undefined>;
  getWithRelations(id: string): Promise<EdlsSheetWithRelations | undefined>;
  getByEmployer(employerId: string): Promise<EdlsSheet[]>;
  /**
   * Creates a sheet with its crews. Crews are required on create.
   * Validates that sheet.workerCount === sum of crew.workerCount.
   */
  create(sheet: InsertEdlsSheet, crews: CrewInput[]): Promise<EdlsSheetWithCrews>;
  /**
   * Updates a sheet and optionally its crews.
   * If crews are provided, replaces all crews and validates counts.
   * If crews are omitted, loads existing crews to validate counts.
   */
  update(id: string, sheet: Partial<InsertEdlsSheet>, crews?: CrewInput[]): Promise<EdlsSheetWithCrews | undefined>;
  delete(id: string): Promise<boolean>;
}

export function createEdlsSheetsStorage(): EdlsSheetsStorage {
  return {
    async getAll(): Promise<EdlsSheet[]> {
      const client = getClient();
      return client.select().from(edlsSheets).orderBy(desc(edlsSheets.ymd));
    },

    async getPaginated(page: number, limit: number, filters?: EdlsSheetsFilterOptions): Promise<PaginatedEdlsSheets> {
      const client = getClient();
      const supervisorUsers = alias(users, 'supervisor_user');
      const assigneeUsers = alias(users, 'assignee_user');
      
      const conditions: SQL[] = [];
      if (filters?.employerId) {
        conditions.push(eq(edlsSheets.employerId, filters.employerId));
      }
      if (filters?.dateFrom) {
        conditions.push(gte(edlsSheets.ymd, filters.dateFrom));
      }
      if (filters?.dateTo) {
        conditions.push(lte(edlsSheets.ymd, filters.dateTo));
      }
      if (filters?.status) {
        conditions.push(eq(edlsSheets.status, filters.status));
      } else {
        conditions.push(ne(edlsSheets.status, 'trash'));
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
        .leftJoin(assigneeUsers, eq(edlsSheets.assignee, assigneeUsers.id));
      
      const rows = whereCondition
        ? await baseQuery.where(whereCondition).orderBy(desc(edlsSheets.ymd)).limit(limit).offset(page * limit)
        : await baseQuery.orderBy(desc(edlsSheets.ymd)).limit(limit).offset(page * limit);
      
      const data: EdlsSheetWithRelations[] = rows.map(row => ({
        ...row.sheet,
        employer: row.employer?.id ? row.employer : undefined,
        department: row.department?.id ? row.department : undefined,
        supervisorUser: row.supervisorUser?.id ? row.supervisorUser : undefined,
        assigneeUser: row.assigneeUser?.id ? row.assigneeUser : undefined,
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
        .orderBy(desc(edlsSheets.ymd));
    },

    async create(insertSheet: InsertEdlsSheet, crews: CrewInput[]): Promise<EdlsSheetWithCrews> {
      await validate.validateOrThrow({ ...insertSheet, _crews: crews });
      
      return runInTransaction(async () => {
        const client = getClient();
        const [sheet] = await client.insert(edlsSheets).values(insertSheet).returning();
        
        const crewsWithSheetId = crews.map((c, index) => {
          const { id: _, ...crewData } = c;
          return { ...crewData, sheetId: sheet.id, sequence: index };
        });
        const createdCrews = await storage.edlsCrews.createMany(crewsWithSheetId);
        
        return { ...sheet, crews: createdCrews };
      });
    },

    async update(id: string, sheetUpdate: Partial<InsertEdlsSheet>, crews?: CrewInput[]): Promise<EdlsSheetWithCrews | undefined> {
      return runInTransaction(async () => {
        const client = getClient();
        
        const [existingSheet] = await client.select().from(edlsSheets).where(eq(edlsSheets.id, id));
        if (!existingSheet) return undefined;
        
        // Strip ymd from update - date cannot be changed after sheet creation
        const { ymd: _ymd, ...safeSheetUpdate } = sheetUpdate;
        
        // Always validate - validator is smart enough to:
        // - Use provided crews if available
        // - Load existing crews from DB if workerCount is changing
        // - Skip crew validation if neither crews nor workerCount are changing
        const validationInput = crews !== undefined 
          ? { ...safeSheetUpdate, _crews: crews }
          : safeSheetUpdate;
        await validate.validateOrThrow(validationInput, existingSheet);
        
        // Update the sheet
        const [updatedSheet] = Object.keys(safeSheetUpdate).length > 0
          ? await client.update(edlsSheets).set(safeSheetUpdate).where(eq(edlsSheets.id, id)).returning()
          : [existingSheet];
        
        // If crews were provided, sync them
        if (crews !== undefined) {
          const existingCrews = await storage.edlsCrews.getBySheetId(id);
          const existingCrewMap = new Map(existingCrews.map(c => [c.id, c]));
          
          const incomingCrewIds = new Set(crews.filter(c => c.id).map(c => c.id!));
          
          // Delete crews that are no longer in the list
          const crewIdsToDelete = existingCrews.filter(c => !incomingCrewIds.has(c.id)).map(c => c.id);
          for (const crewId of crewIdsToDelete) {
            await storage.edlsCrews.delete(crewId);
          }
          
          // Update existing crews
          for (let i = 0; i < crews.length; i++) {
            const crew = crews[i];
            if (crew.id && existingCrewMap.has(crew.id)) {
              const { id: crewId, ...crewData } = crew;
              await storage.edlsCrews.update(crewId!, { ...crewData, sheetId: id, sequence: i });
            }
          }
          
          // Create new crews
          const crewsToCreate = crews
            .map((c, index) => ({ crew: c, sequence: index }))
            .filter(({ crew }) => !crew.id);
          
          const newCrewsWithSheetId = crewsToCreate.map(({ crew, sequence }) => {
            const { id: _, ...crewData } = crew;
            return { ...crewData, sheetId: id, sequence };
          });
          await storage.edlsCrews.createMany(newCrewsWithSheetId);
        }
        
        // Load final crews state
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
        const ymd = result?.ymd || args[0]?.ymd || 'Unknown';
        return `Created sheet [${title}] [${ymd}]`;
      },
      after: async (args, result) => {
        return {
          sheet: result,
          crews: result?.crews,
          metadata: {
            sheetId: result?.id,
            title: result?.title,
            ymd: result?.ymd,
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
        const ymd = result?.ymd || beforeState?.ymd || 'Unknown';
        return `Updated sheet [${title}] [${ymd}]`;
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
        const ymd = beforeState?.ymd || 'Unknown';
        return `Deleted sheet [${title}] [${ymd}]`;
      }
    }
  }
};
