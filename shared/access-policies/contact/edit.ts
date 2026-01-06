import { definePolicy, registerPolicy, type PolicyContext } from '../index';

const policy = definePolicy({
  id: 'contact.edit',
  description: 'Edit contact information',
  scope: 'entity',
  entityType: 'contact',
  
  describeRequirements: () => [
    { permission: 'staff' },
    { all: [{ policy: 'worker.mine' }, { attribute: 'contact of worker' }] },
    { all: [{ permission: 'employer.manage' }, { policy: 'employer.mine' }, { attribute: 'contact at employer' }] }
  ],
  
  async evaluate(ctx: PolicyContext) {
    if (await ctx.hasPermission('staff')) {
      return { granted: true, reason: 'Staff access' };
    }
    
    // Check if contact belongs to user's worker
    const userWorker = await ctx.getUserWorker();
    if (userWorker) {
      const worker = await ctx.storage.workers?.get?.(userWorker.id);
      if (worker?.contactId === ctx.entityId) {
        return { granted: true, reason: 'Contact belongs to owned worker' };
      }
    }
    
    // Check employer contact access with employer.manage permission
    if (await ctx.hasPermission('employer.manage')) {
      const contactEmployerAssocs = await ctx.storage.employerContacts?.getByContactId?.(ctx.entityId);
      if (contactEmployerAssocs?.length > 0) {
        for (const ec of contactEmployerAssocs) {
          if (await ctx.checkPolicy('employer.mine', ec.employerId)) {
            return { granted: true, reason: 'Contact at associated employer' };
          }
        }
      }
    }
    
    return { granted: false, reason: 'No edit access to this contact' };
  },
});

registerPolicy(policy);
export default policy;
