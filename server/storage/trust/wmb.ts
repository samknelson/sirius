import { getClient, runInTransaction } from '../transaction-context';
import {
  trustWmb,
  trustBenefits,
  employers,
  optionsTrustBenefitType,
  workerRelations,
  type TrustWmb,
} from "@shared/schema";
import { sql, eq, and, desc, inArray, or, isNull, asc } from "drizzle-orm";
import { tableExists as tableExistsUtil } from "../utils";
import {
  enqueueWorkerBenefitRoleHistoryInvalidations,
} from "./worker-benefit-role-history-invalidation";
import { type StorageLoggingConfig } from "../middleware/logging";
import { logger } from "../../logger";
import { eventBus, EventType } from "../../services/event-bus";
import { getRequestContext } from "../../middleware/request-context";

export interface ActiveBenefitWorkerCount {
  employerId: string;
  benefitId: string;
  workerCount: number;
}

/**
 * One distinct (benefit, year, month) presence row for a worker, joined with
 * the benefit's name and its benefit-type metadata (color/icon/sequence). Used
 * to compute the "Current benefits" summary (most-recent-month set, active-since
 * streaks, ordering) in the service layer.
 */
export interface WorkerBenefitPresenceRow {
  benefitId: string;
  year: number;
  month: number;
  /** Set when the month's coverage came through a relationship (dependent coverage). */
  sourceRelationId: string | null;
  benefitName: string | null;
  benefitTypeId: string | null;
  benefitTypeName: string | null;
  benefitTypeSequence: number | null;
  benefitTypeColor: string | null;
  benefitTypeIcon: string | null;
}

export interface WorkerBenefitPresenceForMonthRow extends WorkerBenefitPresenceRow {
  workerId: string;
}

/** One (benefit, year, month) → distinct-worker coverage count. */
export interface BenefitMonthWorkerCount {
  benefitId: string;
  year: number;
  month: number;
  workerCount: number;
}

/**
 * The live WMB rows that make up a subscriber's premium coverage for one
 * (benefit, month): the subscriber's own row (source_relation_id NULL), if
 * present, plus every dependent row whose source relation points back at the
 * subscriber (worker_relations.worker_1 = subscriber). Used by the BAO
 * premium charge plugin to derive the billed coverage tier from actual
 * coverage rows instead of the trust election.
 */
export interface WmbPremiumCoverage {
  /** The subscriber's own WMB row id, or null when they have none. */
  ownWmbId: string | null;
  /** Dependent WMB row ids sourced from the subscriber's relations, id-ordered. */
  dependentWmbIds: string[];
  /** Employer from the own row, else the first dependent row, else null. */
  employerId: string | null;
}

/**
 * Live coverage that grants one subscriber's flat BAO employee contribution
 * for a benefit/month.  A subscriber row is not required: relation-sourced
 * dependent rows grant the same subscriber one flat contribution.
 */
export interface WmbEeContributionCoverage {
  subscriberWorkerId: string;
  benefitId: string;
  month: number;
  year: number;
  /** Every live WMB row making this contribution applicable. */
  wmbIds: string[];
  /**
   * Employers recorded by the granting coverage rows.  The charge plugin
   * resolves each through historical policy assignment and treats conflicting
   * policy results as an explicit diagnostic rather than guessing.
   */
  employerIds: string[];
}

export interface TrustWmbStorage {
  getActiveBenefitWorkerCountsByEmployerLatestPeriod(): Promise<ActiveBenefitWorkerCount[]>;
  /**
   * Distinct-worker coverage counts per (benefit, year, month), restricted to
   * the given benefits and months. Months absent from `trust_wmb` simply
   * produce no row (callers should default missing cells to 0). Used by the
   * Benefit Summary dashboard widget.
   */
  countWorkersByBenefitForMonths(
    benefitIds: string[],
    months: Array<{ month: number; year: number }>,
  ): Promise<BenefitMonthWorkerCount[]>;
  getById(id: string): Promise<TrustWmb | undefined>;
  getWorkerBenefits(workerId: string): Promise<any[]>;
  getWorkerBenefitPresence(workerId: string): Promise<WorkerBenefitPresenceRow[]>;
  getWorkersBenefitPresenceForMonth(
    workerIds: string[],
    year: number,
    month: number,
  ): Promise<WorkerBenefitPresenceForMonthRow[]>;
  createWorkerBenefit(data: { workerId: string; month: number; year: number; employerId: string; benefitId: string; sourceRelationId?: string | null }): Promise<TrustWmb>;
  deleteWorkerBenefit(id: string): Promise<boolean>;
  /**
   * Persist one coalesced role-history invalidation marker per affected worker.
   * Public only for the scan transaction boundary; never writes payload rows.
   */
  enqueueBenefitRoleHistoryInvalidations(workerIds: string[]): Promise<void>;
  /**
   * Resolve the subscriber's premium coverage rows for one (benefit, month).
   * Tolerates the optional worker.relations component being absent (no
   * worker_relations table => dependent rows can't exist, own row only).
   */
  getPremiumCoverage(
    subscriberWorkerId: string,
    benefitId: string,
    month: number,
    year: number,
  ): Promise<WmbPremiumCoverage>;
  /** Live granting coverage for one subscriber/benefit/month. */
  getEeContributionCoverage(
    subscriberWorkerId: string,
    benefitId: string,
    month: number,
    year: number,
  ): Promise<WmbEeContributionCoverage | null>;
  /**
   * Every currently live contribution subject.  Historical entries are
   * deliberately discovered separately from the ledger, so source-row
   * deletion cannot make an already-posted charge undiscoverable.
   */
  listEeContributionCoverage(): Promise<WmbEeContributionCoverage[]>;
  workerBenefitExists(workerId: string, benefitId: string, month: number, year: number): Promise<boolean>;
}

