import { definePolicy, registerPolicy, type PolicyContext } from '../../index';

const policy = definePolicy({
  id: 'edls.sheet.edit',
  description: 'Edit EDLS sheet details',
  scope: 'entity',
  entityType: 'edls_sheet',
  component: 'edls',
  
  describeRequirements: () => [
    { permission: 'edls.manager' },
    { permission: 'edls.coordinator' },
    { permission: 'edls.worker.advisor' }
  ],
  
  async evaluate(ctx: PolicyContext) {
    const sheet = await ctx.loadEntity('edls_sheet', ctx.entityId!);
    if (!sheet) {
      return { granted: false, reason: 'Sheet not found' };
    }
    
    const status = (sheet as any).status;
    if (status === 'lock' || status === 'trash') {
      return { 
        granted: false, 
        reason: status === 'lock' 
          ? 'Scheduled sheets cannot be edited' 
          : 'Trashed sheets cannot be edited' 
      };
    }
    
    if (await ctx.hasAnyPermission(['edls.manager', 'edls.coordinator', 'edls.worker.advisor'])) {
      return { granted: true, reason: 'User has edit permission' };
    }
    
    return { granted: false, reason: 'No permission to edit sheet' };
  },
});

registerPolicy(policy);
export default policy;
