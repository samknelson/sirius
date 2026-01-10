import { definePolicy, registerPolicy, type PolicyContext } from '../../index';

const policy = definePolicy({
  id: 'edls.sheet.set_status',
  description: 'Change EDLS sheet status',
  scope: 'entity',
  entityType: 'edls_sheet',
  component: 'edls',
  
  describeRequirements: () => [
    { permission: 'edls.manager' },
    { permission: 'edls.coordinator' },
    { permission: 'edls.worker.advisor' }
  ],
  
  async evaluate(ctx: PolicyContext) {
    if (await ctx.hasAnyPermission(['edls.manager', 'edls.coordinator'])) {
      return { granted: true, reason: 'Manager/coordinator full access' };
    }
    
    if (await ctx.hasPermission('edls.worker.advisor')) {
      const targetStatus = ctx.entityData?.targetStatus;
      
      const sheet = await ctx.loadEntity('edls_sheet', ctx.entityId!);
      if (!sheet) {
        return { granted: false, reason: 'Sheet not found' };
      }
      
      const currentStatus = (sheet as any).status;
      
      if (currentStatus === 'lock' || targetStatus === 'lock') {
        return { 
          granted: false, 
          reason: 'Worker advisors cannot change status to or from Scheduled' 
        };
      }
      
      return { granted: true, reason: 'Worker advisor access' };
    }
    
    return { granted: false, reason: 'No permission to change sheet status' };
  },
});

registerPolicy(policy);
export default policy;
