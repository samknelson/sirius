import { alterHooks } from "../../../shared/alter";
import { employerViewExtensionHook } from "../../../shared/access-policies/employer/view";
export function registerStewardEmployerAccess() {
  alterHooks.register(employerViewExtensionHook, {
    id: "worker.steward.employer-view", component: "worker.steward", priority: 10,
    description: "Allow stewards to view employers to which they are assigned", metadata: {},
    async alter(granted, { context: ctx }) {
      if (granted || !(await ctx.hasPermission("worker.steward"))) return granted;
      const worker = await ctx.getUserWorker();
      if (!worker) return false;
      const assignments = await ctx.storage.workerStewardAssignments.getAssignmentsByWorkerId(worker.id);
      return assignments.some((assignment: { employerId: string }) => assignment.employerId === ctx.entityId);
    },
  });
}
