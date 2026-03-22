import { definePolicy, registerPolicy, type PolicyContext } from '../index';

const policy = definePolicy({
  id: 'dispatch.manage',
  description: 'Manage a dispatch (view details and change status)',
  scope: 'entity',
  entityType: 'dispatch',

  describeRequirements: () => [
    { permission: 'staff' },
    { attribute: 'worker who owns this dispatch' },
  ],

  async evaluate(ctx: PolicyContext) {
    if (await ctx.hasPermission('staff')) {
      return { granted: true, reason: 'Staff access' };
    }

    if (ctx.entityId) {
      const dispatch = await ctx.loadEntity('dispatch', ctx.entityId);
      if (dispatch && dispatch.workerId) {
        if (await ctx.checkPolicy('worker.mine', dispatch.workerId)) {
          return { granted: true, reason: 'Owns this dispatch' };
        }
      }
    }

    return { granted: false, reason: 'No access to this dispatch' };
  },
});

registerPolicy(policy);
export default policy;
