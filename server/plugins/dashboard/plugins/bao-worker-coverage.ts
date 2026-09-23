import { registerDashboardPlugin } from "../registry";
import type { DashboardPlugin } from "../types";
import { resolveLinkedWorkerId } from "../../../auth/worker-link";
import { buildWorkerCoverageSummary } from "../../../services/sitespecific/bao/worker-coverage-dashboard";

export const baoWorkerCoveragePlugin: DashboardPlugin = {
  id: "bao-worker-coverage",
  name: "Worker Coverage",
  description: "Current BAO coverage and hours thresholds for upcoming coverage months",
  requiredComponent: "sitespecific.bao",

  async content(ctx) {
    if (!(await ctx.storage.users.userHasPermission(ctx.dbUser.id, "worker"))) {
      throw Object.assign(new Error("Worker access required"), { status: 403 });
    }
    // Always resolve from the effective dashboard user supplied by the
    // registry. Never accept a worker id from query/settings as a data scope.
    const workerId = await resolveLinkedWorkerId(ctx.dbUser);
    if (!workerId) {
      return {
        state: "unlinked",
        message: "No worker record is linked to this account.",
      };
    }
    const worker = await ctx.storage.workers.getWorker(workerId);
    if (!worker) {
      return {
        state: "unavailable",
        message: "The linked worker record is unavailable.",
      };
    }
    return buildWorkerCoverageSummary(ctx.storage, workerId);
  },

  client: {
    component: "bao-worker-coverage:BaoWorkerCoverage",
    order: 5,
    fullWidth: true,
    requiredPermissions: ["worker"],
  },
};

registerDashboardPlugin(baoWorkerCoveragePlugin);