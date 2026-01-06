import { definePolicy, registerPolicy, type PolicyContext } from '../index';

const policy = definePolicy({
  id: 'file.delete',
  description: 'Delete files',
  scope: 'entity',
  entityType: 'file',
  
  describeRequirements: () => [
    { attribute: 'uploaded this file' },
    { permission: 'files.delete' },
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
    
    if (await ctx.hasPermission('files.delete')) {
      return { granted: true, reason: 'Has files.delete permission' };
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
    
    return { granted: false, reason: 'No delete access to this file' };
  },
});

registerPolicy(policy);
export default policy;
