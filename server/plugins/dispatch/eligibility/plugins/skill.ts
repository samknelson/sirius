import { registerDispatchEligPlugin } from "../registry";
import { logger } from "../../../../logger";
import { createDispatchJobStorage } from "../../../../storage/dispatch/jobs";
import type { DispatchEligPlugin, EligibilityCondition, EligibilityQueryContext } from "../registry";

const SKILL_CATEGORY = "skill";

interface JobData {
  requiredSkills?: string[];
}

/**
 * `dispatch_skill` — READ side. Filters workers by the job's required skills.
 * The `skill` facts are maintained by the `dispatch_skill` denorm plugin.
 */
export const dispatchSkillPlugin: DispatchEligPlugin = {
  id: "dispatch_skill",
  name: "Required Skills",
  description: "Filters workers based on required skills for the job",
  requiredComponent: "worker.skills",

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
};

registerDispatchEligPlugin(dispatchSkillPlugin);
