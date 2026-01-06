import { definePolicy, registerPolicy, type PolicyContext } from '../index';

const policy = definePolicy({
  id: 'esig.view',
  description: 'View electronic signatures',
  scope: 'entity',
  entityType: 'esig',
  
  describeRequirements: () => [
    { permission: 'staff' },
    { attribute: 'has view access to associated document' }
  ],
  
  async evaluate(ctx: PolicyContext) {
    if (await ctx.hasPermission('staff')) {
      return { granted: true, reason: 'Staff access' };
    }
    
    const esig = await ctx.loadEntity('esig', ctx.entityId!);
    if (!esig) {
      return { granted: false, reason: 'Esig not found' };
    }
    
    const docType = (esig as any).docType;
    const docId = (esig as any).docId;
    
    if (docType === 'cardcheck' && docId) {
      const hasAccess = await ctx.checkPolicy('cardcheck.view', docId);
      if (hasAccess) {
        return { granted: true, reason: 'Has view access to associated cardcheck' };
      }
    }
    
    return { granted: false, reason: 'No access to this esig' };
  },
});

registerPolicy(policy);
export default policy;
