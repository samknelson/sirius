import { definePolicy, registerPolicy, type PolicyContext } from '../../index';

const policy = definePolicy({
  id: 'worker.dispatch.dnc.edit',
  description: 'Edit do-not-call records',
  scope: 'entity',
  entityType: 'worker.dispatch.dnc',
  component: 'dispatch.dnc',
  
  describeRequirements: () => [
    { permission: 'staff' },
    { all: [{ permission: 'worker' }, { attribute: 'owns this DNC record (worker-type only)' }] },
    { all: [{ permission: 'employer' }, { attribute: 'associated with employer for this DNC (employer-type only)' }] }
  ],
  
  async evaluate(ctx: PolicyContext) {
    if (!await ctx.isComponentEnabled('dispatch.dnc')) {
      return { granted: false, reason: 'dispatch.dnc component not enabled' };
    }
    
    if (await ctx.hasPermission('staff')) {
      return { granted: true, reason: 'Staff access' };
    }
    
    const dnc = ctx.entityData || (ctx.entityId ? await ctx.loadEntity('worker.dispatch.dnc', ctx.entityId) : null);
    if (!dnc) {
      return { granted: false, reason: 'DNC record not found or no data provided' };
    }
    
    const userContact = await ctx.getUserContact();
    if (!userContact) {
      return { granted: false, reason: 'User has no contact record' };
    }
    
    if (await ctx.hasPermission('worker')) {
      const userWorker = await ctx.getUserWorker();
      if (userWorker && (dnc as any).workerId === userWorker.id) {
        if ((dnc as any).type === 'worker') {
          return { granted: true, reason: 'Worker editing their own worker-type DNC' };
        } else {
          return { granted: false, reason: 'Workers can only edit worker-type DNC entries' };
        }
      }
    }
    
    if (await ctx.hasPermission('employer')) {
      const employerContacts = await ctx.storage.employerContacts?.listByEmployer?.((dnc as any).employerId);
      if (employerContacts?.some((ec: any) => ec.contactId === userContact.id)) {
        if ((dnc as any).type === 'employer') {
          return { granted: true, reason: 'Employer editing their own employer-type DNC' };
        } else {
          return { granted: false, reason: 'Employers can only edit employer-type DNC entries' };
        }
      }
    }
    
    return { granted: false, reason: 'No edit access to this DNC record' };
  },
});

registerPolicy(policy);
export default policy;
