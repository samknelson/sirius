import { definePolicy, registerPolicy, type PolicyContext } from '../index';

const policy = definePolicy({
  id: 'events.edit',
  description: 'Edit events and manage participants',
  scope: 'route',
  rules: [{ permission: 'staff' }],
  
  async evaluate(ctx: PolicyContext) {
    if (await ctx.hasPermission('staff')) {
      return { granted: true, reason: 'Staff access' };
    }
    
    return { granted: false, reason: 'Staff permission required to edit events' };
  },
});

registerPolicy(policy);
export default policy;
