import { definePolicy, registerPolicy, type PolicyContext } from '../../index';

const policy = definePolicy({
  id: 'edls.sheet.view',
  description: 'View EDLS sheet details',
  scope: 'entity',
  entityType: 'edls_sheet',
  component: 'edls',
  cacheKeyFields: ['status'],
  
  describeRequirements: () => [
    { permission: 'staff' }
  ],
  
  async evaluate(ctx: PolicyContext) {
    if (await ctx.hasPermission('staff')) {
      return { granted: true, reason: 'Staff access' };
    }
    
    return { granted: false, reason: 'No access to this EDLS sheet' };
  },
});

registerPolicy(policy);
export default policy;
