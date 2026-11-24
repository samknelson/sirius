import { commViewHook } from '@shared/access-policies/comm/view';
import { alterHooks } from '@shared/alter';

/** Register even when EDLS is off. The runner gates execution, not registration. */
export function registerEdlsCommViewAlter(): void {
  alterHooks.register(commViewHook, {
    id: 'edls.comm-view',
    description: 'Grant communication viewing to a viewer of an authoritatively linked sheet',
    component: 'edls',
    priority: 0,
    metadata: {
      requirements: [{ attribute: 'can view a sheet linked to this communication' }],
    },
    async alter(result, ctx) {
      if (result.granted) return result;
      if (!ctx.entityId || !await ctx.loadEntity('comm', ctx.entityId)) return result;
      const sheetIds: string[] = await ctx.storage.edlsAssignments.getSheetIdsByCommId(ctx.entityId);
      for (const sheetId of sheetIds) {
        const sheet = await ctx.loadEntity('edls_sheet', sheetId);
        if (!sheet) continue;
        // Fresh server-owned data also bypasses the delegated policy cache.
        // Never substitute ctx.entityData, which can originate with the caller.
        if (await ctx.checkPolicy('edls.sheet.view', sheetId, sheet)) {
          return { granted: true, reason: 'Can view a sheet linked to this communication' };
        }
      }
      return result;
    },
  });
}
