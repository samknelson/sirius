import { definePolicy, registerPolicy, type PolicyContext } from '../index';

const policy = definePolicy({
  id: 'file.update',
  description: 'Update file details',
  scope: 'entity',
  entityType: 'file',
  
  describeRequirements: () => [
    { attribute: 'uploaded this file' },
    { permission: 'files.update' },
    { attribute: 'has edit access to associated entity' }
  ],
  
  async evaluate(ctx: PolicyContext) {
    const file = await ctx.loadEntity('file', ctx.entityId!);
    if (!file) {
      return { granted: false, reason: 'File not found' };
    }
    
    const userContact = await ctx.getUserContact();
    if (userContact && (file as any).uploadedBy === userContact.id) {
      return { granted: true, reason: 'File uploader' };
    }
    
    if (await ctx.hasPermission('files.update')) {
      return { granted: true, reason: 'Has files.update permission' };
    }
    
    const entityType = (file as any).entityType;
    const entityId = (file as any).entityId;
    
    if (entityType && entityId) {
      const policyMap: Record<string, string> = {
        worker: 'worker.edit',
        employer: 'employer.mine',
        cardcheck: 'cardcheck.edit',
      };
      
      const targetPolicy = policyMap[entityType];
      if (targetPolicy) {
        const hasAccess = await ctx.checkPolicy(targetPolicy, entityId);
        if (hasAccess) {
          return { granted: true, reason: `Has edit access to associated ${entityType}` };
        }
      }
    }
    
    return { granted: false, reason: 'No update access to this file' };
  },
});

registerPolicy(policy);
export default policy;
