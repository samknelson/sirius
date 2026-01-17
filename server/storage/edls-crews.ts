import { createNoopValidator } from './utils/validation';
import { 
  edlsCrews,
  users,
  optionsEdlsTasks,
  type EdlsCrew, 
  type InsertEdlsCrew
} from "@shared/schema";
import { eq, sql, asc } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { StorageLoggingConfig } from "./middleware/logging";
import { getClient } from "./transaction-context";

/**
 * Stub validator - add validation logic here when needed
 */
export const validate = createNoopValidator();

export interface EdlsCrewWithRelations extends EdlsCrew {
  supervisorUser?: { id: string; firstName: string | null; lastName: string | null; email: string };
  task?: { id: string; name: string };
}

export interface EdlsCrewsStorage {
  getBySheetId(sheetId: string): Promise<EdlsCrew[]>;
  getBySheetIdWithRelations(sheetId: string): Promise<EdlsCrewWithRelations[]>;
  get(id: string): Promise<EdlsCrew | undefined>;
  create(crew: InsertEdlsCrew): Promise<EdlsCrew>;
  createMany(crews: InsertEdlsCrew[]): Promise<EdlsCrew[]>;
  update(id: string, crew: Partial<InsertEdlsCrew>): Promise<EdlsCrew | undefined>;
  delete(id: string): Promise<boolean>;
  deleteBySheetId(sheetId: string): Promise<number>;
  getCrewsTotalWorkerCount(sheetId: string): Promise<number>;
  validateCrewsWorkerCount(sheetId: string, expectedTotal: number): Promise<boolean>;
}

export function createEdlsCrewsStorage(): EdlsCrewsStorage {
  return {
    async getBySheetId(sheetId: string): Promise<EdlsCrew[]> {
      const client = getClient();
      return client.select().from(edlsCrews).where(eq(edlsCrews.sheetId, sheetId)).orderBy(asc(edlsCrews.sequence));
    },

    async getBySheetIdWithRelations(sheetId: string): Promise<EdlsCrewWithRelations[]> {
      const client = getClient();
      const supervisorUsers = alias(users, 'supervisor_user');
      
      const rows = await client
        .select({
          crew: edlsCrews,
          supervisorUser: {
            id: supervisorUsers.id,
            firstName: supervisorUsers.firstName,
            lastName: supervisorUsers.lastName,
            email: supervisorUsers.email,
          },
          task: {
            id: optionsEdlsTasks.id,
            name: optionsEdlsTasks.name,
          },
        })
        .from(edlsCrews)
        .leftJoin(supervisorUsers, eq(edlsCrews.supervisor, supervisorUsers.id))
        .leftJoin(optionsEdlsTasks, eq(edlsCrews.taskId, optionsEdlsTasks.id))
        .where(eq(edlsCrews.sheetId, sheetId))
        .orderBy(asc(edlsCrews.sequence));
      
      return rows.map(row => ({
        ...row.crew,
        supervisorUser: row.supervisorUser?.id ? row.supervisorUser : undefined,
        task: row.task?.id ? row.task : undefined,
      }));
    },

    async get(id: string): Promise<EdlsCrew | undefined> {
      const client = getClient();
      const [crew] = await client.select().from(edlsCrews).where(eq(edlsCrews.id, id));
      return crew || undefined;
    },

    async create(insertCrew: InsertEdlsCrew): Promise<EdlsCrew> {
      validate.validateOrThrow(insertCrew);
      const client = getClient();
      const [crew] = await client.insert(edlsCrews).values(insertCrew).returning();
      return crew;
    },

    async createMany(crews: InsertEdlsCrew[]): Promise<EdlsCrew[]> {
      if (crews.length === 0) return [];
      const client = getClient();
      return client.insert(edlsCrews).values(crews).returning();
    },

    async update(id: string, crewUpdate: Partial<InsertEdlsCrew>): Promise<EdlsCrew | undefined> {
      validate.validateOrThrow(id);
      const client = getClient();
      const [crew] = await client
        .update(edlsCrews)
        .set(crewUpdate)
        .where(eq(edlsCrews.id, id))
        .returning();
      return crew || undefined;
    },

    async delete(id: string): Promise<boolean> {
      const client = getClient();
      const result = await client.delete(edlsCrews).where(eq(edlsCrews.id, id)).returning();
      return result.length > 0;
    },

    async deleteBySheetId(sheetId: string): Promise<number> {
      const client = getClient();
      const result = await client.delete(edlsCrews).where(eq(edlsCrews.sheetId, sheetId)).returning();
      return result.length;
    },

    async getCrewsTotalWorkerCount(sheetId: string): Promise<number> {
      const client = getClient();
      const [result] = await client
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

export const edlsCrewsLoggingConfig: StorageLoggingConfig<EdlsCrewsStorage> = {
  module: 'edls-crews',
  methods: {
    create: {
      enabled: true,
      getEntityId: (args, result) => result?.id || 'new crew',
      getHostEntityId: (args, result) => result?.sheetId || args[0]?.sheetId,
      getDescription: async (args, result) => {
        const title = result?.title || args[0]?.title || 'Untitled';
        return `Created crew [${title}]`;
      },
      after: async (args, result) => {
        return {
          crew: result,
          metadata: {
            crewId: result?.id,
            sheetId: result?.sheetId,
            title: result?.title,
            workerCount: result?.workerCount,
          }
        };
      }
    },
    createMany: {
      enabled: true,
      getEntityId: (args, result) => 'bulk create',
      getHostEntityId: (args, result) => result?.[0]?.sheetId || args[0]?.[0]?.sheetId,
      getDescription: async (args, result) => {
        const count = result?.length || args[0]?.length || 0;
        const titles = (result || args[0] || []).map((c: any) => c.title || 'Untitled').join(', ');
        return `Created ${count} crew(s) [${titles}]`;
      },
      after: async (args, result) => {
        return {
          crews: result,
          metadata: {
            count: result?.length,
            sheetId: result?.[0]?.sheetId,
          }
        };
      }
    },
    update: {
      enabled: true,
      getEntityId: (args) => args[0],
      getHostEntityId: async (args, result, beforeState) => {
        return result?.sheetId || beforeState?.sheetId;
      },
      before: async (args, storage) => {
        return await storage.get(args[0]);
      },
      getDescription: async (args, result, beforeState) => {
        const title = result?.title || beforeState?.title || 'Untitled';
        return `Updated crew [${title}]`;
      },
      after: async (args, result) => {
        return result;
      }
    },
    delete: {
      enabled: true,
      getEntityId: (args) => args[0],
      getHostEntityId: async (args, result, beforeState) => {
        return beforeState?.sheetId;
      },
      before: async (args, storage) => {
        return await storage.get(args[0]);
      },
      getDescription: async (args, result, beforeState) => {
        const title = beforeState?.title || 'Untitled';
        return `Deleted crew [${title}]`;
      }
    },
    deleteBySheetId: {
      enabled: true,
      getEntityId: (args) => 'bulk delete',
      getHostEntityId: (args) => args[0],
      getDescription: async (args, result) => {
        return `Deleted all crews for sheet (${result} crews removed)`;
      },
      after: async (args, result) => {
        return { deletedCount: result };
      }
    }
  }
};
