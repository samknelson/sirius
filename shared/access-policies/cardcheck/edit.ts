import { definePolicy, registerPolicy, type PolicyContext } from '../index';

const policy = definePolicy({
  id: 'cardcheck.edit',
  description: 'Edit a specific cardcheck record (delegates to worker.mine)',
  scope: 'entity',
  entityType: 'cardcheck',
  
  async evaluate(ctx: PolicyContext) {
    if (await ctx.hasPermission('staff')) {
      return { granted: true, reason: 'Staff access' };
    }
    
    const cardcheck = await ctx.loadEntity('cardcheck', ctx.entityId!);
    if (!cardcheck) {
      return { granted: false, reason: 'Cardcheck not found' };
    }
    
    const workerId = (cardcheck as any).workerId;
    if (!workerId) {
      return { granted: false, reason: 'Cardcheck has no associated worker' };
    }
    
    const hasWorkerAccess = await ctx.checkPolicy('worker.mine', workerId);
    if (hasWorkerAccess) {
      return { granted: true, reason: 'User owns associated worker record' };
    }
    
    return { granted: false, reason: 'No edit access to this cardcheck' };
  },
});

registerPolicy(policy);
export default policy;
