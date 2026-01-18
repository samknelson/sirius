import { createNoopValidator } from './utils/validation';
import { 
  edlsAssignments,
  edlsCrews,
  edlsSheets,
  workers,
  contacts,
  type EdlsAssignment, 
  type InsertEdlsAssignment
} from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";
import { StorageLoggingConfig } from "./middleware/logging";
import { getClient } from "./transaction-context";

export const validate = createNoopValidator();

export interface EdlsAssignmentWithWorker extends EdlsAssignment {
  worker: {
    id: string;
    siriusId: number | null;
    displayName: string | null;
    given: string | null;
    family: string | null;
  };
}

export interface EdlsAssignmentsStorage {
  getByCrewId(crewId: string): Promise<EdlsAssignmentWithWorker[]>;
  getBySheetId(sheetId: string): Promise<EdlsAssignmentWithWorker[]>;
  get(id: string): Promise<EdlsAssignment | undefined>;
  create(assignment: InsertEdlsAssignment): Promise<EdlsAssignment>;
  delete(id: string): Promise<boolean>;
  deleteByCrewId(crewId: string): Promise<number>;
}

export function createEdlsAssignmentsStorage(): EdlsAssignmentsStorage {
  return {
    async getByCrewId(crewId: string): Promise<EdlsAssignmentWithWorker[]> {
      const client = getClient();
      const rows = await client
        .select({
          assignment: edlsAssignments,
          worker: {
            id: workers.id,
            siriusId: workers.siriusId,
            displayName: contacts.displayName,
            given: contacts.given,
            family: contacts.family,
          },
        })
        .from(edlsAssignments)
        .innerJoin(workers, eq(edlsAssignments.workerId, workers.id))
        .innerJoin(contacts, eq(workers.contactId, contacts.id))
        .where(eq(edlsAssignments.crewId, crewId));

      return rows.map(row => ({
        ...row.assignment,
        worker: row.worker,
      }));
    },

    async getBySheetId(sheetId: string): Promise<EdlsAssignmentWithWorker[]> {
      const client = getClient();
      const rows = await client
        .select({
          assignment: edlsAssignments,
          worker: {
            id: workers.id,
            siriusId: workers.siriusId,
            displayName: contacts.displayName,
            given: contacts.given,
            family: contacts.family,
          },
        })
        .from(edlsAssignments)
        .innerJoin(edlsCrews, eq(edlsAssignments.crewId, edlsCrews.id))
        .innerJoin(workers, eq(edlsAssignments.workerId, workers.id))
        .innerJoin(contacts, eq(workers.contactId, contacts.id))
        .where(eq(edlsCrews.sheetId, sheetId));

      return rows.map(row => ({
        ...row.assignment,
        worker: row.worker,
      }));
    },

    async get(id: string): Promise<EdlsAssignment | undefined> {
      const client = getClient();
      const [assignment] = await client.select().from(edlsAssignments).where(eq(edlsAssignments.id, id));
      return assignment || undefined;
    },

    async create(insertAssignment: InsertEdlsAssignment): Promise<EdlsAssignment> {
      validate.validateOrThrow(insertAssignment);
      const client = getClient();
      const [assignment] = await client.insert(edlsAssignments).values(insertAssignment).returning();
      return assignment;
    },

    async delete(id: string): Promise<boolean> {
      const client = getClient();
      const result = await client.delete(edlsAssignments).where(eq(edlsAssignments.id, id)).returning();
      return result.length > 0;
    },

    async deleteByCrewId(crewId: string): Promise<number> {
      const client = getClient();
      const result = await client.delete(edlsAssignments).where(eq(edlsAssignments.crewId, crewId)).returning();
      return result.length;
    },
  };
}

export const edlsAssignmentsLoggingConfig: StorageLoggingConfig<EdlsAssignmentsStorage> = {
  module: 'edls-assignments',
  methods: {
    create: {
      enabled: true,
      getEntityId: (args, result) => result?.id || 'new',
      getHostEntityId: (args) => args[0]?.crewId,
      getDescription: async () => `Created assignment for worker`,
    },
    delete: {
      enabled: true,
      getEntityId: (args) => args[0],
      getDescription: async (args) => `Deleted assignment ${args[0]}`,
    },
  },
};
