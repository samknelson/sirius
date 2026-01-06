import { definePolicy, registerPolicy, type PolicyContext } from '../index';

const policy = definePolicy({
  id: 'worker.edit',
  description: 'Edit worker information',
  scope: 'entity',
  entityType: 'worker',
  
  describeRequirements: () => [
    { permission: 'staff' },
    { all: [{ permission: 'worker' }, { attribute: 'owns this worker record' }] }
  ],
  
  async evaluate(ctx: PolicyContext) {
    if (await ctx.hasPermission('staff')) {
      return { granted: true, reason: 'Staff access' };
    }
    
    if (await ctx.hasPermission('worker')) {
      const userWorker = await ctx.getUserWorker();
      if (userWorker && userWorker.id === ctx.entityId) {
        return { granted: true, reason: 'Owns this worker record' };
      }
    }
    
    return { granted: false, reason: 'No edit access to this worker' };
  },
});

registerPolicy(policy);
export default policy;
