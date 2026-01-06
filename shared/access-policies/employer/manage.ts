import { definePolicy, registerPolicy, type PolicyContext } from '../index';

const policy = definePolicy({
  id: 'employer.manage',
  description: 'Manage employer operations',
  scope: 'route',
  
  describeRequirements: () => [
    { permission: 'staff' },
    { all: [{ permission: 'employer.manage' }, { attribute: 'associated with employer' }] }
  ],
  
  async evaluate(ctx: PolicyContext) {
    if (await ctx.hasPermission('staff')) {
      return { granted: true, reason: 'Staff access' };
    }
    
    if (await ctx.hasPermission('employer.manage')) {
      if (!ctx.entityId) {
        return { granted: false, reason: 'Missing employer entity ID' };
      }
      const hasEmployerAccess = await ctx.checkPolicy('employer.mine', ctx.entityId);
      if (hasEmployerAccess) {
        return { granted: true, reason: 'Has employer.manage permission and employer.mine policy' };
      }
    }
    
    return { granted: false, reason: 'Requires staff or (employer.manage + employer.mine)' };
  },
});

registerPolicy(policy);
export default policy;
