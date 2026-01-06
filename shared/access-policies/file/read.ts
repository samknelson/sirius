import { definePolicy, registerPolicy, type PolicyContext } from '../index';

const policy = definePolicy({
  id: 'file.read',
  description: 'Download files',
  scope: 'entity',
  entityType: 'file',
  
  describeRequirements: () => [
    { attribute: 'uploaded this file' },
    { permission: 'staff' },
    { permission: 'files.read-private' },
    { attribute: 'has view access to associated entity' }
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
    
    if (await ctx.hasPermission('staff')) {
      return { granted: true, reason: 'Staff access' };
    }
    
    if (await ctx.hasPermission('files.read-private')) {
      return { granted: true, reason: 'Has files.read-private permission' };
    }
    
    const entityType = (file as any).entityType;
    const entityId = (file as any).entityId;
    
    if (entityType && entityId) {
      const policyMap: Record<string, string> = {
        worker: 'worker.view',
        employer: 'employer.view',
        cardcheck: 'cardcheck.view',
      };
      
      const targetPolicy = policyMap[entityType];
      if (targetPolicy) {
        const hasAccess = await ctx.checkPolicy(targetPolicy, entityId);
        if (hasAccess) {
          return { granted: true, reason: `Has view access to associated ${entityType}` };
        }
      }
    }
    
    return { granted: false, reason: 'No access to this file' };
  },
});

registerPolicy(policy);
export default policy;
