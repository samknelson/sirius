import { createNoopValidator } from './utils/validation';
import { getClient } from './transaction-context';
import type { db } from './db';
import { workers, contacts, workerDispatchEligDenorm, dispatches, type EligibilityPluginConfig, type JobTypeData } from "@shared/schema";
import { sql, eq, and, exists, notExists, or, ilike, inArray } from "drizzle-orm";
import { logger } from "../logger";
import { 
  dispatchEligPluginRegistry, 
  type EligibilityCondition, 
  type EligibilityQueryContext 
} from "../services/dispatch-elig-plugin-registry";
import { createDispatchJobStorage } from "./dispatch-jobs";
import { createUnifiedOptionsStorage } from "./unified-options";

/**
 * Stub validator - add validation logic here when needed
 */
export const validate = createNoopValidator();

export interface EligibleWorker {
  id: string;
  siriusId: number;
  displayName: string;
}

export interface EligibleWorkersFilters {
  siriusId?: number;
  name?: string;
  excludeWithDispatches?: boolean; // Exclude workers who already have a dispatch for this job
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

export interface PluginCheckResult {
  pluginId: string;
  pluginName: string;
  passed: boolean;
  explanation: string;
  condition: EligibilityCondition | null;
}

export interface WorkerEligibilityCheckResult {
  workerId: string;
  workerName: string;
  workerSiriusId: number;
  isEligible: boolean;
  seniorityPosition: number | null;
  totalEligible: number | null;
  pluginResults: PluginCheckResult[];
}

export interface DispatchEligibleWorkersStorage {
  getEligibleWorkersForJob(jobId: string, limit?: number, offset?: number, filters?: EligibleWorkersFilters): Promise<EligibleWorkersResult>;
  getEligibleWorkersForJobSql(jobId: string, limit?: number, offset?: number, filters?: EligibleWorkersFilters): Promise<EligibleWorkersSqlResult | null>;
  checkWorkerEligibility(jobId: string, workerId: string): Promise<WorkerEligibilityCheckResult | null>;
}

type DynamicQuery = ReturnType<ReturnType<typeof db.select>["from"]>["$dynamic"] extends (...args: any) => infer R ? R : never;

interface QueryBuildResult {
  finalQuery: DynamicQuery; 
  appliedConditions: Array<{ pluginId: string; condition: EligibilityCondition }>;
}

async function buildEligibleWorkersQuery(jobId: string, filters?: EligibleWorkersFilters): Promise<QueryBuildResult | null> {
  const client = getClient();
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

  const baseQuery = client
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
        // If values array is provided, use inArray for matching any of the values
        const valueCondition = condition.values && condition.values.length > 0
          ? inArray(workerDispatchEligDenorm.value, condition.values)
          : eq(workerDispatchEligDenorm.value, condition.value);
        
        const subquery = client
          .select({ one: sql`1` })
          .from(workerDispatchEligDenorm)
          .where(and(
            eq(workerDispatchEligDenorm.workerId, workers.id),
            eq(workerDispatchEligDenorm.category, condition.category),
            valueCondition
          ));
        return [exists(subquery)];
      }
      
      case "not_exists": {
        // If values array is provided, use inArray for matching any of the values
        const valueCondition = condition.values && condition.values.length > 0
          ? inArray(workerDispatchEligDenorm.value, condition.values)
          : eq(workerDispatchEligDenorm.value, condition.value);
        
        const subquery = client
          .select({ one: sql`1` })
          .from(workerDispatchEligDenorm)
          .where(and(
            eq(workerDispatchEligDenorm.workerId, workers.id),
            eq(workerDispatchEligDenorm.category, condition.category),
            valueCondition
          ));
        return [notExists(subquery)];
      }
      
