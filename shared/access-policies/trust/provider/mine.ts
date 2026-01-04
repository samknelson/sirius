import { definePolicy, registerPolicy, type PolicyContext } from '../../index';

const policy = definePolicy({
  id: 'trust.provider.mine',
  description: 'Access your associated trust provider',
  scope: 'entity',
  entityType: 'provider',
  
  describeRequirements: () => [
    { permission: 'staff' },
    { all: [{ permission: 'trust.provider' }, { attribute: 'associated with provider' }] }
  ],
  
  async evaluate(ctx: PolicyContext) {
    if (await ctx.hasPermission('staff')) {
      return { granted: true, reason: 'Staff access' };
    }
    
    if (await ctx.hasPermission('trust.provider')) {
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
