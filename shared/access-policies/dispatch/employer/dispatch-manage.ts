import { definePolicy, registerPolicy, type PolicyContext } from '../../index';

const policy = definePolicy({
  id: 'employer.dispatch.manage',
  description: 'Manage employer dispatch',
  scope: 'entity',
  entityType: 'employer',
  component: 'dispatch',
  
  describeRequirements: () => [
    { permission: 'staff' },
    { all: [{ permission: 'employer.dispatch.manage' }, { attribute: 'associated with employer' }] }
  ],
  
  async evaluate(ctx: PolicyContext) {
    if (await ctx.hasPermission('staff')) {
      return { granted: true, reason: 'Staff access' };
    }
    
    if (await ctx.hasPermission('employer.dispatch.manage')) {
      const userContact = await ctx.getUserContact();
      if (userContact) {
        const employerContacts = await ctx.storage.employerContacts?.listByEmployer?.(ctx.entityId);
        if (employerContacts?.some((ec: any) => ec.contactId === userContact.id)) {
          return { granted: true, reason: 'Employer dispatch manage access for associated employer' };
        }
      }
    }
    
    return { granted: false, reason: 'No dispatch manage access for this employer' };
  },
});

registerPolicy(policy);
export default policy;
