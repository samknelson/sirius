import { definePolicy, registerPolicy, type PolicyContext } from '../../index';

const policy = definePolicy({
  id: 'edls.sheet.view',
  description: 'View EDLS sheet details',
  scope: 'entity',
  entityType: 'edls_sheet',
  component: 'edls',
  cacheKeyFields: ['status', 'supervisor', 'assignee'],
  
  describeRequirements: () => [
    { permission: 'staff' },
    { all: [{ permission: 'edls.supervisor' }, { attribute: 'assigned as supervisor or assignee on the sheet' }] }
  ],
  
  async evaluate(ctx: PolicyContext) {
    if (await ctx.hasPermission('staff')) {
      return { granted: true, reason: 'Staff access' };
    }
    
    if (await ctx.hasPermission('edls.supervisor')) {
      const sheet = ctx.entityData || (ctx.entityId ? await ctx.loadEntity('edls_sheet', ctx.entityId) : null);
      console.log('[edls.sheet.view DEBUG] entityId:', ctx.entityId);
      console.log('[edls.sheet.view DEBUG] user.id:', ctx.user.id);
      console.log('[edls.sheet.view DEBUG] sheet:', sheet ? { id: (sheet as any).id, supervisor: (sheet as any).supervisor, assignee: (sheet as any).assignee } : 'null');
      if (sheet) {
        const supervisor = (sheet as any).supervisor;
        const assignee = (sheet as any).assignee;
        console.log('[edls.sheet.view DEBUG] Comparing: supervisor', supervisor, '=== user.id', ctx.user.id, '?', supervisor === ctx.user.id);
        console.log('[edls.sheet.view DEBUG] Comparing: assignee', assignee, '=== user.id', ctx.user.id, '?', assignee === ctx.user.id);
        if (supervisor === ctx.user.id || assignee === ctx.user.id) {
          return { granted: true, reason: 'Assigned as supervisor or assignee on this sheet' };
        }
      }
    }
    
    return { granted: false, reason: 'No access to this EDLS sheet' };
  },
});

registerPolicy(policy);
export default policy;
