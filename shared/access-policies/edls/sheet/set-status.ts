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
    const targetStatus = ctx.entityData?.targetStatus;
    
    if (targetStatus === 'trash') {
      const sheet = await ctx.loadEntity('edls_sheet', ctx.entityId!);
      if (sheet) {
        if ((sheet as any).status === 'lock') {
          return { 
            granted: false, 
            reason: 'Scheduled sheets cannot be moved to trash' 
          };
        }
        const sheetData = (sheet as any).data || {};
        if (sheetData.trashLock) {
          return { 
            granted: false, 
            reason: 'This sheet has a trash lock and cannot be moved to trash' 
          };
        }
      }
    }
    
    if (await ctx.hasAnyPermission(['edls.manager', 'edls.coordinator'])) {
      return { granted: true, reason: 'Manager/coordinator full access' };
    }
    
    if (await ctx.hasPermission('edls.worker.advisor')) {
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
