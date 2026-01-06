import { definePolicy, registerPolicy, type PolicyContext } from '../index';

const policy = definePolicy({
  id: 'worker.view',
  description: 'View worker details',
  scope: 'entity',
  entityType: 'worker',
  
  describeRequirements: () => [
    { permission: 'staff' },
    { policy: 'worker.mine' },
    { all: [{ permission: 'trustprovider' }, { attribute: 'benefit provider for this worker' }] }
  ],
  
  async evaluate(ctx: PolicyContext) {
    if (await ctx.hasPermission('staff')) {
      return { granted: true, reason: 'Staff access' };
    }
    
    if (await ctx.checkPolicy('worker.mine', ctx.entityId)) {
      return { granted: true, reason: 'Owns this worker record' };
    }
    
    if (await ctx.hasPermission('trustprovider')) {
      const worker = await ctx.loadEntity('worker', ctx.entityId!);
      if (worker) {
        const userContact = await ctx.getUserContact();
        if (userContact) {
          const providerContacts = await ctx.storage.trustProviderContacts?.getByContactId?.(userContact.id);
          if (providerContacts && providerContacts.length > 0) {
            const providerIds = providerContacts.map((pc: any) => pc.providerId);
            const workerBenefits = await ctx.storage.workerMonthlyBenefits?.getByWorkerId?.(worker.id);
            if (workerBenefits?.some((wb: any) => providerIds.includes(wb.providerId))) {
              return { granted: true, reason: 'Benefit provider for this worker' };
            }
          }
        }
      }
    }
    
    return { granted: false, reason: 'No access to this worker' };
  },
});

registerPolicy(policy);
export default policy;
