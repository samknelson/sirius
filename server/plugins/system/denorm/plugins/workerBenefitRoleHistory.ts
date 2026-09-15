import { registerDenormPlugin } from "../registry";
import type { DenormPlugin } from "../types";
import { storage } from "../../../../storage";
import type { WorkerBenefitRoleHistoryPayload } from "../../../../storage/trust/worker-benefit-role-history";

/**
 * Complete, rebuildable history fact for later worker-list controls.  There is
 * deliberately no WMB event handler here: WMB and relation storage atomically
 * enqueue invalidations with the source write, and the shared denorm drainer
 * computes later.  This keeps corrective scans off the synchronous WMB path.
 */
const workerBenefitRoleHistoryDenormPlugin: DenormPlugin<WorkerBenefitRoleHistoryPayload> = {
  metadata: {
    id: "worker-benefit-role-history",
    name: "Worker Benefit Role History",
    description:
      "Rebuilds each worker's earliest retained subscriber and dependent WMB coverage history.",
    singleton: true,
    requiredComponent: "trust.benefits",
  },
  entityType: "worker",
  reads: ["workerBenefitRoleHistory", "workers"],
  writes: [{ storage: "workerBenefitRoleHistory", soleWriter: true }],

  async compute(workerId: string): Promise<WorkerBenefitRoleHistoryPayload> {
    return storage.workerBenefitRoleHistory.computeForWorker(workerId);
  },

  async backfill(configId: string, limit: number): Promise<string[]> {
    return storage.workers.findIdsMissingDenorm(configId, limit);
  },

  async findWidows(configId: string, limit: number): Promise<string[]> {
    return storage.workers.findDenormWidowIds(configId, limit);
  },

  async write(workerId: string, payload: WorkerBenefitRoleHistoryPayload, denormId: string): Promise<void> {
    await storage.workerBenefitRoleHistory.replaceForWorker(workerId, denormId, payload);
  },
};

registerDenormPlugin(workerBenefitRoleHistoryDenormPlugin);