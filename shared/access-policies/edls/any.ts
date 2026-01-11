import { definePolicy, registerPolicy, type PolicyContext } from '../index';

const policy = definePolicy({
  id: 'edls.any',
  description: 'Access for users with admin or any EDLS permission',
  scope: 'route',
  component: 'edls',
  
  describeRequirements: () => [
    { permission: 'admin' },
    { permission: 'edls.manager' },
    { permission: 'edls.coordinator' },
    { permission: 'edls.supervisor' },
    { permission: 'edls.reader' },
    { permission: 'edls.worker.advisor' }
  ],
  
  async evaluate(ctx: PolicyContext) {
    if (await ctx.hasPermission('admin')) {
      return { granted: true, reason: 'Admin has full access' };
    }
    
    if (await ctx.hasAnyPermission([
      'edls.manager',
      'edls.coordinator',
      'edls.supervisor',
      'edls.reader',
      'edls.worker.advisor'
    ])) {
      return { granted: true, reason: 'User has EDLS permission' };
    }
    
    return { granted: false, reason: 'No EDLS access' };
  },
});

registerPolicy(policy);
export default policy;
