import { getClient } from "../../transaction-context";
import { eq, getTableName } from "drizzle-orm";
import { tableExists as tableExistsUtil } from "../../utils";
import {
  sitespecificFreemanCrewleads,
  type FreemanCrewlead,
  type InsertFreemanCrewlead,
} from "../../../../shared/schema/sitespecific/freeman/schema";
import { type StorageLoggingConfig } from "../../middleware/logging";

export type { FreemanCrewlead, InsertFreemanCrewlead };

export interface FreemanCrewleadsStorage {
  getAll(): Promise<FreemanCrewlead[]>;
  get(id: string): Promise<FreemanCrewlead | undefined>;
  create(record: InsertFreemanCrewlead): Promise<FreemanCrewlead>;
  update(
    id: string,
    record: Partial<InsertFreemanCrewlead>,
  ): Promise<FreemanCrewlead | undefined>;
  delete(id: string): Promise<boolean>;
  tableExists(): Promise<boolean>;
}

const tableName = getTableName(sitespecificFreemanCrewleads);

export function createFreemanCrewleadsStorage(): FreemanCrewleadsStorage {
  return {
    async tableExists(): Promise<boolean> {
      return tableExistsUtil(tableName);
    },

    async getAll(): Promise<FreemanCrewlead[]> {
      if (!(await this.tableExists())) {
        throw new Error("COMPONENT_TABLE_NOT_FOUND");
      }
      const client = getClient();
      return client
        .select()
        .from(sitespecificFreemanCrewleads)
        .orderBy(sitespecificFreemanCrewleads.name);
    },

    async get(id: string): Promise<FreemanCrewlead | undefined> {
      if (!(await this.tableExists())) {
        throw new Error("COMPONENT_TABLE_NOT_FOUND");
      }
      const client = getClient();
      const results = await client
        .select()
        .from(sitespecificFreemanCrewleads)
        .where(eq(sitespecificFreemanCrewleads.id, id));
      return results[0];
    },

    async create(record: InsertFreemanCrewlead): Promise<FreemanCrewlead> {
      if (!(await this.tableExists())) {
        throw new Error("COMPONENT_TABLE_NOT_FOUND");
      }
      const client = getClient();
      const results = await client
        .insert(sitespecificFreemanCrewleads)
        .values(record)
        .returning();
      return results[0];
    },

    async update(
      id: string,
      record: Partial<InsertFreemanCrewlead>,
    ): Promise<FreemanCrewlead | undefined> {
      if (!(await this.tableExists())) {
        throw new Error("COMPONENT_TABLE_NOT_FOUND");
      }
      const client = getClient();
      const results = await client
        .update(sitespecificFreemanCrewleads)
        .set(record)
        .where(eq(sitespecificFreemanCrewleads.id, id))
        .returning();
      return results[0];
    },

    async delete(id: string): Promise<boolean> {
      if (!(await this.tableExists())) {
        throw new Error("COMPONENT_TABLE_NOT_FOUND");
      }
      const client = getClient();
      const results = await client
        .delete(sitespecificFreemanCrewleads)
        .where(eq(sitespecificFreemanCrewleads.id, id))
        .returning({ id: sitespecificFreemanCrewleads.id });
      return results.length > 0;
    },
  };
}

interface CrewleadBeforeState {
  crewlead?: FreemanCrewlead;
}

function describeCrewlead(record?: {
  name?: string | null;
  siriusId?: string | null;
}): string {
  if (!record) return "unknown crew lead";
  const name = record.name ?? "(unnamed)";
  const sid = record.siriusId ?? "?";
  return `${name} (${sid})`;
}

export const freemanCrewleadsLoggingConfig: StorageLoggingConfig<FreemanCrewleadsStorage> = {
  module: "sitespecific.freeman.crewleads",
  methods: {
    create: {
      enabled: true,
      getEntityId: (_args, result) => result?.id,
      getDescription: (_args, result) =>
        `Created Freeman crew lead ${describeCrewlead(result)}`,
      after: async (_args, result) => result,
    },
    update: {
      enabled: true,
      getEntityId: (args) => args[0],
      before: async (args, storage) => ({
        crewlead: await storage.get(args[0]),
      }),
      after: async (_args, result) => result,
      getDescription: (_args, result, beforeState) => {
        const r = result || (beforeState as CrewleadBeforeState | undefined)?.crewlead;
        return `Updated Freeman crew lead ${describeCrewlead(r ?? undefined)}`;
      },
    },
    delete: {
      enabled: true,
      getEntityId: (args) => args[0],
      before: async (args, storage) => ({
        crewlead: await storage.get(args[0]),
      }),
      getDescription: (_args, _result, beforeState) => {
        const r = (beforeState as CrewleadBeforeState | undefined)?.crewlead;
        return `Deleted Freeman crew lead ${describeCrewlead(r ?? undefined)}`;
      },
    },
  },
};
