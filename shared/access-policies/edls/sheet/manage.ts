import { definePolicy, registerPolicy, type PolicyContext } from '../../index';

const policy = definePolicy({
  id: 'edls.sheet.manage',
  description: 'Manage EDLS sheet (edit crews, assignments)',
  scope: 'entity',
  entityType: 'edls_sheet',
  component: 'edls',
  cacheKeyFields: ['status'],
  
  describeRequirements: () => [
    { permission: 'admin' },
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
    
    if (status === 'lock') {
      // Mirror edls.sheet.set_status: only admins, managers, and coordinators
      // can move a sheet out of Scheduled, so only they can manage it.
      if (await ctx.hasAnyPermission(['admin', 'edls.manager', 'edls.coordinator'])) {
        return { granted: true, reason: 'Admin/manager/coordinator can manage Scheduled sheets' };
      }
      return { 
        granted: false, 
        reason: 'Only managers and coordinators can manage Scheduled sheets' 
      };
    }
    
    if (await ctx.hasPermission('admin')) {
      return { granted: true, reason: 'Admin has full access' };
    }
    
    if (await ctx.hasAnyPermission(['edls.manager', 'edls.coordinator', 'edls.worker.advisor'])) {
      return { granted: true, reason: 'User has manage permission' };
    }
    
    return { granted: false, reason: 'No permission to manage sheet' };
  },
});

registerPolicy(policy);
export default policy;
