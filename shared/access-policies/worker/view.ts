import { definePolicy, registerPolicy, type PolicyContext } from '../index';

const policy = definePolicy({
  id: 'worker.view',
  description: 'View worker details',
  scope: 'entity',
  entityType: 'worker',
  
  describeRequirements: () => [
    { permission: 'staff' },
    { policy: 'worker.mine' },
    { any: [{ permission: 'provider' }, { permission: 'trust.provider' }, { permission: 'trustprovider' }] }
  ],
  
  async evaluate(ctx: PolicyContext) {
    if (await ctx.hasPermission('staff')) {
      return { granted: true, reason: 'Staff access' };
    }
    
    if (await ctx.checkPolicy('worker.mine', ctx.entityId)) {
      return { granted: true, reason: 'Owns this worker record' };
    }
    
    const isProvider = await ctx.hasPermission('provider') || await ctx.hasPermission('trust.provider') || await ctx.hasPermission('trustprovider');
    if (isProvider) {
      return { granted: true, reason: 'Provider access' };
    }
    
    return { granted: false, reason: 'No access to this worker' };
  },
});

registerPolicy(policy);
export default policy;
