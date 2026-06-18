import { getClient } from '../../transaction-context';
import { eq, getTableName } from "drizzle-orm";
import { tableExists as tableExistsUtil } from "../../utils";
import {
  sitespecificBaoEmployerImmediateEligibility,
  type BaoEmployerImmediateEligibility,
  type InsertBaoEmployerImmediateEligibility,
} from "../../../../shared/schema/sitespecific/bao/schema";
import type { StorageLoggingConfig } from "../../middleware/logging";

export type { BaoEmployerImmediateEligibility, InsertBaoEmployerImmediateEligibility };

export interface BaoImmediateEligibilityStorage {
  getByEmployerId(employerId: string): Promise<BaoEmployerImmediateEligibility | undefined>;
  get(id: string): Promise<BaoEmployerImmediateEligibility | undefined>;
  create(record: InsertBaoEmployerImmediateEligibility): Promise<BaoEmployerImmediateEligibility>;
  update(id: string, record: Partial<InsertBaoEmployerImmediateEligibility>): Promise<BaoEmployerImmediateEligibility | undefined>;
  delete(id: string): Promise<boolean>;
  tableExists(): Promise<boolean>;
}

const tableName = getTableName(sitespecificBaoEmployerImmediateEligibility);

export function createBaoImmediateEligibilityStorage(): BaoImmediateEligibilityStorage {
  return {
    async tableExists(): Promise<boolean> {
      return tableExistsUtil(tableName);
    },

    async getByEmployerId(employerId: string): Promise<BaoEmployerImmediateEligibility | undefined> {
      if (!(await this.tableExists())) {
        throw new Error("COMPONENT_TABLE_NOT_FOUND");
      }
      const client = getClient();
      const results = await client
        .select()
        .from(sitespecificBaoEmployerImmediateEligibility)
        .where(eq(sitespecificBaoEmployerImmediateEligibility.employerId, employerId));
      return results[0];
    },

    async get(id: string): Promise<BaoEmployerImmediateEligibility | undefined> {
      if (!(await this.tableExists())) {
        throw new Error("COMPONENT_TABLE_NOT_FOUND");
      }
      const client = getClient();
      const results = await client
        .select()
        .from(sitespecificBaoEmployerImmediateEligibility)
        .where(eq(sitespecificBaoEmployerImmediateEligibility.id, id));
      return results[0];
    },

    async create(record: InsertBaoEmployerImmediateEligibility): Promise<BaoEmployerImmediateEligibility> {
      if (!(await this.tableExists())) {
        throw new Error("COMPONENT_TABLE_NOT_FOUND");
      }
      const client = getClient();
      const results = await client
        .insert(sitespecificBaoEmployerImmediateEligibility)
        .values(record)
        .returning();
      return results[0];
    },

    async update(id: string, record: Partial<InsertBaoEmployerImmediateEligibility>): Promise<BaoEmployerImmediateEligibility | undefined> {
      if (!(await this.tableExists())) {
        throw new Error("COMPONENT_TABLE_NOT_FOUND");
      }
      const client = getClient();
      const results = await client
        .update(sitespecificBaoEmployerImmediateEligibility)
        .set(record)
        .where(eq(sitespecificBaoEmployerImmediateEligibility.id, id))
        .returning();
      return results[0];
    },

    async delete(id: string): Promise<boolean> {
      if (!(await this.tableExists())) {
        throw new Error("COMPONENT_TABLE_NOT_FOUND");
      }
      const client = getClient();
      const results = await client
        .delete(sitespecificBaoEmployerImmediateEligibility)
        .where(eq(sitespecificBaoEmployerImmediateEligibility.id, id))
        .returning({ id: sitespecificBaoEmployerImmediateEligibility.id });
      return results.length > 0;
    },
  };
}

export const baoImmediateEligibilityLoggingConfig: StorageLoggingConfig<BaoImmediateEligibilityStorage> = {
  module: 'sitespecific.bao.immediate-eligibility',
  methods: {
    create: {
      enabled: true,
      getEntityId: (args, result) => result?.id,
      getHostEntityId: (args, result) => result?.employerId ?? args[0]?.employerId,
      getDescription: (args, result) =>
        `Set immediate eligibility window [${result?.startYmd ?? args[0]?.startYmd} → ${result?.endYmd ?? args[0]?.endYmd}]`,
    },
    update: {
      enabled: true,
      before: async (args, storage) => storage.get(args[0]),
      getEntityId: (args) => args[0],
      getHostEntityId: (args, result, beforeState) => result?.employerId ?? beforeState?.employerId,
      getDescription: (args, result) =>
        `Updated immediate eligibility window [${result?.startYmd} → ${result?.endYmd}]`,
    },
    delete: {
      enabled: true,
      before: async (args, storage) => storage.get(args[0]),
      getEntityId: (args) => args[0],
      getHostEntityId: (args, result, beforeState) => beforeState?.employerId,
      getDescription: () => `Cleared immediate eligibility window`,
    },
  },
};
