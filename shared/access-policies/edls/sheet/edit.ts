import { definePolicy, registerPolicy, type PolicyContext } from '../../index';

const policy = definePolicy({
  id: 'edls.sheet.edit',
  description: 'Edit EDLS sheet details',
  scope: 'entity',
  entityType: 'edls_sheet',
  component: 'edls',
  cacheKeyFields: ['status', 'supervisor'],
  
  describeRequirements: () => [
    { permission: 'edls.manager' },
    { permission: 'edls.coordinator' },
    { permission: 'edls.worker.advisor' },
    { permission: 'edls.supervisor', condition: 'draft sheets where user is assigned supervisor' }
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
    
    if (
      status === 'draft' &&
      await ctx.hasPermission('edls.supervisor') &&
      (sheet as any).supervisor === ctx.user?.id
    ) {
      return { granted: true, reason: 'Supervisor can edit their assigned draft sheets' };
    }
    
    return { granted: false, reason: 'No permission to edit sheet' };
  },
});

registerPolicy(policy);
export default policy;
