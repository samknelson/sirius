import { registerCatalog, type CatalogValue } from '../catalog';
import { alterHooks } from './index';

export function registerAlterCatalog(): void {
  if (!alterHooks.isClosed()) throw new Error('Close alter registration before projecting its catalog');
  registerCatalog({
    id: 'alter-hooks',
    label: 'Alter Hooks',
    description: 'Code-defined extension points and their execution contracts.',
    audience: 'gated',
    viewPermission: 'admin',
    entries: () => alterHooks.declarations().map(hook => ({
      id: hook.id, name: hook.id, description: hook.description,
      detail: {
        semantics: hook.semantics,
        ordering: 'Ascending priority, then callback ID in code-point order',
        execution: 'Sequential awaited replacement values; no callbacks preserves the original value',
        errors: 'Abort and throw safe hook/callback identities; caller defines safe failure result',
      },
    })),
  });
  registerCatalog({
    id: 'alter-hook-implementations',
    label: 'Alter Hook Implementations',
    description: 'Component-owned implementations, ordered by hook and execution order.',
    audience: 'gated',
    viewPermission: 'admin',
    entries: () => [...alterHooks.declarations()]
      .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
      .flatMap(hook => alterHooks.implementations(hook).map(cb => ({
        id: cb.id, name: cb.id, description: cb.description,
        component: cb.component,
        detail: {
          hook: hook.id, priority: cb.priority,
          // Validated, copied and frozen JSON at registration; never executable data.
          metadata: cb.metadata as CatalogValue,
        },
      }))),
  });
}
