import { sql } from "drizzle-orm";
import { workerDispatchStatus, contacts } from "@shared/schema";
import { buildEligibleWorkersQuery, type EligibleWorkersFilters } from "../../../../server/storage/dispatch/eligible-workers";

export async function eligibleWorkersSql(jobId: string, limit: number, offset: number, filters: EligibleWorkersFilters) {
  const result = await buildEligibleWorkersQuery(jobId, filters);
  if (!result) return null;
  const compiled = result.finalQuery
    .orderBy(sql`${workerDispatchStatus.seniorityDate} ASC NULLS LAST`, contacts.displayName)
    .limit(limit).offset(offset).toSQL();
  return { sql: compiled.sql, params: compiled.params, appliedConditions: result.appliedConditions };
}
