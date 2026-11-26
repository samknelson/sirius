import { definePolicy, registerPolicy, type PolicyContext } from '../../../../../../shared/access-policies/index';

// Viewing the management controls must not grant the broader manage capability
// used by supervisor reassignment.
const policy = definePolicy({
  id: 'edls.sheet.manage_view',
  description: 'View EDLS sheet management actions',
  scope: 'entity',
  entityType: 'edls_sheet',
  component: 'edls',
  skipCache: true,
  describeRequirements: () => [
    { permission: 'admin' },
    { permission: 'edls.manager' },
    { permission: 'edls.coordinator' },
    { permission: 'edls.worker.advisor', condition: 'non-scheduled sheets' },
    { permission: 'edls.supervisor', condition: 'sheets where user is assigned supervisor' },
  ],
  async evaluate(ctx: PolicyContext) {
    if (await ctx.checkPolicy('edls.sheet.manage', ctx.entityId)) {
      return { granted: true, reason: 'User can manage sheet' };
    }
    if (await ctx.hasPermission('edls.supervisor')) {
      const sheet = await ctx.loadEntity('edls_sheet', ctx.entityId!);
      if (sheet && (sheet as any).supervisor === ctx.user?.id) {
        return { granted: true, reason: 'Supervisor can view actions for their assigned sheet' };
      }
    }
    return { granted: false, reason: 'No permission to view sheet management' };
  },
});

registerPolicy(policy);
export default policy;