      case "exists_or_none": {
        // If values array is provided, use inArray for matching any of the values
        const valueCondition = condition.values && condition.values.length > 0
          ? inArray(workerDispatchEligDenorm.value, condition.values)
          : eq(workerDispatchEligDenorm.value, condition.value);
        
        const valueSubquery = client
          .select({ one: sql`1` })
          .from(workerDispatchEligDenorm)
          .where(and(
            eq(workerDispatchEligDenorm.workerId, workers.id),
            eq(workerDispatchEligDenorm.category, condition.category),
            valueCondition
          ));
        const categorySubquery = client
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
        const categorySubquery = client
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
          const subquery = client
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
  // Exclude workers who already have a dispatch for this job
  if (filters?.excludeWithDispatches) {
    const existingDispatchSubquery = client
      .select({ one: sql`1` })
      .from(dispatches)
      .where(and(
        eq(dispatches.workerId, workers.id),
        eq(dispatches.jobId, jobId)
      ));
    filterConditions.push(notExists(existingDispatchSubquery));
  }

  const allConditions = [...whereConditions, ...filterConditions];
  
  let finalQuery = baseQuery;
  if (allConditions.length > 0) {
    finalQuery = baseQuery.where(and(...allConditions));
  }

  return { finalQuery: finalQuery as any, appliedConditions };
}

async function checkConditionForWorker(
  client: ReturnType<typeof getClient>,
  workerId: string,
  condition: EligibilityCondition
): Promise<{ passed: boolean; explanation: string }> {
  const workerEntries = await client
    .select()
    .from(workerDispatchEligDenorm)
    .where(and(
      eq(workerDispatchEligDenorm.workerId, workerId),
      eq(workerDispatchEligDenorm.category, condition.category)
    ));

  const entryValues = workerEntries.map(e => e.value);
  
  switch (condition.type) {
    case "exists": {
      const valuesToCheck = condition.values && condition.values.length > 0 
        ? condition.values 
        : [condition.value];
      const hasMatch = valuesToCheck.some(v => entryValues.includes(v));
      if (hasMatch) {
        return { passed: true, explanation: `Has required ${condition.category} entry` };
      }
      return { 
        passed: false, 
        explanation: `Missing required ${condition.category} entry (needs: ${valuesToCheck.join(" or ")})` 
      };
    }
    
    case "not_exists": {
      const valuesToCheck = condition.values && condition.values.length > 0 
        ? condition.values 
        : [condition.value];
      const hasMatch = valuesToCheck.some(v => entryValues.includes(v));
      if (!hasMatch) {
        return { passed: true, explanation: `No blocking ${condition.category} entry found` };
      }
      const matchingValue = valuesToCheck.find(v => entryValues.includes(v));
      return { 
        passed: false, 
        explanation: `Has blocking ${condition.category} entry: ${matchingValue}` 
      };
    }
    
    case "exists_or_none": {
      if (entryValues.length === 0) {
        return { passed: true, explanation: `No ${condition.category} entries (passes by default)` };
      }
      const valuesToCheck = condition.values && condition.values.length > 0 
        ? condition.values 
        : [condition.value];
      const hasMatch = valuesToCheck.some(v => entryValues.includes(v));
      if (hasMatch) {
        return { passed: true, explanation: `Has matching ${condition.category} entry` };
      }
      return { 
        passed: false, 
        explanation: `Has ${condition.category} entries but none match required value (has: ${entryValues.join(", ")})` 
      };
    }
    
    case "not_exists_category": {
      if (entryValues.length === 0) {
        return { passed: true, explanation: `No ${condition.category} entries` };
      }
      return { 
        passed: false, 
        explanation: `Has ${condition.category} entry: ${entryValues.join(", ")}` 
      };
    }
    
    case "exists_all": {
      const requiredValues = condition.values || [];
      if (requiredValues.length === 0) {
        return { passed: true, explanation: `No ${condition.category} requirements` };
      }
      const missingValues = requiredValues.filter(v => !entryValues.includes(v));
      if (missingValues.length === 0) {
        return { passed: true, explanation: `Has all required ${condition.category} entries` };
      }
      return { 
        passed: false, 
        explanation: `Missing ${condition.category} entries: ${missingValues.join(", ")}` 
      };
    }
    
    default:
      return { passed: true, explanation: "Unknown condition type (passed by default)" };
  }
}

export function createDispatchEligibleWorkersStorage(): DispatchEligibleWorkersStorage {
  return {
    async getEligibleWorkersForJob(jobId: string, limit = 100, offset = 0, filters?: EligibleWorkersFilters): Promise<EligibleWorkersResult> {
      const client = getClient();
      const result = await buildEligibleWorkersQuery(jobId, filters);
      if (!result) {
        return { workers: [], total: 0, appliedConditions: [] };
      }

      const { finalQuery, appliedConditions } = result;

      const countResult = await client
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

    async checkWorkerEligibility(jobId: string, workerId: string): Promise<WorkerEligibilityCheckResult | null> {
      const client = getClient();
      const jobStorage = createDispatchJobStorage();
      const unifiedOptionsStorage = createUnifiedOptionsStorage();

      const job = await jobStorage.getWithRelations(jobId);
      if (!job) {
        logger.warn(`Job not found when checking worker eligibility`, {
          service: "dispatch-eligible-workers",
          jobId,
        });
        return null;
      }

      const workerResult = await client
        .select({
          id: workers.id,
          siriusId: workers.siriusId,
          displayName: contacts.displayName,
        })
        .from(workers)
        .innerJoin(contacts, eq(workers.contactId, contacts.id))
        .where(eq(workers.id, workerId))
        .limit(1);

      if (workerResult.length === 0) {
        logger.warn(`Worker not found when checking eligibility`, {
          service: "dispatch-eligible-workers",
          workerId,
        });
        return null;
      }

      const worker = workerResult[0];

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

      const pluginResults: PluginCheckResult[] = [];

      for (const pluginConfig of enabledPluginConfigs) {
        const plugin = dispatchEligPluginRegistry.getPlugin(pluginConfig.pluginId);
        if (!plugin) {
          pluginResults.push({
            pluginId: pluginConfig.pluginId,
            pluginName: pluginConfig.pluginId,
            passed: true,
            explanation: "Plugin not found (skipped)",
            condition: null,
          });
          continue;
        }

        const condition = await Promise.resolve(plugin.getEligibilityCondition(context, pluginConfig.config));
        if (!condition) {
          pluginResults.push({
            pluginId: plugin.id,
            pluginName: plugin.name,
            passed: true,
            explanation: "No condition required by this plugin",
            condition: null,
          });
          continue;
        }

        const checkResult = await checkConditionForWorker(client, workerId, condition);
        pluginResults.push({
          pluginId: plugin.id,
          pluginName: plugin.name,
          passed: checkResult.passed,
          explanation: checkResult.explanation,
          condition,
        });
      }

      const isEligible = pluginResults.every(r => r.passed);

      let seniorityPosition: number | null = null;
      let totalEligible: number | null = null;

      if (isEligible) {
        const eligResult = await this.getEligibleWorkersForJob(jobId, 10000, 0);
        totalEligible = eligResult.total;
        const position = eligResult.workers.findIndex(w => w.id === workerId);
        seniorityPosition = position >= 0 ? position + 1 : null;
      }

      logger.info(`Checked worker eligibility`, {
        service: "dispatch-eligible-workers",
        jobId,
        workerId,
        isEligible,
        pluginCount: pluginResults.length,
        failedPlugins: pluginResults.filter(r => !r.passed).map(r => r.pluginId),
      });

      return {
        workerId: worker.id,
        workerName: worker.displayName || `Worker #${worker.siriusId}`,
        workerSiriusId: worker.siriusId,
        isEligible,
        seniorityPosition,
        totalEligible,
        pluginResults,
      };
    },
  };
}
