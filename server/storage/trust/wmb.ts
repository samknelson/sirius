import { getClient } from '../transaction-context';
import { trustWmb, trustBenefits } from "@shared/schema";
import { sql, eq, and } from "drizzle-orm";

export interface ActiveBenefitWorkerCount {
  employerId: string;
  benefitId: string;
  workerCount: number;
}

export interface TrustWmbStorage {
  getActiveBenefitWorkerCountsByEmployerLatestPeriod(): Promise<ActiveBenefitWorkerCount[]>;
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
  };
}
