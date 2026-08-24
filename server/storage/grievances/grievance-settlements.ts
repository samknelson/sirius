import { getClient, onAfterCommit, runInTransaction } from "../transaction-context";
import {
  grievanceNameDenorm,
  grievances,
  grievanceSettlements,
  optionsGrievanceCategory,
  type Grievance,
  type GrievanceSettlement,
} from "@shared/schema";
import { eq, and, asc, sql } from "drizzle-orm";
import { type StorageLoggingConfig } from "../middleware/logging";
import { eventBus, EventType } from "../../services/event-bus";

/**
 * The grievance a settlement is on, with the two parts its display title is
 * composed from: the denormalised name and the category name. Read inside
 * the writing transaction so the snapshot is the grievance as that write saw
 * it — read outside one and a concurrent rename or deletion lands between
 * the change and the notice that describes it.
 *
 * Under READ COMMITTED this statement still sees a rename that commits
 * mid-transaction. That is deliberate: the settlement is pinned (it is what
 * the notice is ABOUT), while the grievance is only named, so its current
 * title is the right one to print. Locking the parent grievance on every
 * settlement write would trade that nuance for contention on a hot row.
 */
async function readGrievanceSnapshot(grievanceId: string): Promise<{
  grievance: Grievance | null;
  grievanceTitleParts: { name: string | null; categoryName: string | null } | null;
}> {
  const client = getClient();
  const [found] = await client
    .select({
      grievance: grievances,
      name: grievanceNameDenorm.name,
      categoryName: optionsGrievanceCategory.name,
    })
    .from(grievances)
    .leftJoin(
      optionsGrievanceCategory,
      eq(grievances.categoryId, optionsGrievanceCategory.id),
    )
    .leftJoin(
      grievanceNameDenorm,
      eq(grievanceNameDenorm.grievanceId, grievances.id),
    )
    .where(eq(grievances.id, grievanceId));
  if (!found) return { grievance: null, grievanceTitleParts: null };
  return {
    grievance: found.grievance,
    grievanceTitleParts: {
      name: found.name ?? null,
      categoryName: found.categoryName ?? null,
    },
  };
}

/**
 * Emit `GRIEVANCE_SETTLEMENT_SAVED` after the current transaction commits so a
 * concurrent read never observes the change before it is durable. The whole
 * settlement row is captured on the payload — for deletes it is already gone
 * by the time the notifier runs, so it must be read before removal and
 * carried here — and so is the grievance it names, which can be renamed or
 * deleted in the same window.
 */
async function emitGrievanceSettlementSaved(
  grievanceId: string,
  operation: "created" | "updated" | "deleted",
  row: GrievanceSettlement,
): Promise<void> {
  const snapshot = await readGrievanceSnapshot(grievanceId);
  onAfterCommit(() => {
    void eventBus.emit(EventType.GRIEVANCE_SETTLEMENT_SAVED, {
      grievanceId,
      settlementId: row.id,
      operation,
      row,
      ...snapshot,
    });
  });
}

/**
 * Storage for settlements recorded against a grievance. Owned by the
 * `grievance.settlement` component. Every method takes `grievanceId` as its
 * first argument so writes are attributed to the grievance as the host entity
 * in the activity log (see `grievanceSettlementLoggingConfig`).
 *
 * Manages the `description`, `amount`, and `type_ids` columns. `type_ids` is a
 * multi-value reference to `options_grievance_settlement_type` stored as a
 * plain `text[]`; callers pass the full list of selected ids (an empty array
 * clears them).
 */
export interface GrievanceSettlementStorage {
  list(grievanceId: string): Promise<GrievanceSettlement[]>;
  get(
    grievanceId: string,
    settlementId: string,
  ): Promise<GrievanceSettlement | undefined>;
  /**
   * One settlement by its own id, without knowing which grievance it is
   * on — the grievance id comes back ON the row. For callers holding
   * only a settlement id (the preview picker hands back what it listed).
   */
  getById(settlementId: string): Promise<GrievanceSettlement | undefined>;
  create(
    grievanceId: string,
    data: {
      description?: string | null;
      amount?: string | null;
      typeIds?: string[] | null;
    },
  ): Promise<GrievanceSettlement>;
  update(
    grievanceId: string,
    settlementId: string,
    data: {
      description?: string | null;
      amount?: string | null;
      typeIds?: string[] | null;
    },
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


    async getById(settlementId: string): Promise<GrievanceSettlement | undefined> {
      const client = getClient();
      const [row] = await client
        .select()
        .from(grievanceSettlements)
        .where(eq(grievanceSettlements.id, settlementId));
      return row || undefined;
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
      data: {
        description?: string | null;
        amount?: string | null;
        typeIds?: string[] | null;
      },
    ): Promise<GrievanceSettlement> {
      // One transaction for the write and the snapshots its event carries.
      return runInTransaction(async () => {
        const client = getClient();
        const [row] = await client
          .insert(grievanceSettlements)
          .values({
            grievanceId,
            description: data.description ?? null,
            amount: data.amount ?? null,
            typeIds: data.typeIds ?? null,
          })
          .returning();
        await emitGrievanceSettlementSaved(grievanceId, "created", row);
        return row;
      });
    },

    async update(
      grievanceId: string,
      settlementId: string,
      data: {
        description?: string | null;
        amount?: string | null;
        typeIds?: string[] | null;
      },
    ): Promise<GrievanceSettlement | undefined> {
      return runInTransaction(async () => {
        const client = getClient();
        const set: Partial<typeof grievanceSettlements.$inferInsert> = {};
        if (data.description !== undefined) set.description = data.description ?? null;
        if (data.amount !== undefined) set.amount = data.amount ?? null;
        if (data.typeIds !== undefined) set.typeIds = data.typeIds ?? null;
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
        if (row) {
          await emitGrievanceSettlementSaved(grievanceId, "updated", row);
        }
        return row || undefined;
      });
    },

    async delete(grievanceId: string, settlementId: string): Promise<boolean> {
      return runInTransaction(async () => {
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
        const [deleted] = result;
        if (deleted) {
          await emitGrievanceSettlementSaved(grievanceId, "deleted", deleted);
        }
        return result.length > 0;
      });
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
