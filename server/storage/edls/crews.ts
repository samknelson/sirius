import { 
  createAsyncStorageValidator,
  type ValidationError
} from '../utils/validation';
import { 
  edlsCrews,
  edlsAssignments,
  users,
  optionsEdlsTasks,
  type EdlsCrew, 
  type InsertEdlsCrew
} from "@shared/schema";
import { eq, sql, asc } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { defineLoggingConfig } from "../middleware/logging";
import { getClient, runInTransaction } from "../transaction-context";

export const validate = createAsyncStorageValidator<InsertEdlsCrew, EdlsCrew, {}>(
  async (data, existing) => {
    const errors: ValidationError[] = [];
    const client = getClient();
    
    if (!existing) {
      return { ok: true, value: {} };
    }
    
    const crewId = existing.id;
    
    const lockedRows = await client.execute(
      sql`SELECT id FROM edls_assignments WHERE crew_id = ${crewId} FOR UPDATE`
    );
    const assignmentCount = lockedRows.rows.length;
    
    if (data.workerCount !== undefined && data.workerCount < assignmentCount) {
      errors.push({
        field: 'workerCount',
        code: 'BELOW_ASSIGNMENT_COUNT',
        message: `Cannot reduce worker count below ${assignmentCount} (current assignments)`
      });
    }
    
    if (errors.length > 0) {
      return { ok: false, errors };
    }
    return { ok: true, value: {} };
  }
);

export async function validateCrewDelete(crewId: string): Promise<void> {
  const client = getClient();
  
  const lockedRows = await client.execute(
    sql`SELECT id FROM edls_assignments WHERE crew_id = ${crewId} FOR UPDATE`
  );
  const assignmentCount = lockedRows.rows.length;
  
  if (assignmentCount > 0) {
    const { DomainValidationError } = await import('../utils/validation');
    throw new DomainValidationError([{
      field: 'id',
      code: 'HAS_ASSIGNMENTS',
      message: `Cannot delete crew with ${assignmentCount} active assignment(s)`
    }]);
  }
}

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
      await validate.validateOrThrow(insertCrew);
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
      return runInTransaction(async () => {
        const client = getClient();
        const [existing] = await client.select().from(edlsCrews).where(eq(edlsCrews.id, id));
        if (!existing) return undefined;
        
        await validate.validateOrThrow(crewUpdate, existing);
        
        const [crew] = await client
          .update(edlsCrews)
          .set(crewUpdate)
          .where(eq(edlsCrews.id, id))
          .returning();
        return crew || undefined;
      });
    },

    async delete(id: string): Promise<boolean> {
      return runInTransaction(async () => {
        await validateCrewDelete(id);
        const client = getClient();
        const result = await client.delete(edlsCrews).where(eq(edlsCrews.id, id)).returning();
        return result.length > 0;
      });
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
  };
}

export const edlsCrewsLoggingConfig = defineLoggingConfig<EdlsCrewsStorage>({
  module: 'edls-crews',
  // No module-level stateKey — update/delete `before` is the raw crew row
  // (legacy shape) and the create/createMany `after` hooks wrap the result
  // explicitly so the emitted log payloads stay byte-identical.
  methods: {
    create: {
      state: { fallbackId: 'new crew' },
      getHostEntityId: (args, result) => result?.sheetId || args[0]?.sheetId,
      getDescription: async (args, result) => {
        const title = result?.title || args[0]?.title || 'Untitled';
        return `Created crew [${title}]`;
      },
      after: async (_args, result) => ({
        crew: result,
        metadata: {
          crewId: result?.id,
          sheetId: result?.sheetId,
          title: result?.title,
          workerCount: result?.workerCount,
        },
      }),
    },
    createMany: {
      getEntityId: () => 'bulk create',
      getHostEntityId: (args, result) => result?.[0]?.sheetId || args[0]?.[0]?.sheetId,
      getDescription: async (args, result) => {
        const count = result?.length || args[0]?.length || 0;
        const titles = (result || args[0] || []).map((c: any) => c.title || 'Untitled').join(', ');
        return `Created ${count} crew(s) [${titles}]`;
      },
      after: async (_args, result) => ({
        crews: result,
        metadata: {
          count: result?.length,
          sheetId: result?.[0]?.sheetId,
        },
      }),
    },
    update: {
      getHostEntityId: async (_args, result, beforeState) => result?.sheetId || beforeState?.sheetId,
      getDescription: async (_args, result, beforeState) => {
        const title = result?.title || beforeState?.title || 'Untitled';
        return `Updated crew [${title}]`;
      },
      after: async (_args, result) => result,
    },
    delete: {
      getHostEntityId: async (_args, _result, beforeState) => beforeState?.sheetId,
      getDescription: async (_args, _result, beforeState) => {
        const title = beforeState?.title || 'Untitled';
        return `Deleted crew [${title}]`;
      },
    },
    deleteBySheetId: {
      // args[0] is a sheetId here, not a crew id — explicitly suppress the
      // default `storage.get(args[0])` before-fetch and the default
      // delete getEntityId.
      getEntityId: () => 'bulk delete',
      getHostEntityId: (args) => args[0],
      before: undefined,
      getDescription: async (_args, result) =>
        `Deleted all crews for sheet (${result} crews removed)`,
      after: async (_args, result) => ({ deletedCount: result }),
    },
  },
});
