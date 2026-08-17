/**
 * EA (entity-account association) cache helper.
 *
 * `getOrCreateEaCached` wraps `storage.ledger.ea.getOrCreate` with an
 * optional request-context cache keyed by `${entityType}:${entityId}:${accountId}`.
 *
 * During a bulk-upload run (inside `withChargeBatchCollector`) the
 * `ledgerEaCache` is pre-installed on the request context, so every call after
 * the first for a given (type, entity, account) triple is O(1) — no extra DB
 * round-trips. Outside that scope the cache is absent and the function falls
 * through to the normal `getOrCreate`.
 *
 * All callers — the charge executor and individual charge plugins — should use
 * this helper instead of calling `storage.ledger.ea.getOrCreate` directly.
 */
import { requestContext } from '../../../middleware/request-context.js';
import { storage } from '../../../storage/index.js';
import type { SelectLedgerEa } from '@shared/schema';

export async function getOrCreateEaCached(
  entityType: string,
  entityId: string,
  accountId: string,
): Promise<SelectLedgerEa> {
  const cacheKey = `${entityType}:${entityId}:${accountId}`;
  const cache = requestContext.getStore()?.ledgerEaCache;
  const cached = cache?.get(cacheKey);
  if (cached) return cached as SelectLedgerEa;

  const ea = await storage.ledger.ea.getOrCreate(entityType, entityId, accountId);
  cache?.set(cacheKey, ea);
  return ea;
}
