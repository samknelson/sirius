import { db } from "../db";
import { workers, contacts, workerDispatchEligDenorm, type EligibilityPluginConfig, type JobTypeData } from "@shared/schema";
import { sql, eq, and, exists, notExists, or } from "drizzle-orm";
import { logger } from "../logger";
import { 
  dispatchEligPluginRegistry, 
  type EligibilityCondition, 
  type EligibilityQueryContext 
} from "../services/dispatch-elig-plugin-registry";
import { createDispatchJobStorage } from "./dispatch-jobs";
import { createOptionsStorage } from "./options";

export interface EligibleWorker {
  id: string;
  siriusId: number;
  displayName: string;
}

export interface EligibleWorkersResult {
  workers: EligibleWorker[];
  total: number;
  appliedConditions: Array<{
    pluginId: string;
    condition: EligibilityCondition;
  }>;
}

export interface DispatchEligibleWorkersStorage {
  getEligibleWorkersForJob(jobId: string, limit?: number, offset?: number): Promise<EligibleWorkersResult>;
}

export function createDispatchEligibleWorkersStorage(): DispatchEligibleWorkersStorage {
  return {
    async getEligibleWorkersForJob(jobId: string, limit = 100, offset = 0): Promise<EligibleWorkersResult> {
      const jobStorage = createDispatchJobStorage();
      const optionsStorage = createOptionsStorage();

      const job = await jobStorage.getWithRelations(jobId);
      if (!job) {
        logger.warn(`Job not found when querying eligible workers`, {
          service: "dispatch-eligible-workers",
          jobId,
        });
        return { workers: [], total: 0, appliedConditions: [] };
      }

      const context: EligibilityQueryContext = {
        jobId: job.id,
        employerId: job.employerId,
        jobTypeId: job.jobTypeId,
      };

      let enabledPluginConfigs: EligibilityPluginConfig[] = [];
      
      if (job.jobTypeId) {
        const jobType = await optionsStorage.dispatchJobTypes.get(job.jobTypeId);
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

        const condition = plugin.getEligibilityCondition(context, pluginConfig.config);
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

      const whereConditions = appliedConditions.map(({ condition }) => {
        const subquery = db
          .select({ one: sql`1` })
          .from(workerDispatchEligDenorm)
          .where(and(
            eq(workerDispatchEligDenorm.workerId, workers.id),
            eq(workerDispatchEligDenorm.category, condition.category),
            eq(workerDispatchEligDenorm.value, condition.value)
          ));

        switch (condition.type) {
          case "exists":
            return exists(subquery);
          
          case "not_exists":
            return notExists(subquery);
          
          case "exists_or_none":
            const categorySubquery = db
              .select({ one: sql`1` })
              .from(workerDispatchEligDenorm)
              .where(and(
                eq(workerDispatchEligDenorm.workerId, workers.id),
                eq(workerDispatchEligDenorm.category, condition.category)
              ));
            return or(
              exists(subquery),
              notExists(categorySubquery)
            );
          
          default:
            logger.warn(`Unknown condition type: ${(condition as EligibilityCondition).type}`, {
              service: "dispatch-eligible-workers",
            });
            return sql`true`;
        }
      });

      let finalQuery = baseQuery;
      if (whereConditions.length > 0) {
        finalQuery = baseQuery.where(and(...whereConditions));
      }

      const countResult = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(
          finalQuery.as("eligible_workers")
        );
      
      const total = countResult[0]?.count || 0;

      const eligibleWorkers = await finalQuery
        .orderBy(contacts.displayName)
        .limit(limit)
        .offset(offset);

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
  };
}
