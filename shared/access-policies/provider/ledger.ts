import { definePolicy, registerPolicy, type PolicyContext } from '../index';

const policy = definePolicy({
  id: 'provider.ledger',
  description: 'Access to provider ledger - requires staff permission OR (provider.ledger permission AND user is associated with the provider)',
  scope: 'entity',
  component: 'ledger',
  
  async evaluate(ctx: PolicyContext) {
    if (await ctx.hasPermission('staff')) {
      return { granted: true, reason: 'Staff access' };
    }
    
    if (await ctx.hasPermission('provider.ledger')) {
      const userContact = await ctx.getUserContact();
      if (userContact) {
        const providerContacts = await ctx.storage.trustProviderContacts?.getByContactId?.(userContact.id);
        if (providerContacts?.some((pc: any) => pc.providerId === ctx.entityId)) {
          return { granted: true, reason: 'Associated with this provider' };
        }
      }
    }
    
    return { granted: false, reason: 'Not associated with this provider' };
  },
});

registerPolicy(policy);
export default policy;
