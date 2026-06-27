import { getClient, runInTransaction } from "../transaction-context";
import {
  grievances,
  grievanceWorkers,
  grievanceEmployers,
  optionsGrievanceStatus,
  optionsGrievanceCategory,
  workers,
  contacts,
  employers,
  type Grievance,
  type InsertGrievance,
  type GrievanceWorker,
  type GrievanceEmployer,
} from "@shared/schema";
import { eq, and, inArray, asc } from "drizzle-orm";
import { type StorageLoggingConfig } from "../middleware/logging";

export interface GrievanceListItem extends Grievance {
  statusName: string | null;
  categoryName: string | null;
  workerCount: number;
  employerCount: number;
}

export interface GrievanceLinkedWorker {
  workerId: string;
  siriusId: number | null;
  displayName: string | null;
}

export interface GrievanceLinkedEmployer {
  employerId: string;
  name: string;
}

export interface GrievanceWithDetails extends Grievance {
  statusName: string | null;
  categoryName: string | null;
  workers: GrievanceLinkedWorker[];
  employers: GrievanceLinkedEmployer[];
}

export interface GrievanceStorage {
  list(): Promise<GrievanceListItem[]>;
  get(id: string): Promise<Grievance | undefined>;
  getWithDetails(id: string): Promise<GrievanceWithDetails | undefined>;
  create(data: InsertGrievance): Promise<Grievance>;
  update(id: string, data: Partial<InsertGrievance>): Promise<Grievance | undefined>;
  delete(id: string): Promise<boolean>;
  listWorkers(grievanceId: string): Promise<GrievanceLinkedWorker[]>;
  addWorker(grievanceId: string, workerId: string, primary?: boolean): Promise<GrievanceWorker>;
  removeWorker(grievanceId: string, workerId: string): Promise<boolean>;
  listEmployers(grievanceId: string): Promise<GrievanceLinkedEmployer[]>;
  addEmployer(grievanceId: string, employerId: string): Promise<GrievanceEmployer>;
  removeEmployer(grievanceId: string, employerId: string): Promise<boolean>;
  getLogLabel(id: string): Promise<string | undefined>;
}

export function createGrievanceStorage(): GrievanceStorage {
  return {
    async list(): Promise<GrievanceListItem[]> {
      const client = getClient();
      const rows = await client
        .select({
          id: grievances.id,
          complaint: grievances.complaint,
          remedy: grievances.remedy,
          cardinality: grievances.cardinality,
          statusId: grievances.statusId,
          categoryId: grievances.categoryId,
          data: grievances.data,
          statusName: optionsGrievanceStatus.name,
          categoryName: optionsGrievanceCategory.name,
        })
        .from(grievances)
        .leftJoin(optionsGrievanceStatus, eq(grievances.statusId, optionsGrievanceStatus.id))
        .leftJoin(optionsGrievanceCategory, eq(grievances.categoryId, optionsGrievanceCategory.id));

      if (rows.length === 0) return [];

      const ids = rows.map((r) => r.id);
      const workerLinks = await client
        .select({ grievanceId: grievanceWorkers.grievanceId })
        .from(grievanceWorkers)
        .where(inArray(grievanceWorkers.grievanceId, ids));
      const employerLinks = await client
        .select({ grievanceId: grievanceEmployers.grievanceId })
        .from(grievanceEmployers)
        .where(inArray(grievanceEmployers.grievanceId, ids));

      const workerCounts = new Map<string, number>();
      for (const l of workerLinks) {
        workerCounts.set(l.grievanceId, (workerCounts.get(l.grievanceId) ?? 0) + 1);
      }
      const employerCounts = new Map<string, number>();
      for (const l of employerLinks) {
        employerCounts.set(l.grievanceId, (employerCounts.get(l.grievanceId) ?? 0) + 1);
      }

      return rows.map((r) => ({
        ...r,
        workerCount: workerCounts.get(r.id) ?? 0,
        employerCount: employerCounts.get(r.id) ?? 0,
      }));
    },

    async get(id: string): Promise<Grievance | undefined> {
      const client = getClient();
      const [row] = await client.select().from(grievances).where(eq(grievances.id, id));
      return row || undefined;
    },

    async getWithDetails(id: string): Promise<GrievanceWithDetails | undefined> {
      const client = getClient();
      const [row] = await client
        .select({
          id: grievances.id,
          complaint: grievances.complaint,
          remedy: grievances.remedy,
          cardinality: grievances.cardinality,
          statusId: grievances.statusId,
          categoryId: grievances.categoryId,
          data: grievances.data,
          statusName: optionsGrievanceStatus.name,
          categoryName: optionsGrievanceCategory.name,
        })
        .from(grievances)
        .leftJoin(optionsGrievanceStatus, eq(grievances.statusId, optionsGrievanceStatus.id))
        .leftJoin(optionsGrievanceCategory, eq(grievances.categoryId, optionsGrievanceCategory.id))
        .where(eq(grievances.id, id));

      if (!row) return undefined;

      const linkedWorkers = await this.listWorkers(id);
      const linkedEmployers = await this.listEmployers(id);

      return {
        ...row,
        workers: linkedWorkers,
        employers: linkedEmployers,
      };
    },

    async create(data: InsertGrievance): Promise<Grievance> {
      const client = getClient();
      const [row] = await client.insert(grievances).values(data).returning();
      return row;
    },

    async update(id: string, data: Partial<InsertGrievance>): Promise<Grievance | undefined> {
      const client = getClient();
      const [row] = await client
        .update(grievances)
        .set(data)
        .where(eq(grievances.id, id))
        .returning();
      return row || undefined;
    },

    async delete(id: string): Promise<boolean> {
      return runInTransaction(async () => {
        const client = getClient();
        await client.delete(grievanceWorkers).where(eq(grievanceWorkers.grievanceId, id));
        await client.delete(grievanceEmployers).where(eq(grievanceEmployers.grievanceId, id));
        const result = await client.delete(grievances).where(eq(grievances.id, id)).returning();
        return result.length > 0;
      });
    },

    async listWorkers(grievanceId: string): Promise<GrievanceLinkedWorker[]> {
      const client = getClient();
      return client
        .select({
          workerId: grievanceWorkers.workerId,
          siriusId: workers.siriusId,
          displayName: contacts.displayName,
        })
        .from(grievanceWorkers)
        .innerJoin(workers, eq(grievanceWorkers.workerId, workers.id))
        .leftJoin(contacts, eq(workers.contactId, contacts.id))
        .where(eq(grievanceWorkers.grievanceId, grievanceId))
        .orderBy(asc(contacts.displayName));
    },

    async addWorker(
      grievanceId: string,
      workerId: string,
      primary = false,
    ): Promise<GrievanceWorker> {
      const client = getClient();
      const [row] = await client
        .insert(grievanceWorkers)
        .values({ grievanceId, workerId, primary })
        .returning();
      return row;
    },

    async removeWorker(grievanceId: string, workerId: string): Promise<boolean> {
      const client = getClient();
      const result = await client
        .delete(grievanceWorkers)
        .where(and(eq(grievanceWorkers.grievanceId, grievanceId), eq(grievanceWorkers.workerId, workerId)))
        .returning();
      return result.length > 0;
    },

    async listEmployers(grievanceId: string): Promise<GrievanceLinkedEmployer[]> {
      const client = getClient();
      return client
        .select({
          employerId: grievanceEmployers.employerId,
          name: employers.name,
        })
        .from(grievanceEmployers)
        .innerJoin(employers, eq(grievanceEmployers.employerId, employers.id))
        .where(eq(grievanceEmployers.grievanceId, grievanceId))
        .orderBy(asc(employers.name));
    },

    async addEmployer(grievanceId: string, employerId: string): Promise<GrievanceEmployer> {
      const client = getClient();
      const [row] = await client
        .insert(grievanceEmployers)
        .values({ grievanceId, employerId })
        .returning();
      return row;
    },

    async removeEmployer(grievanceId: string, employerId: string): Promise<boolean> {
      const client = getClient();
      const result = await client
        .delete(grievanceEmployers)
        .where(and(eq(grievanceEmployers.grievanceId, grievanceId), eq(grievanceEmployers.employerId, employerId)))
        .returning();
      return result.length > 0;
    },

    async getLogLabel(id: string): Promise<string | undefined> {
      const client = getClient();
      const [row] = await client
        .select({
          categoryName: optionsGrievanceCategory.name,
        })
        .from(grievances)
        .leftJoin(optionsGrievanceCategory, eq(grievances.categoryId, optionsGrievanceCategory.id))
        .where(eq(grievances.id, id));
      if (!row) return undefined;
      return row.categoryName ? `${row.categoryName} grievance` : `grievance ${id.slice(0, 8)}`;
    },
  };
}

