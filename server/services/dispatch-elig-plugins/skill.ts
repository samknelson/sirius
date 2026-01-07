import { logger } from "../../logger";
import { createWorkerSkillStorage } from "../../storage/worker-skills";
import { createWorkerDispatchEligDenormStorage } from "../../storage/worker-dispatch-elig-denorm";
import { createDispatchJobStorage } from "../../storage/dispatch-jobs";
import type { DispatchEligPlugin, EligibilityCondition, EligibilityQueryContext } from "../dispatch-elig-plugin-registry";
import { EventType } from "../event-bus";
import { isComponentEnabledSync, isCacheInitialized } from "../component-cache";
import { db } from "../../db";
import { workerSkills } from "@shared/schema";

const SKILL_CATEGORY = "skill";
const COMPONENT_ID = "worker.skills";

interface JobData {
  requiredSkills?: string[];
}

export const dispatchSkillPlugin: DispatchEligPlugin = {
  id: "dispatch_skill",
  name: "Required Skills",
  description: "Filters workers based on required skills for the job",
  componentId: "worker.skills",

  eventHandlers: [
    {
      event: EventType.WORKER_SKILL_SAVED,
      getWorkerId: (payload) => payload.workerId,
    },
  ],

  async getEligibilityCondition(context: EligibilityQueryContext, _config: Record<string, unknown>): Promise<EligibilityCondition | null> {
    const jobStorage = createDispatchJobStorage();
    const job = await jobStorage.getWithRelations(context.jobId);
    
    if (!job) {
      logger.warn(`Job not found for skill eligibility check`, {
        service: "dispatch-elig-skill",
        jobId: context.jobId,
      });
      return null;
    }

    const jobData = job.data as JobData | null;
    const requiredSkills = jobData?.requiredSkills || [];

    if (requiredSkills.length === 0) {
      logger.debug(`No required skills for job, all workers eligible`, {
        service: "dispatch-elig-skill",
        jobId: context.jobId,
      });
      return null;
    }

    logger.debug(`Job requires skills for eligibility`, {
      service: "dispatch-elig-skill",
      jobId: context.jobId,
      requiredSkillCount: requiredSkills.length,
    });

    return {
      category: SKILL_CATEGORY,
      type: "exists_all",
      value: requiredSkills.join(","),
      values: requiredSkills,
    };
  },

  async recomputeWorker(workerId: string): Promise<void> {
    const skillStorage = createWorkerSkillStorage();
    const eligStorage = createWorkerDispatchEligDenormStorage();

    logger.debug(`Recomputing skill eligibility for worker ${workerId}`, {
      service: "dispatch-elig-skill",
      workerId,
    });

    await eligStorage.deleteByWorkerAndCategory(workerId, SKILL_CATEGORY);

    const workerSkills = await skillStorage.getByWorker(workerId);

    if (workerSkills.length === 0) {
      logger.debug(`No skills for worker ${workerId}`, {
        service: "dispatch-elig-skill",
        workerId,
      });
      return;
    }

    const eligEntries = workerSkills.map(ws => ({
      workerId: ws.workerId,
      category: SKILL_CATEGORY,
      value: ws.skillId,
    }));

    await eligStorage.createMany(eligEntries);

    logger.debug(`Created ${eligEntries.length} skill eligibility entries for worker ${workerId}`, {
      service: "dispatch-elig-skill",
      workerId,
      count: eligEntries.length,
    });
  },
};

/**
 * Backfill eligibility entries for all existing worker skills.
 * This should be called at startup to ensure pre-existing skills are accounted for.
 */
export async function backfillDispatchSkillEligibility(): Promise<{ workersProcessed: number; entriesCreated: number }> {
  if (!isCacheInitialized()) {
    logger.warn("Component cache not initialized, skipping skill eligibility backfill", {
      service: "dispatch-elig-skill",
    });
    return { workersProcessed: 0, entriesCreated: 0 };
  }

  if (!isComponentEnabledSync(COMPONENT_ID)) {
    logger.debug("worker.skills component not enabled, skipping backfill", {
      service: "dispatch-elig-skill",
    });
    return { workersProcessed: 0, entriesCreated: 0 };
  }

  const allSkills = await db.select().from(workerSkills);
  
  if (allSkills.length === 0) {
    logger.info("No worker skills found for backfill", {
      service: "dispatch-elig-skill",
    });
    return { workersProcessed: 0, entriesCreated: 0 };
  }

  const workerIds = Array.from(new Set(allSkills.map(s => s.workerId)));

  logger.info("Backfilling skill eligibility for workers with existing skills", {
    service: "dispatch-elig-skill",
    workerCount: workerIds.length,
    skillCount: allSkills.length,
  });

  let entriesCreated = 0;

  for (const workerId of workerIds) {
    await dispatchSkillPlugin.recomputeWorker(workerId);
    const workerSkillCount = allSkills.filter(s => s.workerId === workerId).length;
    entriesCreated += workerSkillCount;
  }

  logger.info("Completed skill eligibility backfill", {
    service: "dispatch-elig-skill",
    workersProcessed: workerIds.length,
    entriesCreated,
  });

  return { workersProcessed: workerIds.length, entriesCreated };
}
