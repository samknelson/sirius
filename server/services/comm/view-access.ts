import { setLinkedCommViewResolver } from '@shared/access-policies/comm/view';
import { registerEntityLoader } from '../access-policy-evaluator';
import { logger } from '../../logger';

export function wireCommViewAccess(): void {
  registerEntityLoader('comm', async (id, storage) => (await storage.comm.getComm(id)) ?? null);
  setLinkedCommViewResolver(async (commId, ctx) => {
    try {
      // Defensive gate before any optional-component table is queried.
      if (!await ctx.isComponentEnabled('edls')) return false;
      if (!await ctx.loadEntity('comm', commId)) return false;
      const sheetIds: string[] = await ctx.storage.edlsAssignments.getSheetIdsByCommId(commId);
      for (const sheetId of sheetIds) {
        const sheet = await ctx.loadEntity('edls_sheet', sheetId);
        if (!sheet) continue;
        // Supplying freshly loaded, server-owned data bypasses the delegated
        // policy cache too. Never pass the caller's entityData as sheet data.
        if (await ctx.checkPolicy('edls.sheet.view', sheetId, sheet)) return true;
      }
      return false;
    } catch (error) {
      logger.error('Failed to resolve communication view access', {
        service: 'comm-view-access',
        commId,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  });
}