async function describeGrievance(
  storage: GrievanceStorage,
  id: string,
): Promise<string> {
  const label = await storage.getLogLabel(id);
  return label ?? `grievance ${id.slice(0, 8)}`;
}

/**
 * Logging configuration for grievance storage operations.
 *
 * Worker / employer link mutations set the host entity to the parent grievance
 * id so they surface in the grievance's Logs tab.
 */
export const grievanceLoggingConfig: StorageLoggingConfig<GrievanceStorage> = {
  module: "grievances",
  methods: {
    create: {
      enabled: true,
      getEntityId: (_args, result) => result?.id,
      getHostEntityId: (_args, result) => result?.id,
      after: async (_args, result) => result,
      getDescription: async (_args, result, _b, _a, storage) => {
        if (!result?.id) return "Created grievance";
        return `Created ${await describeGrievance(storage, result.id)}`;
      },
    },
    update: {
      enabled: true,
      getEntityId: (args) => args[0],
      getHostEntityId: (args) => args[0],
      before: async (args, storage) => storage.get(args[0]),
      after: async (args, result) => result,
      getDescription: async (args, _result, _b, _a, storage) =>
        `Updated ${await describeGrievance(storage, args[0])}`,
    },
    delete: {
      enabled: true,
      getEntityId: (args) => args[0],
      getHostEntityId: (args) => args[0],
      before: async (args, storage) => storage.get(args[0]),
      getDescription: async (args, _result, beforeState) => {
        const id = args[0] as string;
        return `Deleted grievance ${typeof id === "string" ? id.slice(0, 8) : id}`;
      },
    },
    addWorker: {
      enabled: true,
      getEntityId: (args) => args[1],
      getHostEntityId: (args) => args[0],
      after: async (_args, result) => result,
      getDescription: async (args) => `Linked worker to grievance`,
    },
    removeWorker: {
      enabled: true,
      getEntityId: (args) => args[1],
      getHostEntityId: (args) => args[0],
      getDescription: async () => `Unlinked worker from grievance`,
    },
    addEmployer: {
      enabled: true,
      getEntityId: (args) => args[1],
      getHostEntityId: (args) => args[0],
      after: async (_args, result) => result,
      getDescription: async () => `Linked employer to grievance`,
    },
    removeEmployer: {
      enabled: true,
      getEntityId: (args) => args[1],
      getHostEntityId: (args) => args[0],
      getDescription: async () => `Unlinked employer from grievance`,
    },
  },
};
