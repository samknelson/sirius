import { and, eq, isNull, or, sql } from "drizzle-orm";
import {
  trustWmb,
  workerBenefitRoleHistoryDenorm,
  workerRelations,
  type WorkerBenefitRoleHistoryDenorm,
} from "@shared/schema";
import { getClient } from "../transaction-context";
import { tableExists } from "../utils";

export interface WorkerBenefitRoleHistoryPayload {
  subscriber: boolean;
  dependent: boolean;
  subscriberMonth: number | null;
  subscriberYear: number | null;
  dependentMonth: number | null;
  dependentYear: number | null;
}

function periodToDate(period: number | string | null): { month: number; year: number } | null {
  if (period === null) return null;
  const value = Number(period);
  if (!Number.isInteger(value)) {
    throw new Error(`Invalid WMB coverage period aggregate: ${period}`);
  }
  const year = Math.floor((value - 1) / 12);
  return { year, month: value - year * 12 };
}

/**
 * Payload storage for the worker-benefit-role-history denorm plugin.  The
 * plugin is its sole writer; this storage intentionally exposes no staff CRUD
 * surface.
 */
export interface WorkerBenefitRoleHistoryStorage {
  computeForWorker(workerId: string): Promise<WorkerBenefitRoleHistoryPayload>;
  replaceForWorker(
    workerId: string,
    denormId: string,
    payload: WorkerBenefitRoleHistoryPayload,
  ): Promise<WorkerBenefitRoleHistoryDenorm>;
}

export function createWorkerBenefitRoleHistoryStorage(): WorkerBenefitRoleHistoryStorage {
  return {
    async computeForWorker(workerId: string): Promise<WorkerBenefitRoleHistoryPayload> {
      const client = getClient();
      const period = sql<number | null>`min(${trustWmb.year} * 12 + ${trustWmb.month})`;
      let ownEarliest: number | null = null;
      let dependentEarliest: number | null = null;
      let grantedEarliest: number | null = null;

      // The optional relationship component may be absent.  In that deployment
      // no retained relation can support either dependent or grantor evidence.
      if (await tableExists("worker_relations")) {
        // One aggregate query, rather than materializing every retained WMB
        // three times, keeps a bounded drain viable for corrective scans. The
        // two indexes added with the generation migration support the worker
        // and granting-relation branches of this predicate.
        const [row] = await client
          .select({
            ownEarliest: sql<number | null>`min(case when ${trustWmb.workerId} = ${workerId}
              and ${trustWmb.sourceRelationId} is null then ${trustWmb.year} * 12 + ${trustWmb.month} end)`,
            dependentEarliest: sql<number | null>`min(case when ${trustWmb.workerId} = ${workerId}
              and ${trustWmb.sourceRelationId} is not null then ${trustWmb.year} * 12 + ${trustWmb.month} end)`,
            grantedEarliest: sql<number | null>`min(case when ${workerRelations.worker1} = ${workerId}
              then ${trustWmb.year} * 12 + ${trustWmb.month} end)`,
          })
          .from(trustWmb)
          .leftJoin(workerRelations, eq(workerRelations.id, trustWmb.sourceRelationId))
          .where(or(eq(trustWmb.workerId, workerId), eq(workerRelations.worker1, workerId)));
        ownEarliest = row?.ownEarliest ?? null;
        dependentEarliest = row?.dependentEarliest ?? null;
        grantedEarliest = row?.grantedEarliest ?? null;
      } else {
        const [row] = await client
          .select({ ownEarliest: period })
          .from(trustWmb)
          .where(and(eq(trustWmb.workerId, workerId), isNull(trustWmb.sourceRelationId)));
        ownEarliest = row?.ownEarliest ?? null;
      }

      const ownDate = periodToDate(ownEarliest);
      const grantedDate = periodToDate(grantedEarliest);
      const dependentDate = periodToDate(dependentEarliest);
      const subscriberDate =
        !ownDate ? grantedDate :
        !grantedDate ? ownDate :
        ownDate.year * 12 + ownDate.month <= grantedDate.year * 12 + grantedDate.month
          ? ownDate
          : grantedDate;

      return {
        subscriber: subscriberDate !== null,
        dependent: dependentDate !== null,
        subscriberMonth: subscriberDate?.month ?? null,
        subscriberYear: subscriberDate?.year ?? null,
        dependentMonth: dependentDate?.month ?? null,
        dependentYear: dependentDate?.year ?? null,
      };
    },

    async replaceForWorker(
      workerId: string,
      denormId: string,
      payload: WorkerBenefitRoleHistoryPayload,
    ): Promise<WorkerBenefitRoleHistoryDenorm> {
      const client = getClient();
      const [row] = await client
        .insert(workerBenefitRoleHistoryDenorm)
        .values({ workerId, denormId, ...payload })
        .onConflictDoUpdate({
          target: workerBenefitRoleHistoryDenorm.workerId,
          set: { denormId, ...payload },
        })
        .returning();
      return row;
    },
  };
}