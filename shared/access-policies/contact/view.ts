import { definePolicy, registerPolicy, type PolicyContext } from '../index';

const policy = definePolicy({
  id: 'contact.view',
  description: 'View contact details',
  scope: 'entity',
  entityType: 'contact',
  
  describeRequirements: () => [
    { permission: 'staff' },
    { all: [{ policy: 'worker.mine' }, { attribute: 'contact of worker' }] },
    { all: [{ policy: 'trust.provider.mine' }, { attribute: 'contact of provider' }] },
    { all: [{ policy: 'employer.mine' }, { attribute: 'contact at employer' }] }
  ],
  
  async evaluate(ctx: PolicyContext) {
    if (await ctx.hasPermission('staff')) {
      return { granted: true, reason: 'Staff access' };
    }
    
    const contact = await ctx.loadEntity('contact', ctx.entityId!);
    if (!contact) {
      return { granted: false, reason: 'Contact not found' };
    }
    
    // Check if contact belongs to user's worker
    const userWorker = await ctx.getUserWorker();
    if (userWorker) {
      const worker = await ctx.storage.workers?.get?.(userWorker.id);
      if (worker?.contactId === ctx.entityId) {
        return { granted: true, reason: 'Contact belongs to owned worker' };
      }
    }
    
    // Check if contact belongs to a provider the user is associated with
    const providers = await ctx.storage.trustProviders?.getByContactId?.(ctx.entityId);
    if (providers?.length > 0) {
      for (const provider of providers) {
        if (await ctx.checkPolicy('trust.provider.mine', provider.id)) {
          return { granted: true, reason: 'Contact of associated provider' };
        }
      }
    }
    
    // Check if contact is at an employer the user is associated with
    const contactEmployerAssocs = await ctx.storage.employerContacts?.getByContactId?.(ctx.entityId);
    if (contactEmployerAssocs?.length > 0) {
      for (const ec of contactEmployerAssocs) {
        if (await ctx.checkPolicy('employer.mine', ec.employerId)) {
          return { granted: true, reason: 'Contact at associated employer' };
        }
      }
    }
    
    return { granted: false, reason: 'No access to this contact' };
  },
});

registerPolicy(policy);
export default policy;
