import { definePolicy, registerPolicy, type PolicyContext } from '../index';

/**
 * Injected resolver for files owned by the generic entity-files framework
 * (entityType `entity-files:<context>`). The server wires this at boot
 * (server/services/entity-files/file-read-access.ts) so this shared module
 * never imports server code.
 *
 * For entity-files files this resolver is AUTHORITATIVE: the generic
 * uploader / staff / files.read-private shortcuts do not apply, so access
 * is exactly what the context's own view callback grants — no weaker and
 * no stricter than the retired /api/entity-files download route. When the
 * resolver is unset (client bundle, standalone script) evaluation fails
 * closed.
 */
export type EntityFilesReadAccessResolver = (
  contextId: string,
  entityId: string,
  ctx: PolicyContext,
) => Promise<boolean>;

let entityFilesReadAccessResolver: EntityFilesReadAccessResolver | null = null;

export function setEntityFilesReadAccessResolver(
  resolver: EntityFilesReadAccessResolver,
): void {
  entityFilesReadAccessResolver = resolver;
}

const ENTITY_FILES_PREFIX = 'entity-files:';

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
    
    const fileEntityType = (file as any).entityType as string | null;
    const fileEntityId = (file as any).entityId as string | null;

    // Entity-files attachments: the owning context's access callback is the
    // single authority (mirrors the retired per-context download route).
    // Generic shortcuts below must NOT bypass it; unset resolver fails closed.
    if (fileEntityType?.startsWith(ENTITY_FILES_PREFIX)) {
      const contextId = fileEntityType.slice(ENTITY_FILES_PREFIX.length);
      if (!entityFilesReadAccessResolver || !fileEntityId) {
        return { granted: false, reason: 'Entity-files access resolver unavailable' };
      }
      const granted = await entityFilesReadAccessResolver(contextId, fileEntityId, ctx);
      return granted
        ? { granted: true, reason: `Has view access to ${contextId} files` }
        : { granted: false, reason: `No view access to ${contextId} files` };
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

      if (entityType === 'wizard') {
        const wizard = await ctx.storage.wizards?.getById?.(entityId);
        if (wizard?.entityId) {
          const hasWizardAccess = await ctx.checkPolicy('employer.mine', wizard.entityId);
          if (hasWizardAccess) {
            return { granted: true, reason: 'Has access to associated wizard' };
          }
        }
      }
    }
    
    return { granted: false, reason: 'No access to this file' };
  },
});

registerPolicy(policy);
export default policy;
