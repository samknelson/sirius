import { definePolicy, registerPolicy, type PolicyContext } from '../index';
// The one shared reading of "this relation type is the domestic partner"
// (a type naming the partner's CHILD is not) — the same predicate DP billing
// and the DP payment gate price with.
import { isDpRelationTypeName } from '../../sitespecific/bao/dp-relation-types';

/**
 * Access to a worker's Domestic Partner (DP) screen.
 *
 * Granted when the viewer can see the worker record (staff, or the worker
 * viewing their own record) AND the worker has at least one trust election
 * that covers a domestic-partner dependent. The existence requirement means
 * the DP tab simply does not appear for workers with no DP enrollment — for
 * staff too, keeping the tab strip meaningful.
 *
 * skipCache: visibility flips the moment a DP is added to or removed from an
 * election, so the result must not be cached against stale election state.
 */
const policy = definePolicy({
  id: 'worker.dp',
  description: "Access a worker's Domestic Partner screen (DP-covered election required)",
  scope: 'entity',
  entityType: 'worker',
  component: 'sitespecific.bao',
  skipCache: true,

  describeRequirements: () => [
    { all: [{ permission: 'staff' }, { attribute: 'worker has an election covering a domestic partner' }] },
    { all: [{ policy: 'worker.mine' }, { attribute: 'worker has an election covering a domestic partner' }] },
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
      const elections = await ctx.storage.workerTrustElections.listByWorker(ctx.entityId);
      const relationshipIds = new Set<string>();
      for (const election of elections) {
        for (const relId of election.relationshipIds ?? []) {
          relationshipIds.add(relId);
        }
      }
      if (relationshipIds.size === 0) {
        return { granted: false, reason: 'No domestic partner enrollment for this worker' };
      }
      const relations = await ctx.storage.workerRelations.listByIdsWithType(
        Array.from(relationshipIds),
      );
      const hasDp = relations.some((rel: { relationTypeName: string | null }) =>
        isDpRelationTypeName(rel.relationTypeName),
      );
      if (!hasDp) {
        return { granted: false, reason: 'No domestic partner enrollment for this worker' };
      }
    } catch (error) {
      // Component tables not present (component disabled mid-flight, etc).
      return { granted: false, reason: 'Domestic partner information is not available' };
    }

    return {
      granted: true,
      reason: isStaff
        ? 'Staff access with DP-covered election'
        : 'Own record with DP-covered election',
    };
  },
});

registerPolicy(policy);
export default policy;
