import { db } from './db';
import { 
  edlsCrews,
  users,
  optionsEdlsTasks,
  type EdlsCrew, 
  type InsertEdlsCrew
} from "@shared/schema";
import { eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { StorageLoggingConfig } from "./middleware/logging";

export interface EdlsCrewWithRelations extends EdlsCrew {
  supervisorUser?: { id: string; firstName: string | null; lastName: string | null; email: string };
  task?: { id: string; name: string };
}

export interface EdlsCrewsStorage {
  getBySheetId(sheetId: string): Promise<EdlsCrew[]>;
  getBySheetIdWithRelations(sheetId: string): Promise<EdlsCrewWithRelations[]>;
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

    async getBySheetIdWithRelations(sheetId: string): Promise<EdlsCrewWithRelations[]> {
      const supervisorUsers = alias(users, 'supervisor_user');
      
      const rows = await db
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
        .where(eq(edlsCrews.sheetId, sheetId));
      
      return rows.map(row => ({
        ...row.crew,
        supervisorUser: row.supervisorUser?.id ? row.supervisorUser : undefined,
        task: row.task?.id ? row.task : undefined,
      }));
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

export const edlsCrewsLoggingConfig: StorageLoggingConfig<EdlsCrewsStorage> = {
  module: 'edls-crews',
  methods: {
    create: {
      enabled: true,
      getEntityId: (args, result) => result?.id || 'new crew',
      getHostEntityId: (args, result) => result?.sheetId || args[0]?.sheetId,
      getDescription: async (args, result) => {
        const crewNumber = result?.crewNumber || args[0]?.crewNumber || 'Unknown';
        const workerCount = result?.workerCount || args[0]?.workerCount || 0;
        return `Created EDLS Crew #${crewNumber} with ${workerCount} workers`;
      },
      after: async (args, result) => {
        return {
          crew: result,
          metadata: {
            crewId: result?.id,
            sheetId: result?.sheetId,
            crewNumber: result?.crewNumber,
            workerCount: result?.workerCount,
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
        const crewNumber = result?.crewNumber || beforeState?.crewNumber || 'Unknown';
        return `Updated EDLS Crew #${crewNumber}`;
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
        const crewNumber = beforeState?.crewNumber || 'Unknown';
        return `Deleted EDLS Crew #${crewNumber}`;
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
