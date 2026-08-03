import { getClient, runInTransaction } from "../../transaction-context";
import { and, eq, inArray, ne, sql, getTableName, isNotNull } from "drizzle-orm";
import { tableExists as tableExistsUtil } from "../../utils";
import {
  sitespecificBaoWithholdingAllocations,
  wizardEmployerMonthly,
  wizards,
  ledgerEa,
  type BaoWithholdingAllocation,
  type InsertBaoWithholdingAllocation,
  type BaoWithholdingUploadSummary,
} from "@shared/schema";
import type { StorageLoggingConfig } from "../../middleware/logging";

export type { BaoWithholdingAllocation, BaoWithholdingUploadSummary };

/**
 * Thrown when an upload's withholding is already consumed by a payment and a
 * change (re-run with different amounts, added/removed workers) is attempted.
 */
export const WITHHOLDING_CONSUMED = "WITHHOLDING_CONSUMED";

/**
 * Thrown when `consume` finds at least one selected upload already consumed
 * by a different payment (double-consumption race).
 */
export const UPLOAD_ALREADY_CONSUMED = "UPLOAD_ALREADY_CONSUMED";

const alloc = sitespecificBaoWithholdingAllocations;
const tableName = getTableName(alloc);

/**
 * Serialize every mutation of an upload's allocations (wizard rerun upsert /
 * removal vs. payment consumption) on a per-wizard advisory lock, taken
 * inside the caller's transaction. Sorted acquisition avoids deadlocks when
 * a payment consumes multiple uploads. All consumed-state checks after the
 * lock therefore see the committed truth.
 */
