import { definePolicy, registerPolicy, type PolicyContext } from '../index';

/**
 * Access to a worker's Disability Credit screen.
 *
 * Staff always see the tab (they open and work cases). A member always sees
 * it for their OWN record: the screen is the one place that shows their case
 * history AND — when they do not meet the rolling FMLA gate — the Fund's
 * ineligibility instruction ("contact the Fund"). Viewing is therefore not
 * eligibility-gated; INITIATION is: the case-creation and document-intake
 * routes re-evaluate the shared FMLA-only eligibility core server-side and
 * refuse ineligible members there. Denial letters never grant a member path.
 */
const policy = definePolicy({
  id: 'worker.dc',
  description: "Access a worker's Disability Credit screen",
  scope: 'entity',
  entityType: 'worker',
  component: 'sitespecific.bao',

  describeRequirements: () => [
    { all: [{ permission: 'staff' }] },
    { all: [{ policy: 'worker.mine' }] },
  ],

  async evaluate(ctx: PolicyContext) {
    if (!ctx.entityId) {
      return { granted: false, reason: 'No worker specified' };
    }

    if (await ctx.hasPermission('staff')) {
      return { granted: true, reason: 'Staff access' };
    }

    const isMine = await ctx.checkPolicy('worker.mine', ctx.entityId);
    if (isMine) {
      // Own record: read access always — the screen itself communicates
      // eligibility (or the contact-the-Fund message). Creation stays
      // gated server-side on the FMLA eligibility core.
      return { granted: true, reason: 'Own record' };
    }
    return { granted: false, reason: 'No access to this worker' };
  },
});

registerPolicy(policy);
export default policy;
