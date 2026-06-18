import { getClient } from '../transaction-context';
import { trustWmb, trustBenefits, employers, type TrustWmb } from "@shared/schema";
import { sql, eq, and, desc } from "drizzle-orm";
import { type StorageLoggingConfig } from "../middleware/logging";
import { logger } from "../../logger";
import { eventBus, EventType } from "../../services/event-bus";

export interface ActiveBenefitWorkerCount {
  employerId: string;
  benefitId: string;
  workerCount: number;
}

export interface TrustWmbStorage {
  getActiveBenefitWorkerCountsByEmployerLatestPeriod(): Promise<ActiveBenefitWorkerCount[]>;
  getById(id: string): Promise<TrustWmb | undefined>;
  getWorkerBenefits(workerId: string): Promise<any[]>;
  createWorkerBenefit(data: { workerId: string; month: number; year: number; employerId: string; benefitId: string }): Promise<TrustWmb>;
  deleteWorkerBenefit(id: string): Promise<boolean>;
  workerBenefitExists(workerId: string, benefitId: string, month: number, year: number): Promise<boolean>;
}

export function createTrustWmbStorage(): TrustWmbStorage {
  return {
    async getActiveBenefitWorkerCountsByEmployerLatestPeriod(): Promise<ActiveBenefitWorkerCount[]> {
      const client = getClient();
      const result = await client.execute(sql`
        WITH latest_period AS (
          SELECT
            employer_id,
            benefit_id,
            MAX(year * 12 + month) AS period_key
          FROM trust_wmb
          GROUP BY employer_id, benefit_id
        )
        SELECT
          wmb.employer_id,
          wmb.benefit_id,
          COUNT(DISTINCT wmb.worker_id)::int AS worker_count
        FROM trust_wmb wmb
        INNER JOIN latest_period lp
          ON lp.employer_id = wmb.employer_id
         AND lp.benefit_id = wmb.benefit_id
         AND (wmb.year * 12 + wmb.month) = lp.period_key
        INNER JOIN trust_benefits tb ON tb.id = wmb.benefit_id
        WHERE tb.is_active = true
        GROUP BY wmb.employer_id, wmb.benefit_id
      `);

      return (result.rows as Array<{ employer_id: string; benefit_id: string; worker_count: number }>).map(row => ({
        employerId: row.employer_id,
        benefitId: row.benefit_id,
        workerCount: Number(row.worker_count) || 0,
      }));
    },

    async getById(id: string): Promise<TrustWmb | undefined> {
      const client = getClient();
      const [row] = await client
        .select()
        .from(trustWmb)
        .where(eq(trustWmb.id, id))
        .limit(1);
      return row;
    },

    async getWorkerBenefits(workerId: string): Promise<any[]> {
      const client = getClient();
      const results = await client
        .select({
          id: trustWmb.id,
          month: trustWmb.month,
          year: trustWmb.year,
          workerId: trustWmb.workerId,
          employerId: trustWmb.employerId,
          benefitId: trustWmb.benefitId,
          benefit: trustBenefits,
          employer: employers,
        })
        .from(trustWmb)
        .leftJoin(trustBenefits, eq(trustWmb.benefitId, trustBenefits.id))
        .leftJoin(employers, eq(trustWmb.employerId, employers.id))
        .where(eq(trustWmb.workerId, workerId))
        .orderBy(desc(trustWmb.year), desc(trustWmb.month));

      return results;
    },

    async createWorkerBenefit(data: { workerId: string; month: number; year: number; employerId: string; benefitId: string }): Promise<TrustWmb> {
      const client = getClient();
      const [wmb] = await client
        .insert(trustWmb)
        .values(data)
        .returning();

      if (wmb) {
        const payload = {
          wmbId: wmb.id,
          workerId: wmb.workerId,
          employerId: wmb.employerId,
          benefitId: wmb.benefitId,
          year: wmb.year,
          month: wmb.month,
        };

        // Emit WMB_SAVED. Charge plugins (and any future listeners) react to
        // this event — storage never calls charge plugins directly. Awaited so
        // charges are computed within the same transaction / async context as
        // the write, matching the previous behavior.
        try {
          await eventBus.emit(EventType.WMB_SAVED, payload);
        } catch (err) {
          logger.error("Failed to emit WMB_SAVED event", {
            service: "trust-wmb-storage",
            wmbId: wmb.id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      return wmb;
    },

    async deleteWorkerBenefit(id: string): Promise<boolean> {
      const client = getClient();
      const result = await client
        .delete(trustWmb)
        .where(eq(trustWmb.id, id))
        .returning();

      const deleted = result[0];

      if (deleted) {
        const payload = {
          wmbId: deleted.id,
          workerId: deleted.workerId,
          employerId: deleted.employerId,
          benefitId: deleted.benefitId,
          year: deleted.year,
          month: deleted.month,
          isDeleted: true,
        };

        // Emit WMB_SAVED (deletion). Charge plugins react via the event bus.
        try {
          await eventBus.emit(EventType.WMB_SAVED, payload);
        } catch (err) {
          logger.error("Failed to emit WMB_SAVED event", {
            service: "trust-wmb-storage",
            wmbId: deleted.id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      return result.length > 0;
    },

    async workerBenefitExists(workerId: string, benefitId: string, month: number, year: number): Promise<boolean> {
      const client = getClient();
      const result = await client
        .select({ id: trustWmb.id })
        .from(trustWmb)
        .where(
          and(
            eq(trustWmb.workerId, workerId),
            eq(trustWmb.benefitId, benefitId),
            eq(trustWmb.month, month),
            eq(trustWmb.year, year)
          )
        )
        .limit(1);
      return result.length > 0;
    },
  };
}

/**
 * Logging configuration for trust WMB storage operations.
 *
 * Create/delete are audited and attributed to the worker (the worker is the
 * host entity of the audit entry). Reads (getById, getWorkerBenefits,
 * workerBenefitExists, the aggregate query) are not logged. Delete returns a
 * boolean, so the worker id is resolved via a `before` hook that fetches the
 * row prior to deletion.
 */
export const trustWmbLoggingConfig: StorageLoggingConfig<TrustWmbStorage> = {
  module: 'trust.wmb',
  methods: {
    createWorkerBenefit: {
      enabled: true,
      getEntityId: (args, result) => result?.id,
      getHostEntityId: (args, result) => result?.workerId,
      getDescription: () => 'Created worker benefit',
    },
    deleteWorkerBenefit: {
      enabled: true,
      getEntityId: (args) => args[0],
      getHostEntityId: (args, result, beforeState) => beforeState?.workerId,
      getDescription: () => 'Deleted worker benefit',
      before: async (args, storage) => storage.getById(args[0]),
    },
  },
};