async function lockWizards(client: ReturnType<typeof getClient>, wizardIds: string[]): Promise<void> {
  for (const id of [...new Set(wizardIds)].sort()) {
    await client.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`bao_withholding:${id}`}, 0))`,
    );
  }
}

export interface BaoWithholdingAllocationsStorage {
  tableExists(): Promise<boolean>;
  getByWizard(wizardId: string): Promise<BaoWithholdingAllocation[]>;
  getByWizards(wizardIds: string[]): Promise<BaoWithholdingAllocation[]>;
  getByConsumingPayment(paymentId: string): Promise<BaoWithholdingAllocation[]>;
  /** The payment id consuming this upload's allocations, or null when free. */
  getConsumingPaymentId(wizardId: string): Promise<string | null>;
  /**
   * Idempotently record one worker's withholding allocation for an upload.
   * No-op when an identical row already exists. Throws WITHHOLDING_CONSUMED
   * when the upload is already consumed by a payment and the row would
   * change (different amount, or a brand-new worker row).
   */
  upsert(input: InsertBaoWithholdingAllocation): Promise<BaoWithholdingAllocation>;
  /**
   * Remove a worker's allocation (e.g. withholding dropped to zero on
   * re-upload). Throws WITHHOLDING_CONSUMED when the row is consumed.
   */
  removeForWizardWorker(wizardId: string, workerId: string): Promise<void>;
  /**
   * List uploads selectable as a payment's allocation source: completed
   * BAO monthly-hours wizards for this employer whose allocations all sit on
   * worker EAs of the given ledger account. Uploads consumed by another
   * payment are excluded unless `includePaymentId` matches the consumer
   * (edit flows must still see their own selection).
   */
  listEligibleUploads(opts: {
    employerId: string;
    accountId: string;
    includePaymentId?: string;
  }): Promise<BaoWithholdingUploadSummary[]>;
  /**
   * Race-safely mark every allocation of the given uploads as consumed by
   * `paymentId`. Runs in a transaction under per-upload advisory locks with
   * a conditional UPDATE; throws UPLOAD_ALREADY_CONSUMED (rolling back) when
   * any allocation is already held by a different payment. Idempotent for
   * the same payment. Returns the consumed allocation rows as read inside
   * the locked transaction — callers must credit exactly this set so a
   * concurrent upload rewrite cannot change what the payment funds.
   */
  consume(wizardIds: string[], paymentId: string): Promise<BaoWithholdingAllocation[]>;
  /** Release every allocation held by this payment. */
  release(paymentId: string): Promise<void>;
}

export function createBaoWithholdingAllocationsStorage(): BaoWithholdingAllocationsStorage {
  return {
    async tableExists(): Promise<boolean> {
      return tableExistsUtil(tableName);
    },

    async getByWizard(wizardId: string): Promise<BaoWithholdingAllocation[]> {
      const client = getClient();
      return await client.select().from(alloc).where(eq(alloc.wizardId, wizardId));
    },

    async getByWizards(wizardIds: string[]): Promise<BaoWithholdingAllocation[]> {
      if (wizardIds.length === 0) return [];
      const client = getClient();
      return await client.select().from(alloc).where(inArray(alloc.wizardId, wizardIds));
    },

    async getByConsumingPayment(paymentId: string): Promise<BaoWithholdingAllocation[]> {
      const client = getClient();
      return await client
        .select()
        .from(alloc)
        .where(eq(alloc.consumedByPaymentId, paymentId));
    },

    async getConsumingPaymentId(wizardId: string): Promise<string | null> {
      const client = getClient();
      const rows = await client
        .select({ paymentId: alloc.consumedByPaymentId })
        .from(alloc)
        .where(and(eq(alloc.wizardId, wizardId), isNotNull(alloc.consumedByPaymentId)))
        .limit(1);
      return rows[0]?.paymentId ?? null;
    },

    async upsert(input: InsertBaoWithholdingAllocation): Promise<BaoWithholdingAllocation> {
      return runInTransaction(async () => {
        const client = getClient();
        await lockWizards(client, [input.wizardId]);
        const [existing] = await client
          .select()
          .from(alloc)
          .where(and(eq(alloc.wizardId, input.wizardId), eq(alloc.workerId, input.workerId)));

        if (existing) {
          const unchanged =
            existing.amount === input.amount &&
            existing.workerEaId === input.workerEaId &&
            existing.year === input.year &&
            existing.month === input.month;
          if (unchanged) return existing;
          if (existing.consumedByPaymentId) {
            throw new Error(WITHHOLDING_CONSUMED);
          }
          // Conditional predicate is belt-and-braces on top of the advisory
          // lock: never mutate a row a payment has funded.
          const [updated] = await client
            .update(alloc)
            .set({
              amount: input.amount,
              workerEaId: input.workerEaId,
              employerId: input.employerId,
              year: input.year,
              month: input.month,
              data: input.data ?? existing.data,
            })
            .where(and(eq(alloc.id, existing.id), sql`${alloc.consumedByPaymentId} IS NULL`))
            .returning();
          if (!updated) {
            throw new Error(WITHHOLDING_CONSUMED);
          }
          return updated;
        }

        // A brand-new worker row on an upload another payment already funded
        // would silently change the consumed total — block it.
        const [consumedSibling] = await client
          .select({ id: alloc.id })
          .from(alloc)
          .where(and(eq(alloc.wizardId, input.wizardId), isNotNull(alloc.consumedByPaymentId)))
          .limit(1);
        if (consumedSibling) {
          throw new Error(WITHHOLDING_CONSUMED);
        }

        const [created] = await client
          .insert(alloc)
          .values(input)
          .onConflictDoNothing({ target: [alloc.wizardId, alloc.workerId] })
          .returning();
        if (created) return created;
        // Lost an insert race: re-read and reconcile via the update path.
        return this.upsert(input);
      });
    },

    async removeForWizardWorker(wizardId: string, workerId: string): Promise<void> {
      await runInTransaction(async () => {
        const client = getClient();
        await lockWizards(client, [wizardId]);
        const [existing] = await client
          .select()
          .from(alloc)
          .where(and(eq(alloc.wizardId, wizardId), eq(alloc.workerId, workerId)));
        if (!existing) return;
        if (existing.consumedByPaymentId) {
          throw new Error(WITHHOLDING_CONSUMED);
        }
        const deleted = await client
          .delete(alloc)
          .where(and(eq(alloc.id, existing.id), sql`${alloc.consumedByPaymentId} IS NULL`))
          .returning({ id: alloc.id });
        if (deleted.length === 0) {
          throw new Error(WITHHOLDING_CONSUMED);
        }
      });
    },

    async listEligibleUploads(opts: {
      employerId: string;
      accountId: string;
      includePaymentId?: string;
    }): Promise<BaoWithholdingUploadSummary[]> {
      const client = getClient();
      const rows = await client
        .select({
          wizardId: alloc.wizardId,
          year: wizardEmployerMonthly.year,
          month: wizardEmployerMonthly.month,
          totalAmount: sql<string>`sum(${alloc.amount})::text`,
          allocationCount: sql<number>`count(*)::int`,
          consumedByPaymentId: sql<string | null>`max(${alloc.consumedByPaymentId})`,
          allOnAccount: sql<boolean>`bool_and(${ledgerEa.accountId} = ${opts.accountId})`,
          wizardStatus: wizards.status,
        })
        .from(alloc)
        .innerJoin(wizards, eq(wizards.id, alloc.wizardId))
        .innerJoin(wizardEmployerMonthly, eq(wizardEmployerMonthly.wizardId, alloc.wizardId))
        .innerJoin(ledgerEa, eq(ledgerEa.id, alloc.workerEaId))
        .where(eq(alloc.employerId, opts.employerId))
        .groupBy(alloc.wizardId, wizardEmployerMonthly.year, wizardEmployerMonthly.month, wizards.status);

      return rows
        .filter((r) => {
          if (!(r.wizardStatus === "complete" || r.wizardStatus === "completed")) return false;
          if (!r.allOnAccount) return false;
          if (r.consumedByPaymentId && r.consumedByPaymentId !== opts.includePaymentId) return false;
          return true;
        })
        .sort((a, b) => a.year - b.year || a.month - b.month)
        .map((r) => ({
          wizardId: r.wizardId,
          year: r.year,
          month: r.month,
          totalAmount: parseFloat(r.totalAmount).toFixed(2),
          allocationCount: r.allocationCount,
          consumedByPaymentId: r.consumedByPaymentId,
        }));
    },

    async consume(wizardIds: string[], paymentId: string): Promise<BaoWithholdingAllocation[]> {
      if (wizardIds.length === 0) return [];
      return runInTransaction(async () => {
        const client = getClient();
        await lockWizards(client, wizardIds);
        await client
          .update(alloc)
          .set({ consumedByPaymentId: paymentId })
          .where(
            and(
              inArray(alloc.wizardId, wizardIds),
              sql`(${alloc.consumedByPaymentId} IS NULL OR ${alloc.consumedByPaymentId} = ${paymentId})`,
            ),
          );
        // Any row in the selection still held by a different payment means we
        // lost the race — roll everything back.
        const [conflict] = await client
          .select({ id: alloc.id })
          .from(alloc)
          .where(
            and(
              inArray(alloc.wizardId, wizardIds),
              isNotNull(alloc.consumedByPaymentId),
              ne(alloc.consumedByPaymentId, paymentId),
            ),
          )
          .limit(1);
        if (conflict) {
          throw new Error(UPLOAD_ALREADY_CONSUMED);
        }
        // Release any upload this payment previously held but no longer selects.
        await client
          .update(alloc)
          .set({ consumedByPaymentId: null })
          .where(
            and(
              eq(alloc.consumedByPaymentId, paymentId),
              sql`${alloc.wizardId} NOT IN (${sql.join(wizardIds.map((id) => sql`${id}`), sql`, `)})`,
            ),
          );
        // The authoritative credited set, read under the same locks.
        return await client.select().from(alloc).where(inArray(alloc.wizardId, wizardIds));
      });
    },

    async release(paymentId: string): Promise<void> {
      const client = getClient();
      await client
        .update(alloc)
        .set({ consumedByPaymentId: null })
        .where(eq(alloc.consumedByPaymentId, paymentId));
    },
  };
}

export const baoWithholdingAllocationsLoggingConfig: StorageLoggingConfig<BaoWithholdingAllocationsStorage> = {
  module: "sitespecific.bao.withholding-allocations",
  methods: {
    consume: {
      enabled: true,
      getEntityId: (args) => args[1] as string,
      getDescription: (args) =>
        `Consumed withholding uploads ${(args[0] as string[]).join(", ")} for payment ${args[1]}`,
    },
    release: {
      enabled: true,
      getEntityId: (args) => args[0] as string,
      getDescription: (args) => `Released withholding uploads held by payment ${args[0]}`,
    },
  },
};
