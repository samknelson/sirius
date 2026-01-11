import { db } from "../db";
import { workers, contacts, workerDispatchEligDenorm, type EligibilityPluginConfig, type JobTypeData } from "@shared/schema";
import { sql, eq, and, exists, notExists, or, ilike } from "drizzle-orm";
import { logger } from "../logger";
import { 
  dispatchEligPluginRegistry, 
  type EligibilityCondition, 
  type EligibilityQueryContext 
} from "../services/dispatch-elig-plugin-registry";
import { createDispatchJobStorage } from "./dispatch-jobs";
import { createUnifiedOptionsStorage } from "./unified-options";

export interface EligibleWorker {
  id: string;
  siriusId: number;
  displayName: string;
}

export interface EligibleWorkersFilters {
  siriusId?: number;
  name?: string;
}

export interface EligibleWorkersResult {
  workers: EligibleWorker[];
  total: number;
  appliedConditions: Array<{
    pluginId: string;
    condition: EligibilityCondition;
  }>;
}

export interface EligibleWorkersSqlResult {
  sql: string;
  params: unknown[];
  appliedConditions: Array<{
    pluginId: string;
    condition: EligibilityCondition;
  }>;
}

export interface DispatchEligibleWorkersStorage {
  getEligibleWorkersForJob(jobId: string, limit?: number, offset?: number, filters?: EligibleWorkersFilters): Promise<EligibleWorkersResult>;
  getEligibleWorkersForJobSql(jobId: string, limit?: number, offset?: number, filters?: EligibleWorkersFilters): Promise<EligibleWorkersSqlResult | null>;
}

type DynamicQuery = ReturnType<ReturnType<typeof db.select>["from"]>["$dynamic"] extends (...args: any) => infer R ? R : never;

interface QueryBuildResult {
  finalQuery: DynamicQuery; 
  appliedConditions: Array<{ pluginId: string; condition: EligibilityCondition }>;
}