export function createTrustWmbStorage(): TrustWmbStorage {
  async function persistRoleHistoryInvalidations(workerIds: string[]): Promise<void> {
    await enqueueWorkerBenefitRoleHistoryInvalidations(workerIds);
  }

  async function affectedRoleHistoryWorkers(workerId: string, sourceRelationId?: string | null): Promise<string[]> {
    const ids = new Set([workerId]);
    if (!sourceRelationId || !(await tableExistsUtil("worker_relations"))) return [...ids];
    const context = getRequestContext();
    let grantor = context?.wmbBenefitRoleHistoryGrantors?.get(sourceRelationId);
    if (grantor === undefined) {
      const client = getClient();
      const [relation] = await client
        .select({ worker1: workerRelations.worker1 })
        .from(workerRelations)
        .where(eq(workerRelations.id, sourceRelationId))
        .limit(1);
      grantor = relation?.worker1 ?? null;
      context?.wmbBenefitRoleHistoryGrantors?.set(sourceRelationId, grantor);
    }
    if (grantor) ids.add(grantor);
    return [...ids];
  }

  async function enqueueRoleHistoryForWmb(workerId: string, sourceRelationId?: string | null): Promise<void> {
    const affected = await affectedRoleHistoryWorkers(workerId, sourceRelationId);
    const collector = getRequestContext()?.wmbBenefitRoleHistoryWorkerIds;
    if (collector) {
      affected.forEach((id) => collector.add(id));
      return;
    }
    await persistRoleHistoryInvalidations(affected);
  }

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

    async countWorkersByBenefitForMonths(
      benefitIds: string[],
      months: Array<{ month: number; year: number }>,
    ): Promise<BenefitMonthWorkerCount[]> {
      if (benefitIds.length === 0 || months.length === 0) return [];
      const client = getClient();
      const monthConditions = months.map((m) =>
        and(eq(trustWmb.month, m.month), eq(trustWmb.year, m.year)),
      );
      const rows = await client
        .select({
          benefitId: trustWmb.benefitId,
          year: trustWmb.year,
          month: trustWmb.month,
          workerCount: sql<number>`count(distinct ${trustWmb.workerId})::int`,
        })
        .from(trustWmb)
        .where(and(inArray(trustWmb.benefitId, benefitIds), or(...monthConditions)))
        .groupBy(trustWmb.benefitId, trustWmb.year, trustWmb.month);
      return rows.map((r) => ({
        benefitId: r.benefitId,
        year: r.year,
        month: r.month,
        workerCount: Number(r.workerCount) || 0,
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
          sourceRelationId: trustWmb.sourceRelationId,
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

    async getWorkerBenefitPresence(workerId: string): Promise<WorkerBenefitPresenceRow[]> {
      const client = getClient();
      const results = await client
        .selectDistinct({
          benefitId: trustWmb.benefitId,
          year: trustWmb.year,
          month: trustWmb.month,
          sourceRelationId: trustWmb.sourceRelationId,
          benefitName: trustBenefits.name,
          benefitTypeId: optionsTrustBenefitType.id,
          benefitTypeName: optionsTrustBenefitType.name,
          benefitTypeSequence: optionsTrustBenefitType.sequence,
          benefitTypeData: optionsTrustBenefitType.data,
        })
        .from(trustWmb)
        .leftJoin(trustBenefits, eq(trustWmb.benefitId, trustBenefits.id))
        .leftJoin(optionsTrustBenefitType, eq(trustBenefits.benefitType, optionsTrustBenefitType.id))
        .where(eq(trustWmb.workerId, workerId));

      return results.map((r) => ({
        benefitId: r.benefitId,
        year: r.year,
        month: r.month,
        sourceRelationId: r.sourceRelationId ?? null,
        benefitName: r.benefitName ?? null,
        benefitTypeId: r.benefitTypeId ?? null,
        benefitTypeName: r.benefitTypeName ?? null,
        benefitTypeSequence: r.benefitTypeSequence ?? null,
        benefitTypeColor: (r.benefitTypeData as any)?.color ?? null,
        benefitTypeIcon: (r.benefitTypeData as any)?.icon ?? null,
      }));
    },

    async getWorkersBenefitPresenceForMonth(
      workerIds: string[],
      year: number,
      month: number,
    ): Promise<WorkerBenefitPresenceForMonthRow[]> {
      const uniqueWorkerIds = Array.from(new Set(workerIds));
      if (uniqueWorkerIds.length === 0) return [];
      const client = getClient();
      const results: Array<{
        workerId: string;
        benefitId: string;
        year: number;
        month: number;
        sourceRelationId: string | null;
        benefitName: string | null;
        benefitTypeId: string | null;
        benefitTypeName: string | null;
        benefitTypeSequence: number | null;
        benefitTypeData: unknown;
      }> = [];
      for (let offset = 0; offset < uniqueWorkerIds.length; offset += 500) {
        const workerIdChunk = uniqueWorkerIds.slice(offset, offset + 500);
        const rows = await client
          .selectDistinct({
            workerId: trustWmb.workerId,
            benefitId: trustWmb.benefitId,
            year: trustWmb.year,
            month: trustWmb.month,
            sourceRelationId: trustWmb.sourceRelationId,
            benefitName: trustBenefits.name,
            benefitTypeId: optionsTrustBenefitType.id,
            benefitTypeName: optionsTrustBenefitType.name,
            benefitTypeSequence: optionsTrustBenefitType.sequence,
            benefitTypeData: optionsTrustBenefitType.data,
          })
          .from(trustWmb)
          .leftJoin(trustBenefits, eq(trustWmb.benefitId, trustBenefits.id))
          .leftJoin(optionsTrustBenefitType, eq(trustBenefits.benefitType, optionsTrustBenefitType.id))
          .where(
            and(
              inArray(trustWmb.workerId, workerIdChunk),
              eq(trustWmb.year, year),
              eq(trustWmb.month, month),
            ),
          );
        results.push(...rows);
      }

      return results.map((r) => ({
        workerId: r.workerId,
        benefitId: r.benefitId,
        year: r.year,
        month: r.month,
        sourceRelationId: r.sourceRelationId ?? null,
        benefitName: r.benefitName ?? null,
        benefitTypeId: r.benefitTypeId ?? null,
        benefitTypeName: r.benefitTypeName ?? null,
        benefitTypeSequence: r.benefitTypeSequence ?? null,
        benefitTypeColor: (r.benefitTypeData as any)?.color ?? null,
        benefitTypeIcon: (r.benefitTypeData as any)?.icon ?? null,
      }));
    },

    async createWorkerBenefit(data: { workerId: string; month: number; year: number; employerId: string; benefitId: string; sourceRelationId?: string | null }): Promise<TrustWmb> {
      return runInTransaction(async () => {
        const client = getClient();
        const [wmb] = await client
          .insert(trustWmb)
          .values(data)
          .returning();

        if (wmb) {
          // This is deliberately before the event: marker + WMB have the same
          // commit boundary, while the event remains for existing listeners.
          await enqueueRoleHistoryForWmb(wmb.workerId, wmb.sourceRelationId);
        const payload = {
          wmbId: wmb.id,
          workerId: wmb.workerId,
          employerId: wmb.employerId,
          benefitId: wmb.benefitId,
          year: wmb.year,
          month: wmb.month,
          sourceRelationId: wmb.sourceRelationId ?? null,
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
      });
    },

    async deleteWorkerBenefit(id: string): Promise<boolean> {
      return runInTransaction(async () => {
        const client = getClient();
        const result = await client
          .delete(trustWmb)
          .where(eq(trustWmb.id, id))
          .returning();

      const deleted = result[0];

        if (deleted) {
          await enqueueRoleHistoryForWmb(deleted.workerId, deleted.sourceRelationId);
        const payload = {
          wmbId: deleted.id,
          workerId: deleted.workerId,
          employerId: deleted.employerId,
          benefitId: deleted.benefitId,
          year: deleted.year,
          month: deleted.month,
          sourceRelationId: deleted.sourceRelationId ?? null,
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
      });
    },

    async enqueueBenefitRoleHistoryInvalidations(workerIds: string[]): Promise<void> {
      await persistRoleHistoryInvalidations(workerIds);
    },

    async getPremiumCoverage(
      subscriberWorkerId: string,
      benefitId: string,
      month: number,
      year: number,
    ): Promise<WmbPremiumCoverage> {
      const client = getClient();

      const ownRows = await client
        .select({ id: trustWmb.id, employerId: trustWmb.employerId })
        .from(trustWmb)
        .where(
          and(
            eq(trustWmb.workerId, subscriberWorkerId),
            eq(trustWmb.benefitId, benefitId),
            eq(trustWmb.month, month),
            eq(trustWmb.year, year),
            isNull(trustWmb.sourceRelationId),
          ),
        )
        .limit(1);
      const own = ownRows[0];

      let dependents: Array<{ id: string; employerId: string }> = [];
      if (await tableExistsUtil("worker_relations")) {
        dependents = await client
          .select({ id: trustWmb.id, employerId: trustWmb.employerId })
          .from(trustWmb)
          .innerJoin(workerRelations, eq(workerRelations.id, trustWmb.sourceRelationId))
          .where(
            and(
              eq(workerRelations.worker1, subscriberWorkerId),
              eq(trustWmb.benefitId, benefitId),
              eq(trustWmb.month, month),
              eq(trustWmb.year, year),
            ),
          )
          .orderBy(asc(trustWmb.id));
      }

      return {
        ownWmbId: own?.id ?? null,
        dependentWmbIds: dependents.map((d) => d.id),
        employerId: own?.employerId ?? dependents[0]?.employerId ?? null,
      };
    },

    async getEeContributionCoverage(
      subscriberWorkerId: string,
      benefitId: string,
      month: number,
      year: number,
    ): Promise<WmbEeContributionCoverage | null> {
      const client = getClient();
      const own = await client
        .select({ id: trustWmb.id, employerId: trustWmb.employerId })
        .from(trustWmb)
        .where(
          and(
            eq(trustWmb.workerId, subscriberWorkerId),
            eq(trustWmb.benefitId, benefitId),
            eq(trustWmb.month, month),
            eq(trustWmb.year, year),
            isNull(trustWmb.sourceRelationId),
          ),
        )
        .orderBy(asc(trustWmb.id));

      let dependent: Array<{ id: string; employerId: string }> = [];
      if (await tableExistsUtil("worker_relations")) {
        dependent = await client
          .select({ id: trustWmb.id, employerId: trustWmb.employerId })
          .from(trustWmb)
          .innerJoin(
            workerRelations,
            eq(workerRelations.id, trustWmb.sourceRelationId),
          )
          .where(
            and(
              eq(workerRelations.worker1, subscriberWorkerId),
              eq(trustWmb.benefitId, benefitId),
              eq(trustWmb.month, month),
              eq(trustWmb.year, year),
            ),
          )
          .orderBy(asc(trustWmb.id));
      }

      const rows = [...own, ...dependent];
      if (rows.length === 0) return null;
      return {
        subscriberWorkerId,
        benefitId,
        month,
        year,
        wmbIds: rows.map((row) => row.id),
        employerIds: Array.from(new Set(rows.map((row) => row.employerId))).sort(),
      };
    },

    async listEeContributionCoverage(): Promise<WmbEeContributionCoverage[]> {
      const client = getClient();
      const own = await client
        .select({
          subscriberWorkerId: trustWmb.workerId,
          benefitId: trustWmb.benefitId,
          month: trustWmb.month,
          year: trustWmb.year,
          id: trustWmb.id,
          employerId: trustWmb.employerId,
        })
        .from(trustWmb)
        .where(isNull(trustWmb.sourceRelationId));

      const dependent = (await tableExistsUtil("worker_relations"))
        ? await client
            .select({
              subscriberWorkerId: workerRelations.worker1,
              benefitId: trustWmb.benefitId,
              month: trustWmb.month,
              year: trustWmb.year,
              id: trustWmb.id,
              employerId: trustWmb.employerId,
            })
            .from(trustWmb)
            .innerJoin(
              workerRelations,
              eq(workerRelations.id, trustWmb.sourceRelationId),
            )
        : [];

      const groups = new Map<string, WmbEeContributionCoverage>();
      for (const row of [...own, ...dependent]) {
        const key = `${row.subscriberWorkerId}:${row.benefitId}:${row.year}:${row.month}`;
        const current = groups.get(key);
        if (current) {
          current.wmbIds.push(row.id);
          if (!current.employerIds.includes(row.employerId)) {
            current.employerIds.push(row.employerId);
          }
          continue;
        }
        groups.set(key, {
          subscriberWorkerId: row.subscriberWorkerId,
          benefitId: row.benefitId,
          month: row.month,
          year: row.year,
          wmbIds: [row.id],
          employerIds: [row.employerId],
        });
      }
      return Array.from(groups.values()).map((group) => ({
        ...group,
        wmbIds: group.wmbIds.sort(),
        employerIds: group.employerIds.sort(),
      }));
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
  table: 'trust_wmb',
  hostTable: 'workers',
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
