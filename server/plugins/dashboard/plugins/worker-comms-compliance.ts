import { registerDashboardPlugin } from "../registry";
import type { DashboardPlugin } from "../types";
import { WORKER_COMMS_COMPONENT } from "@shared/worker-comms-compliance";
import { listWorkerCommsDefinitions, validateWorkerCommsReferences } from "../../../services/worker-comms-compliance";
import { currentBenefitMonth } from "../../../storage/worker-comms-compliance";
import { logger } from "../../../logger";

export const workerCommsCompliancePlugin: DashboardPlugin = {
  id: "worker-comms-compliance",
  name: "Worker Comms Compliance",
  description: "Workers with and without qualifying tagged communications for saved distribution definitions.",
  requiredComponent: WORKER_COMMS_COMPONENT,
  requiredPolicy: "staff",
  async content(ctx) {
    const definitions = await listWorkerCommsDefinitions(ctx.storage);
    const options = definitions.length ? await ctx.storage.workerCommsCompliance.options() : null;
    const results = [];
    const referenceMonth = currentBenefitMonth();
    // Sequential bounded queries avoid a large saved-definition list exhausting the pool.
    for (const definition of definitions) {
      try {
        await validateWorkerCommsReferences(ctx.storage, definition, options!);
        const report = await ctx.storage.workerCommsCompliance.report(definition, "all", 1, 1, referenceMonth);
        results.push({ definition, tagName: options?.tags.find(tag => tag.id === definition.commTagId)?.name ?? "Unavailable tag", counts: report.counts, benefitPeriod: report.benefitPeriod });
      } catch (error) {
        logger.warn("Unable to compute worker communication definition", { service: "worker-comms-compliance", definitionId: definition.id, error });
        results.push({ definition, tagName: options?.tags.find(tag => tag.id === definition.commTagId)?.name ?? "Unavailable tag", counts: null, error: "This definition could not be evaluated. Open the report to review its criteria." });
      }
    }
    return { definitions: results, benefitMonth: referenceMonth };
  },
  client: {
    component: "worker-comms-compliance:WorkerCommsCompliance",
    order: 12,
    requiredPermissions: ["staff", "admin"],
  },
};
registerDashboardPlugin(workerCommsCompliancePlugin);
