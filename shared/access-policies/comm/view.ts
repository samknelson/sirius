import { definePolicy, registerPolicy, type PolicyContext } from '../index';

type LinkedCommViewResolver = (commId: string, ctx: PolicyContext) => Promise<boolean>;
let linkedCommViewResolver: LinkedCommViewResolver | null = null;

/** Server-wired relationship check; shared/browser policy code never imports storage. */
export function setLinkedCommViewResolver(resolver: LinkedCommViewResolver | null): void {
  linkedCommViewResolver = resolver;
}

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
    { all: [{ component: 'edls' }, { attribute: 'can view a sheet linked to this communication' }] },
  ],
  async evaluate(ctx: PolicyContext) {
    if (!ctx.entityId) return { granted: false, reason: 'Communication ID required' };
    if (await ctx.hasAnyPermission(['admin', 'staff', 'workers.comm'])) {
      // Let the read handler retain its existing 404 for a missing record.
      return { granted: true, reason: 'Communication read permission' };
    }
    if (linkedCommViewResolver && await ctx.isComponentEnabled('edls')) {
      if (await linkedCommViewResolver(ctx.entityId, ctx)) {
        return { granted: true, reason: 'Can view a sheet linked to this communication' };
      }
    }
    return { granted: false, reason: 'No access to this communication' };
  },
});

registerPolicy(policy);
export default policy;
