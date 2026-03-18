import { createNoopValidator } from './utils/validation';
import { getClient } from './transaction-context';
import { eq, desc, and, sql, inArray } from "drizzle-orm";
import { tableExists as tableExistsUtil } from "./utils";
import {
  sitespecificBtuPoliticalOfficials,
  sitespecificBtuPoliticalWorkerReps,
  type BtuPoliticalOfficial,
  type InsertBtuPoliticalOfficial,
  type BtuPoliticalWorkerRep,
  type InsertBtuPoliticalWorkerRep,
} from "../../shared/schema/sitespecific/btu/political-schema";
import { getTableName } from "drizzle-orm";
import type { StorageLoggingConfig } from "./middleware/logging";

export const validate = createNoopValidator();

export type {
  BtuPoliticalOfficial,
  InsertBtuPoliticalOfficial,
  BtuPoliticalWorkerRep,
  InsertBtuPoliticalWorkerRep,
};

export interface BtuPoliticalStorage {
  tableExists(): Promise<boolean>;
  getOfficials(): Promise<BtuPoliticalOfficial[]>;
  getOfficial(id: string): Promise<BtuPoliticalOfficial | undefined>;
  findOfficialByOfficeAndDivision(officeName: string, ocdDivisionId: string): Promise<BtuPoliticalOfficial | undefined>;
  upsertOfficial(record: InsertBtuPoliticalOfficial): Promise<BtuPoliticalOfficial>;
  deleteOfficial(id: string): Promise<boolean>;
  getWorkerReps(workerId: string): Promise<(BtuPoliticalWorkerRep & { official: BtuPoliticalOfficial })[]>;
  setWorkerReps(workerId: string, officialIds: string[], address: string): Promise<void>;
  getWorkersByOfficialId(officialId: string): Promise<{ workerId: string; address: string | null; lastLookedUpAt: Date }[]>;
  getWorkersWithDetailsByOfficialId(officialId: string): Promise<{ workerId: string; workerName: string | null; address: string | null; lastLookedUpAt: Date }[]>;
  getAllOfficialIds(): Promise<string[]>;
}

const officialsTableName = getTableName(sitespecificBtuPoliticalOfficials);

