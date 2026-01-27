import { definePolicy, registerPolicy, type PolicyContext } from '../../index';

const policy = definePolicy({
  id: 'edls.sheet.create',
  description: 'Create new EDLS sheets',
  scope: 'route',
  component: 'edls',
  
  describeRequirements: () => [
    { permission: 'admin' },
    { permission: 'edls.manager' },
    { permission: 'edls.coordinator' },
    { permission: 'edls.worker.advisor' }
  ],
  
  async evaluate(ctx: PolicyContext) {
    if (await ctx.hasAnyPermission(['admin', 'edls.manager', 'edls.coordinator', 'edls.worker.advisor'])) {
      return { granted: true, reason: 'User has sheet creation permission' };
    }
    
    return { granted: false, reason: 'No permission to create sheets' };
  },
});

registerPolicy(policy);
export default policy;
