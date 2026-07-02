import { getClient } from "../transaction-context";
import {
  grievanceSettlements,
  type GrievanceSettlement,
} from "@shared/schema";
import { eq, and, asc } from "drizzle-orm";
import { type StorageLoggingConfig } from "../middleware/logging";

/**
 * Storage for settlements recorded against a grievance. Owned by the
 * `grievance.settlement` component. Every method takes `grievanceId` as its
 * first argument so writes are attributed to the grievance as the host entity
 * in the activity log (see `grievanceSettlementLoggingConfig`).
 *
 * This task manages the `description` and `amount` columns only. The
 * `type_ids` multi-value reference is out of scope and left untouched.
 */
export interface GrievanceSettlementStorage {
  list(grievanceId: string): Promise<GrievanceSettlement[]>;
  get(
    grievanceId: string,
    settlementId: string,
  ): Promise<GrievanceSettlement | undefined>;
  create(
    grievanceId: string,
    data: { description?: string | null; amount?: string | null },
  ): Promise<GrievanceSettlement>;
  update(
    grievanceId: string,
    settlementId: string,
    data: { description?: string | null; amount?: string | null },
  ): Promise<GrievanceSettlement | undefined>;
  delete(grievanceId: string, settlementId: string): Promise<boolean>;
}

export function createGrievanceSettlementStorage(): GrievanceSettlementStorage {
  return {
    async list(grievanceId: string): Promise<GrievanceSettlement[]> {
      const client = getClient();
      return client
        .select()
        .from(grievanceSettlements)
        .where(eq(grievanceSettlements.grievanceId, grievanceId))
        .orderBy(asc(grievanceSettlements.id));
    },

    async get(
      grievanceId: string,
      settlementId: string,
    ): Promise<GrievanceSettlement | undefined> {
      const client = getClient();
      const [row] = await client
        .select()
        .from(grievanceSettlements)
        .where(
          and(
            eq(grievanceSettlements.id, settlementId),
            eq(grievanceSettlements.grievanceId, grievanceId),
          ),
        );
      return row || undefined;
    },

    async create(
      grievanceId: string,
      data: { description?: string | null; amount?: string | null },
    ): Promise<GrievanceSettlement> {
      const client = getClient();
      const [row] = await client
        .insert(grievanceSettlements)
        .values({
          grievanceId,
          description: data.description ?? null,
          amount: data.amount ?? null,
        })
        .returning();
      return row;
    },

    async update(
      grievanceId: string,
      settlementId: string,
      data: { description?: string | null; amount?: string | null },
    ): Promise<GrievanceSettlement | undefined> {
      const client = getClient();
      const set: Partial<typeof grievanceSettlements.$inferInsert> = {};
      if (data.description !== undefined) set.description = data.description ?? null;
      if (data.amount !== undefined) set.amount = data.amount ?? null;
      const [row] = await client
        .update(grievanceSettlements)
        .set(set)
        .where(
          and(
            eq(grievanceSettlements.id, settlementId),
            eq(grievanceSettlements.grievanceId, grievanceId),
          ),
        )
        .returning();
      return row || undefined;
    },

    async delete(grievanceId: string, settlementId: string): Promise<boolean> {
      const client = getClient();
      const result = await client
        .delete(grievanceSettlements)
        .where(
          and(
            eq(grievanceSettlements.id, settlementId),
            eq(grievanceSettlements.grievanceId, grievanceId),
          ),
        )
        .returning();
      return result.length > 0;
    },
  };
}

export const grievanceSettlementLoggingConfig: StorageLoggingConfig<GrievanceSettlementStorage> = {
  module: "grievanceSettlements",
  methods: {
    create: {
      enabled: true,
      getEntityId: (_args, result) => result?.id,
      getHostEntityId: (args) => args[0],
      after: async (_args, result) => result,
      getDescription: async () => `Added settlement to grievance`,
    },
    update: {
      enabled: true,
      getEntityId: (args) => args[1],
      getHostEntityId: (args) => args[0],
      after: async (_args, result) => result,
      getDescription: async () => `Updated settlement on grievance`,
    },
    delete: {
      enabled: true,
      getEntityId: (args) => args[1],
      getHostEntityId: (args) => args[0],
      getDescription: async () => `Removed settlement from grievance`,
    },
  },
};
