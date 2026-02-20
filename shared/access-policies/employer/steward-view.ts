import { definePolicy, registerPolicy, type PolicyContext } from '../index';

const policy = definePolicy({
  id: 'employer.steward.view',
  description: 'View employer details (staff or steward assigned to this employer)',
  scope: 'entity',
  entityType: 'employer',

  describeRequirements: () => [
    { permission: 'staff' },
    { policy: 'employer.mine' },
    { all: [{ permission: 'worker' }, { attribute: 'has employment history at employer' }] },
    { all: [{ permission: 'worker.steward' }, { attribute: 'has active steward assignment at employer' }] }
  ],

  async evaluate(ctx: PolicyContext) {
    if (await ctx.hasPermission('staff')) {
      return { granted: true, reason: 'Staff access' };
    }

    if (await ctx.checkPolicy('employer.mine', ctx.entityId)) {
      return { granted: true, reason: 'Associated with this employer' };
    }

    if (await ctx.hasPermission('worker')) {
      const userWorker = await ctx.getUserWorker();
      if (userWorker) {
        const workerHours = await ctx.storage.workerHours?.getWorkerHours?.(userWorker.id);
        if (workerHours?.some((wh: any) => wh.employerId === ctx.entityId)) {
          return { granted: true, reason: 'Has employment history at this employer' };
        }
      }
    }

    if (await ctx.hasPermission('worker.steward')) {
      const userWorker = await ctx.getUserWorker();
      if (userWorker) {
        const assignments = await ctx.storage.workerStewardAssignments?.getAssignmentsByWorkerId?.(userWorker.id);
        if (assignments?.some((a: any) => a.employerId === ctx.entityId)) {
          return { granted: true, reason: 'Steward assigned to this employer' };
        }
      }
    }

    return { granted: false, reason: 'No access to this employer' };
  },
});

registerPolicy(policy);
export default policy;