export function createBtuPoliticalStorage(): BtuPoliticalStorage {
  return {
    async tableExists(): Promise<boolean> {
      return tableExistsUtil(officialsTableName);
    },

    async getOfficials(): Promise<BtuPoliticalOfficial[]> {
      if (!(await this.tableExists())) throw new Error("COMPONENT_TABLE_NOT_FOUND");
      const client = getClient();
      return client
        .select()
        .from(sitespecificBtuPoliticalOfficials)
        .orderBy(sitespecificBtuPoliticalOfficials.level, sitespecificBtuPoliticalOfficials.officeName);
    },

    async getOfficial(id: string): Promise<BtuPoliticalOfficial | undefined> {
      if (!(await this.tableExists())) throw new Error("COMPONENT_TABLE_NOT_FOUND");
      const client = getClient();
      const results = await client
        .select()
        .from(sitespecificBtuPoliticalOfficials)
        .where(eq(sitespecificBtuPoliticalOfficials.id, id));
      return results[0];
    },

    async findOfficialByOfficeAndDivision(officeName: string, ocdDivisionId: string): Promise<BtuPoliticalOfficial | undefined> {
      if (!(await this.tableExists())) throw new Error("COMPONENT_TABLE_NOT_FOUND");
      const client = getClient();
      const results = await client
        .select()
        .from(sitespecificBtuPoliticalOfficials)
        .where(and(
          eq(sitespecificBtuPoliticalOfficials.officeName, officeName),
          eq(sitespecificBtuPoliticalOfficials.ocdDivisionId, ocdDivisionId),
        ));
      return results[0];
    },

    async upsertOfficial(record: InsertBtuPoliticalOfficial): Promise<BtuPoliticalOfficial> {
      if (!(await this.tableExists())) throw new Error("COMPONENT_TABLE_NOT_FOUND");
      const client = getClient();
      const existing = record.ocdDivisionId
        ? await this.findOfficialByOfficeAndDivision(record.officeName, record.ocdDivisionId)
        : undefined;
      if (existing) {
        const results = await client
          .update(sitespecificBtuPoliticalOfficials)
          .set({ ...record, updatedAt: new Date() })
          .where(eq(sitespecificBtuPoliticalOfficials.id, existing.id))
          .returning();
        return results[0];
      }
      const results = await client
        .insert(sitespecificBtuPoliticalOfficials)
        .values(record)
        .returning();
      return results[0];
    },

    async deleteOfficial(id: string): Promise<boolean> {
      if (!(await this.tableExists())) throw new Error("COMPONENT_TABLE_NOT_FOUND");
      const client = getClient();
      const results = await client
        .delete(sitespecificBtuPoliticalOfficials)
        .where(eq(sitespecificBtuPoliticalOfficials.id, id))
        .returning({ id: sitespecificBtuPoliticalOfficials.id });
      return results.length > 0;
    },

    async getWorkerReps(workerId: string): Promise<(BtuPoliticalWorkerRep & { official: BtuPoliticalOfficial })[]> {
      if (!(await this.tableExists())) throw new Error("COMPONENT_TABLE_NOT_FOUND");
      const client = getClient();
      const results = await client
        .select({
          rep: sitespecificBtuPoliticalWorkerReps,
          official: sitespecificBtuPoliticalOfficials,
        })
        .from(sitespecificBtuPoliticalWorkerReps)
        .innerJoin(
          sitespecificBtuPoliticalOfficials,
          eq(sitespecificBtuPoliticalWorkerReps.officialId, sitespecificBtuPoliticalOfficials.id),
        )
        .where(eq(sitespecificBtuPoliticalWorkerReps.workerId, workerId))
        .orderBy(sitespecificBtuPoliticalOfficials.level, sitespecificBtuPoliticalOfficials.officeName);

      return results.map(r => ({ ...r.rep, official: r.official }));
    },

    async setWorkerReps(workerId: string, officialIds: string[], address: string): Promise<void> {
      if (!(await this.tableExists())) throw new Error("COMPONENT_TABLE_NOT_FOUND");
      const client = getClient();
      await client
        .delete(sitespecificBtuPoliticalWorkerReps)
        .where(eq(sitespecificBtuPoliticalWorkerReps.workerId, workerId));

      if (officialIds.length > 0) {
        const now = new Date();
        await client
          .insert(sitespecificBtuPoliticalWorkerReps)
          .values(officialIds.map(officialId => ({
            workerId,
            officialId,
            address,
            lastLookedUpAt: now,
          })));
      }
    },

    async getWorkersByOfficialId(officialId: string): Promise<{ workerId: string; address: string | null; lastLookedUpAt: Date }[]> {
      if (!(await this.tableExists())) throw new Error("COMPONENT_TABLE_NOT_FOUND");
      const client = getClient();
      const results = await client
        .select({
          workerId: sitespecificBtuPoliticalWorkerReps.workerId,
          address: sitespecificBtuPoliticalWorkerReps.address,
          lastLookedUpAt: sitespecificBtuPoliticalWorkerReps.lastLookedUpAt,
        })
        .from(sitespecificBtuPoliticalWorkerReps)
        .where(eq(sitespecificBtuPoliticalWorkerReps.officialId, officialId));
      return results;
    },

    async getWorkersWithDetailsByOfficialId(officialId: string): Promise<{ workerId: string; workerName: string | null; address: string | null; lastLookedUpAt: Date }[]> {
      if (!(await this.tableExists())) throw new Error("COMPONENT_TABLE_NOT_FOUND");
      const client = getClient();
      const results = await client.execute(sql`
        SELECT pwr.worker_id as "workerId", c.display_name as "workerName", pwr.address, pwr.last_looked_up_at as "lastLookedUpAt"
        FROM sitespecific_btu_political_worker_reps pwr
        INNER JOIN workers w ON w.id = pwr.worker_id
        INNER JOIN contacts c ON c.id = w.contact_id
        WHERE pwr.official_id = ${officialId}
        ORDER BY c.display_name
      `);
      return results.rows.map((row: Record<string, unknown>) => ({
        workerId: row.workerId as string,
        workerName: (row.workerName as string) || null,
        address: (row.address as string) || null,
        lastLookedUpAt: row.lastLookedUpAt as Date,
      }));
    },

    async getAllOfficialIds(): Promise<string[]> {
      if (!(await this.tableExists())) throw new Error("COMPONENT_TABLE_NOT_FOUND");
      const client = getClient();
      const results = await client
        .selectDistinct({ officialId: sitespecificBtuPoliticalWorkerReps.officialId })
        .from(sitespecificBtuPoliticalWorkerReps);
      return results.map(r => r.officialId);
    },
  };
}

export const btuPoliticalLoggingConfig: StorageLoggingConfig<BtuPoliticalStorage> = {
  module: 'btu_political',
  methods: {
    upsertOfficial: {
      enabled: true,
      getEntityId: (_args, result) => result?.id || 'unknown',
    },
    deleteOfficial: {
      enabled: true,
      getEntityId: (args) => args[0] || 'unknown',
    },
    setWorkerReps: {
      enabled: true,
      getEntityId: (args) => args[0] || 'unknown',
    },
  },
};
