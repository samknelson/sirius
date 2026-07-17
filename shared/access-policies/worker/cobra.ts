import { definePolicy, registerPolicy, type PolicyContext } from '../index';

/**
 * Access to a worker's COBRA screen.
 *
 * Granted when the viewer can see the worker record (staff, or the worker
 * viewing their own record) AND the worker has an active (non-closed) COBRA
 * case as the covered person. The case-existence requirement means the COBRA
 * tab simply does not appear for workers with no open case — for staff too,
 * keeping the tab strip meaningful.
 *
 * skipCache: visibility flips the moment a case is opened or closed, so the
 * result must not be cached against a stale case state.
 */
const policy = definePolicy({
  id: 'worker.cobra',
  description: "Access a worker's COBRA screen (open COBRA case required)",
  scope: 'entity',
  entityType: 'worker',
  component: 'sitespecific.bao',
  skipCache: true,

  describeRequirements: () => [
    { all: [{ permission: 'staff' }, { attribute: 'worker has an open COBRA case' }] },
    { all: [{ policy: 'worker.mine' }, { attribute: 'worker has an open COBRA case' }] },
  ],

  async evaluate(ctx: PolicyContext) {
    if (!ctx.entityId) {
      return { granted: false, reason: 'No worker specified' };
    }

    const isStaff = await ctx.hasPermission('staff');
    const isMine = isStaff ? false : await ctx.checkPolicy('worker.mine', ctx.entityId);
    if (!isStaff && !isMine) {
      return { granted: false, reason: 'No access to this worker' };
    }

    try {
      const hasCase = await ctx.storage.baoCobraCases.hasActiveCaseForCoveredPerson(
        ctx.entityId,
      );
      if (!hasCase) {
        return { granted: false, reason: 'No open COBRA case for this worker' };
      }
    } catch (error) {
      // Component tables not present (component disabled mid-flight, etc).
      return { granted: false, reason: 'COBRA is not available' };
    }

    return {
      granted: true,
      reason: isStaff ? 'Staff access with open COBRA case' : 'Own record with open COBRA case',
    };
  },
});

registerPolicy(policy);
export default policy;
