import { definePolicy, registerPolicy, type PolicyContext } from '../index';

const policy = definePolicy({
  id: 'edls.coordinator',
  description: 'Access for users with admin, coordinator, or manager permissions',
  scope: 'route',
  component: 'edls',
  
  describeRequirements: () => [
    { permission: 'admin' },
    { permission: 'edls.manager' },
    { permission: 'edls.coordinator' }
  ],
  
  async evaluate(ctx: PolicyContext) {
    if (await ctx.hasPermission('admin')) {
      return { granted: true, reason: 'Admin has full access' };
    }
    
    if (await ctx.hasAnyPermission(['edls.manager', 'edls.coordinator'])) {
      return { granted: true, reason: 'User has EDLS coordinator-level permission' };
    }
    
    return { granted: false, reason: 'No EDLS coordinator access' };
  },
});

registerPolicy(policy);
export default policy;
