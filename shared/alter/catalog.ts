import { registerCatalog, type CatalogEntry, type CatalogValue } from '../catalog';
import { alterHooks } from './index';

export function registerAlterCatalog(): void {
  if (!alterHooks.isClosed()) throw new Error('Close alter registration before projecting its catalog');
  registerCatalog({
    id: 'alter-hooks',
    label: 'Alter Hooks',
    description: 'Code-defined extension points and their ordered component implementations.',
    audience: 'gated',
    viewPermission: 'admin',
    entries: () => alterHooks.declarations().flatMap(hook => {
      const entries: CatalogEntry[] = [{
        id: `hook:${hook.id}`, name: hook.id, description: hook.description,
        detail: {
          type: 'hook', semantics: hook.semantics,
          ordering: 'Ascending priority, then callback ID in code-point order',
          execution: 'Sequential awaited replacement values; no callbacks preserves the original value',
          errors: 'Abort and throw safe hook/callback identities; caller defines safe failure result',
        },
      }];
      for (const cb of alterHooks.implementations(hook)) {
        entries.push({
          id: `callback:${cb.id}`, name: cb.id, description: cb.description,
          component: cb.component,
          detail: {
            type: 'callback', hook: hook.id, owner: cb.component, priority: cb.priority,
            // Validated, copied and frozen JSON at registration; never executable data.
            metadata: cb.metadata as CatalogValue,
          },
        });
      }
      return entries;
    }),
  });
}
