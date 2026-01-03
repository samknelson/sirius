import { definePolicy, registerPolicy, type PolicyContext } from '../../index';

async function evaluateLedgerEaAccess(ctx: PolicyContext): Promise<{ granted: boolean; reason: string }> {
  if (await ctx.hasPermission('staff')) {
    return { granted: true, reason: 'Staff access' };
  }
  
  if (!ctx.entityId) {
    return { granted: false, reason: 'No entity ID provided' };
  }

  const entityType = ctx.entityData?.entityType as string | undefined;
  const entityId = ctx.entityData?.entityId as string | undefined;
  
  if (!entityType || !entityId) {
    return { granted: false, reason: 'Entity type or ID not available' };
  }
  
  let policyId: string;
  switch (entityType) {
    case 'employer':
      policyId = 'employer.ledger';
      break;
    case 'worker':
      policyId = 'worker.ledger';
      break;
    case 'provider':
      policyId = 'provider.ledger';
      break;
    default:
      return { granted: false, reason: `Unsupported entity type: ${entityType}` };
  }
  
  const granted = await ctx.checkPolicy(policyId, entityId);
  return { granted, reason: granted ? `Access via ${policyId}` : `Denied by ${policyId}` };
}

const policy = definePolicy({
  id: 'ledger.ea.view',
  description: 'View ledger entity assignments - requires staff OR appropriate entity ledger policy',
  scope: 'entity',
  component: 'ledger',
  evaluate: evaluateLedgerEaAccess,
});

registerPolicy(policy);
export default policy;
