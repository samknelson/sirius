import { definePolicy, registerPolicy, type PolicyContext, type PolicyResult, type AccessCondition } from '../index';
import { alterHooks } from '../../alter';

export const commViewHook = alterHooks.declare<PolicyResult, PolicyContext, { requirements: AccessCondition[] }>({
  id: 'comm.view',
  description: 'Alter the core communication viewing decision',
  semantics: 'Read-only authorization. Preserve existing grants; verify stored relationships with fresh server-owned data. Failures deny access. Does not authorize writes.',
});

const policy = definePolicy({
  id: 'comm.view',
  description: 'View a communication record and its history',
  scope: 'entity',
  entityType: 'comm',
  skipCache: true,
  noAdminBypass: true,
  describeRequirements: () => [
    { permission: 'admin' },
    { permission: 'staff' },
    { permission: 'workers.comm' },
    ...alterHooks.implementations(commViewHook).flatMap(callback =>
      callback.metadata.requirements.map(requirement => ({
        all: [{ component: callback.component }, requirement],
      }))),
  ],
  async evaluate(ctx: PolicyContext) {
    if (!ctx.entityId) return { granted: false, reason: 'Communication ID required' };
    const granted = await ctx.hasAnyPermission(['admin', 'staff', 'workers.comm']);
    const result = granted
      // Let the read handler retain its existing 404 for a missing record.
      ? { granted: true, reason: 'Communication read permission' }
      : { granted: false, reason: 'No access to this communication' };
    try {
      return await alterHooks.run(commViewHook, result, ctx);
    } catch (error) {
      // Framework errors contain identities only, never callback/request data.
      console.error('Communication view alteration failed', error);
      return { granted: false, reason: 'No access to this communication' };
    }
  },
});

registerPolicy(policy);
export default policy;
