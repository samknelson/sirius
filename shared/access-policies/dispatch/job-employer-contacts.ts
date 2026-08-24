import { definePolicy, registerPolicy, type PolicyContext } from '../index';

/**
 * Edit-level access to a dispatch job's employer contact associations.
 *
 * Staff always; employer users when they are linked to the job's employer
 * (delegates to employer.mine, same pattern as the T631 job-interviews
 * policy). The entity id is the DISPATCH JOB id.
 */
const policy = definePolicy({
  id: 'dispatch.job.employer.contacts',
  description: "Manage the employer contacts associated with a dispatch job",
  scope: 'entity',
  entityType: 'dispatch',
  component: 'dispatch',
  // Relationship-dependent grant (job→employer + caller→employer links can
  // change at any time); never serve a cached decision, same as the t631
  // job-interviews policy.
  skipCache: true,

  describeRequirements: () => [
    { permission: 'staff' },
    { all: [{ permission: 'employer' }, { attribute: "associated with the job's employer" }] },
  ],

  async evaluate(ctx: PolicyContext) {
    if (await ctx.hasPermission('staff')) {
      return { granted: true, reason: 'Staff access' };
    }

    // Inline the employer.mine check rather than delegating via
    // ctx.checkPolicy: the delegated sub-policy result is served from the
    // evaluator cache, which would defeat skipCache and let a revoked
    // employer link keep granting for up to the cache TTL.
    if (ctx.entityId && (await ctx.hasPermission('employer'))) {
      const job = await ctx.storage.dispatchJobs?.get?.(ctx.entityId);
      if (job?.employerId) {
        const userContact = await ctx.getUserContact();
        if (userContact) {
          const employerContacts = await ctx.storage.employerContacts?.listByEmployer?.(job.employerId);
          if (employerContacts?.some((ec: any) => ec.contactId === userContact.id)) {
            return { granted: true, reason: "Associated with this job's employer" };
          }
        }
      }
    }

    return { granted: false, reason: 'No access to employer contacts for this job' };
  },
});

registerPolicy(policy);
export default policy;
