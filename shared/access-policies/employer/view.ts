import { definePolicy, registerPolicy, type PolicyContext } from '../index';

const policy = definePolicy({
  id: 'employer.view',
  description: 'View employer details',
  scope: 'entity',
  entityType: 'employer',
  
  describeRequirements: () => [
    { permission: 'staff' },
    { policy: 'employer.mine' },
    { all: [{ permission: 'worker' }, { attribute: 'has employment history at employer' }] }
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
    
    return { granted: false, reason: 'No access to this employer' };
  },
});

registerPolicy(policy);
export default policy;
