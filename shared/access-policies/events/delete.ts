import { definePolicy, registerPolicy, type PolicyContext } from '../index';

const policy = definePolicy({
  id: 'events.delete',
  description: 'Delete events',
  scope: 'route',
  rules: [{ permission: 'admin' }],
  
  async evaluate(ctx: PolicyContext) {
    if (await ctx.hasPermission('admin')) {
      return { granted: true, reason: 'Admin access' };
    }
    
    return { granted: false, reason: 'Admin permission required to delete events' };
  },
});

registerPolicy(policy);
export default policy;