async function buildEligibleWorkersQuery(jobId: string, filters?: EligibleWorkersFilters): Promise<QueryBuildResult | null> {
  const jobStorage = createDispatchJobStorage();
  const unifiedOptionsStorage = createUnifiedOptionsStorage();

  const job = await jobStorage.getWithRelations(jobId);
  if (!job) {
    logger.warn(`Job not found when querying eligible workers`, {
      service: "dispatch-eligible-workers",
      jobId,
    });
    return null;
  }

  const context: EligibilityQueryContext = {
    jobId: job.id,
    employerId: job.employerId,
    jobTypeId: job.jobTypeId,
  };

  let enabledPluginConfigs: EligibilityPluginConfig[] = [];
  
  if (job.jobTypeId) {
    const jobType = await unifiedOptionsStorage.get("dispatch-job-type", job.jobTypeId);
    if (jobType?.data) {
      const jobTypeData = jobType.data as JobTypeData;
      enabledPluginConfigs = (jobTypeData.eligibility || []).filter((p: EligibilityPluginConfig) => p.enabled);
    }
  }

  const appliedConditions: Array<{ pluginId: string; condition: EligibilityCondition }> = [];

  for (const pluginConfig of enabledPluginConfigs) {
    const plugin = dispatchEligPluginRegistry.getPlugin(pluginConfig.pluginId);
    if (!plugin) {
      logger.warn(`Plugin not found: ${pluginConfig.pluginId}`, {
        service: "dispatch-eligible-workers",
        jobId,
        pluginId: pluginConfig.pluginId,
      });
      continue;
    }

    const condition = await Promise.resolve(plugin.getEligibilityCondition(context, pluginConfig.config));
    if (condition) {
      appliedConditions.push({ pluginId: pluginConfig.pluginId, condition });
    }
  }

  logger.debug(`Building eligible workers query`, {
    service: "dispatch-eligible-workers",
    jobId,
    conditionCount: appliedConditions.length,
    conditions: appliedConditions.map(c => ({ 
      pluginId: c.pluginId, 
      type: c.condition.type, 
      category: c.condition.category 
    })),
  });

  const baseQuery = db
    .select({
      id: workers.id,
      siriusId: workers.siriusId,
      displayName: contacts.displayName,
    })
    .from(workers)
    .innerJoin(contacts, eq(workers.contactId, contacts.id))
    .$dynamic();

  const whereConditions = appliedConditions.flatMap(({ condition }) => {
    switch (condition.type) {
      case "exists": {
        const subquery = db
          .select({ one: sql`1` })
          .from(workerDispatchEligDenorm)
          .where(and(
            eq(workerDispatchEligDenorm.workerId, workers.id),
            eq(workerDispatchEligDenorm.category, condition.category),
            eq(workerDispatchEligDenorm.value, condition.value)
          ));
        return [exists(subquery)];
      }
      
      case "not_exists": {
        const subquery = db
          .select({ one: sql`1` })
          .from(workerDispatchEligDenorm)
          .where(and(
            eq(workerDispatchEligDenorm.workerId, workers.id),
            eq(workerDispatchEligDenorm.category, condition.category),
            eq(workerDispatchEligDenorm.value, condition.value)
          ));
        return [notExists(subquery)];
      }
      
      case "exists_or_none": {
        const valueSubquery = db
          .select({ one: sql`1` })
          .from(workerDispatchEligDenorm)
          .where(and(
            eq(workerDispatchEligDenorm.workerId, workers.id),
            eq(workerDispatchEligDenorm.category, condition.category),
            eq(workerDispatchEligDenorm.value, condition.value)
          ));
        const categorySubquery = db
          .select({ one: sql`1` })
          .from(workerDispatchEligDenorm)
          .where(and(
            eq(workerDispatchEligDenorm.workerId, workers.id),
            eq(workerDispatchEligDenorm.category, condition.category)
          ));
        return [or(
          exists(valueSubquery),
          notExists(categorySubquery)
        )];
      }
      
      case "not_exists_category": {
        const categorySubquery = db
          .select({ one: sql`1` })
          .from(workerDispatchEligDenorm)
          .where(and(
            eq(workerDispatchEligDenorm.workerId, workers.id),
            eq(workerDispatchEligDenorm.category, condition.category)
          ));
        return [notExists(categorySubquery)];
      }
      
      case "exists_all": {
        const valuesToCheck = condition.values || [];
        if (valuesToCheck.length === 0) {
          return [];
        }
        return valuesToCheck.map(value => {
          const subquery = db
            .select({ one: sql`1` })
            .from(workerDispatchEligDenorm)
            .where(and(
              eq(workerDispatchEligDenorm.workerId, workers.id),
              eq(workerDispatchEligDenorm.category, condition.category),
              eq(workerDispatchEligDenorm.value, value)
            ));
          return exists(subquery);
        });
      }
      
      default:
        logger.warn(`Unknown condition type: ${(condition as EligibilityCondition).type}`, {
          service: "dispatch-eligible-workers",
        });
        return [sql`true`];
    }
  });

  const filterConditions: any[] = [];
  if (filters?.siriusId !== undefined) {
    filterConditions.push(eq(workers.siriusId, filters.siriusId));
  }
  if (filters?.name) {
    filterConditions.push(ilike(contacts.displayName, `%${filters.name}%`));
  }

  const allConditions = [...whereConditions, ...filterConditions];
  
  let finalQuery = baseQuery;
  if (allConditions.length > 0) {
    finalQuery = baseQuery.where(and(...allConditions));
  }

  return { finalQuery: finalQuery as any, appliedConditions };
}

export function createDispatchEligibleWorkersStorage(): DispatchEligibleWorkersStorage {
  return {
    async getEligibleWorkersForJob(jobId: string, limit = 100, offset = 0, filters?: EligibleWorkersFilters): Promise<EligibleWorkersResult> {
      const result = await buildEligibleWorkersQuery(jobId, filters);
      if (!result) {
        return { workers: [], total: 0, appliedConditions: [] };
      }

      const { finalQuery, appliedConditions } = result;

      const countResult = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(
          finalQuery.as("eligible_workers")
        );
      
      const total = countResult[0]?.count || 0;

      const eligibleWorkers = await finalQuery
        .orderBy(contacts.displayName)
        .limit(limit)
        .offset(offset) as unknown as EligibleWorker[];

      logger.info(`Found ${eligibleWorkers.length} eligible workers for job`, {
        service: "dispatch-eligible-workers",
        jobId,
        total,
        limit,
        offset,
        appliedConditionCount: appliedConditions.length,
      });

      return {
        workers: eligibleWorkers,
        total,
        appliedConditions,
      };
    },

    async getEligibleWorkersForJobSql(jobId: string, limit = 100, offset = 0, filters?: EligibleWorkersFilters): Promise<EligibleWorkersSqlResult | null> {
      const result = await buildEligibleWorkersQuery(jobId, filters);
      if (!result) {
        return null;
      }

      const { finalQuery, appliedConditions } = result;

      const paginatedQuery = finalQuery
        .orderBy(contacts.displayName)
        .limit(limit)
        .offset(offset);

      const sqlResult = paginatedQuery.toSQL();

      return {
        sql: sqlResult.sql,
        params: sqlResult.params,
        appliedConditions,
      };
    },
  };
}
