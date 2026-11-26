import { definePolicy, registerPolicy, type PolicyContext } from '../index';
import { alterHooks } from "../../alter";

export const employerViewExtensionHook = alterHooks.declare<boolean, { context: PolicyContext }>({
  id: "employer.view.extend",
  description: "Extend employer read access after the core policy denies",
  semantics: "Read-only grant extension. Default denies. Errors propagate and refuse access. Component availability is checked before invocation.",
});

const policy = definePolicy({
  id: 'employer.view',
  description: 'View employer details',
  scope: 'entity',
  entityType: 'employer',
  
  describeRequirements: () => [
    { permission: 'staff' },
    { policy: 'employer.mine' },
    { all: [{ permission: 'worker' }, { attribute: 'has employment history at employer' }] }
  ],
  
  async evaluate(ctx: PolicyContext) {
    if (await ctx.hasPermission('staff')) {
      return { granted: true, reason: 'Staff access' };
    }
    
    if (await ctx.checkPolicy('employer.mine', ctx.entityId)) {
      return { granted: true, reason: 'Associated with this employer' };
    }
    
    if (await ctx.hasPermission('worker')) {
      const userWorker = await ctx.getUserWorker();
      if (userWorker) {
        const workerHours = await ctx.storage.workerHours?.getWorkerHours?.(userWorker.id);
        if (workerHours?.some((wh: any) => wh.employerId === ctx.entityId)) {
          return { granted: true, reason: 'Has employment history at this employer' };
        }
      }
    }
    
    const granted = await alterHooks.run(employerViewExtensionHook, false, { context: ctx });
    return { granted, reason: granted ? "Component employer access" : 'No access to this employer' };
  },
});

registerPolicy(policy);
export default policy;
