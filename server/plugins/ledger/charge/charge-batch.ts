/**
 * Process-scoped charge transaction collector and flush mechanism.
 *
 * PROBLEM: During a bulk upload, each `upsertWorkerHours` fires
 * `executeChargePlugins` synchronously, which by default creates one ledger
 * entry per row (EA getOrCreate + INSERT). For 500 rows this is hundreds of
 * serial DB round-trips that dominate the Process step runtime.
 *
 * SOLUTION: `withChargeBatchCollector` installs a `ChargeTransactionCollector`
 * on the request context. The charge executor detects the collector and pushes
 * transactions to it instead of writing them immediately. After the loop ends,
 * `flush()` resolves all EA records in parallel (O(K), K = unique employer-
 * account pairs, typically 1) then bulk-inserts every accumulated entry in one
 * statement.
 *
 * CORRECTNESS INVARIANTS:
 *
 * 1. Coalescing (last-writer-wins): The collector stores pending entries in a
 *    Map keyed by `${chargePlugin}::${chargePluginKey}`. When a second row
 *    produces a transaction for the same key (e.g. duplicate-SSN rows that hit
 *    the same ON CONFLICT worker_hours row), the new transaction silently
 *    replaces the old one. PostgreSQL's `ON CONFLICT DO UPDATE` constraint
 *    requires each conflict target to appear at most once per INSERT statement;
 *    coalescing prevents the cardinality-violation error that would cause the
 *    entire flush to be silently swallowed.
 *
 * 2. Collector-aware storage reads/deletes: Three `LedgerEntryStorage` methods
 *    (`getByChargePluginKey`, `getByReferenceAndConfig`, `delete`) consult the
 *    collector via the request context before querying the DB. This lets the
 *    BAO hourly plugin's existing delete logic see pending entries as if they
 *    existed in the DB — so when a duplicate-SSN row calls
 *    `deleteWorkerHours(h2)`, the plugin's `!expectedEntry && existingEntry`
 *    branch runs and cancels the pending h2 create via
 *    `entries.delete(syntheticId)`, preventing an orphaned ledger entry.
 *
 * 3. flush() runs inside `requestContext.run`: The collector is flushed inside
 *    the same async-local storage scope that holds the EA cache
 *    (`ledgerEaCache`), so the cache is still live and eliminates the
 *    per-triplet EA round-trips during flush.
 *
 * DELETE and adjustment paths are unaffected: the plugin calls
 * `storage.ledger.entries.delete` or pushes adjustment transactions directly —
 * those paths work correctly whether or not the entry is pending.
 */
import { requestContext } from '../../../middleware/request-context.js';
import { storage } from '../../../storage/index.js';
import { dateToYmd } from '@shared/utils/date';
import { logger } from '../../../logger.js';
import type { LedgerTransaction } from './types.js';
import type { InsertLedger, Ledger } from '@shared/schema';

/** A synthesised Ledger-like record returned for entries still pending in the
 * collector. Its id starts with "pending::" — which the patched `delete` method
 * recognises and routes to `cancelBySyntheticId`. */
export type PendingSyntheticLedger = Omit<Ledger, 'id' | 'eaId' | 'date' | 'statementYmd'> & {
  id: string;
  eaId: null;
  date: null;
  statementYmd: string;
};

interface PendingRecord {
  transaction: LedgerTransaction;
  syntheticId: string;
}

export class ChargeTransactionCollector {
  /** Map keyed by `${chargePlugin}::${chargePluginKey}` for O(1) coalescing. */
  private readonly _byKey = new Map<string, PendingRecord>();
  private _counter = 0;

  private _mapKey(chargePlugin: string, chargePluginKey: string): string {
    return `${chargePlugin}::${chargePluginKey}`;
  }

  /**
   * Add (or replace) a pending transaction. Last-writer-wins for the same
   * `(chargePlugin, chargePluginKey)` pair, preventing duplicate conflict
   * targets in the eventual bulk INSERT.
   */
  push(transaction: unknown): void {
    const t = transaction as LedgerTransaction;
    const mapKey = this._mapKey(t.chargePlugin, t.chargePluginKey);
    const existing = this._byKey.get(mapKey);
    const syntheticId = existing?.syntheticId ?? `pending::${++this._counter}`;
    this._byKey.set(mapKey, { transaction: t, syntheticId });
  }

  get size(): number {
    return this._byKey.size;
  }

  /**
   * If a transaction for this `(chargePlugin, chargePluginKey)` is pending,
   * return a synthetic `Ledger`-compatible record that the plugin's delete path
   * can treat as an existing DB entry. Returns `undefined` when no pending
   * record exists.
   */
  getPendingAsEntry(
    chargePlugin: string,
    chargePluginKey: string,
  ): PendingSyntheticLedger | undefined {
    const record = this._byKey.get(this._mapKey(chargePlugin, chargePluginKey));
    if (!record) return undefined;
    const t = record.transaction;
    return {
      id: record.syntheticId,
      chargePlugin: t.chargePlugin,
      chargePluginKey: t.chargePluginKey,
      chargePluginConfigId: t.chargePluginConfigId,
      amount: t.amount,
      eaId: null,
      referenceType: t.referenceType ?? null,
      referenceId: t.referenceId ?? null,
      date: null,
      memo: t.memo ?? null,
      data: t.metadata ?? null,
      statementYmd: t.statementYmd ?? dateToYmd(t.transactionDate ?? new Date()),
    };
  }

  /**
   * Return all pending synthetic entries whose `referenceId` and
   * `chargePluginConfigId` match — used by `getByReferenceAndConfig` so the
   * plugin's delete loop can find pending entries.
   */
  getPendingByReference(
    referenceId: string,
    chargePluginConfigId: string,
  ): PendingSyntheticLedger[] {
    const results: PendingSyntheticLedger[] = [];
    for (const record of this._byKey.values()) {
      const t = record.transaction;
      if (t.referenceId === referenceId && t.chargePluginConfigId === chargePluginConfigId) {
        results.push({
          id: record.syntheticId,
          chargePlugin: t.chargePlugin,
          chargePluginKey: t.chargePluginKey,
          chargePluginConfigId: t.chargePluginConfigId,
          amount: t.amount,
          eaId: null,
          referenceType: t.referenceType ?? null,
          referenceId: t.referenceId ?? null,
          date: null,
          memo: t.memo ?? null,
          data: t.metadata ?? null,
          statementYmd: t.statementYmd ?? dateToYmd(t.transactionDate ?? new Date()),
        });
      }
    }
    return results;
  }

  /**
   * Cancel a pending transaction by its synthetic id. Called by the patched
   * `storage.ledger.entries.delete` when it detects a "pending::" id prefix.
   * Returns `true` if a record was cancelled.
   */
  cancelBySyntheticId(id: string): boolean {
    for (const [key, record] of this._byKey.entries()) {
      if (record.syntheticId === id) {
        this._byKey.delete(key);
        return true;
      }
    }
    return false;
  }

  /**
   * Drain all queued transactions, resolve their EA records in parallel
   * (reusing the request-context `ledgerEaCache` when live), and bulk-insert
   * them in a single statement with `ON CONFLICT (chargePlugin, chargePluginKey)
   * DO UPDATE`. Soft-fails on error.
   */
  async flush(): Promise<void> {
    if (this._byKey.size === 0) return;
    const transactions = Array.from(this._byKey.values()).map(r => r.transaction);
    this._byKey.clear();

    try {
      // Unique (entityType, entityId, accountId) triplets.
      const eaKeyMap = new Map<
        string,
        { entityType: string; entityId: string; accountId: string }
      >();
      for (const t of transactions) {
        const key = `${t.entityType}:${t.entityId}:${t.accountId}`;
        if (!eaKeyMap.has(key)) {
          eaKeyMap.set(key, { entityType: t.entityType, entityId: t.entityId, accountId: t.accountId });
        }
      }

      // Resolve EAs in parallel; reuse the run-scoped ledgerEaCache when live.
      const cache = requestContext.getStore()?.ledgerEaCache;
      const eaIdMap = new Map<string, string>();

      await Promise.all(
        Array.from(eaKeyMap.entries()).map(async ([key, { entityType, entityId, accountId }]) => {
          const cached = cache?.get(key);
          if (cached) {
            eaIdMap.set(key, cached.id);
            return;
          }
          const ea = await storage.ledger.ea.getOrCreate(entityType, entityId, accountId);
          cache?.set(key, ea);
          eaIdMap.set(key, ea.id);
        }),
      );

      const now = new Date();
      const entries: InsertLedger[] = transactions.map((t) => {
        const eaKey = `${t.entityType}:${t.entityId}:${t.accountId}`;
        const eaId = eaIdMap.get(eaKey)!;
        const resolvedDate = t.transactionDate ?? now;
        return {
          chargePlugin: t.chargePlugin,
          chargePluginKey: t.chargePluginKey,
          chargePluginConfigId: t.chargePluginConfigId,
          amount: t.amount,
          eaId,
          referenceType: t.referenceType ?? 'charge_plugin',
          referenceId: t.referenceId,
          statementYmd: t.statementYmd ?? dateToYmd(resolvedDate),
          memo: t.memo !== undefined ? t.memo : t.description,
          data: t.metadata,
        };
      });

      await storage.ledger.entries.bulkCreate(entries);

      logger.info('ChargeTransactionCollector: flushed batch ledger entries', {
        service: 'charge-batch-collector',
        count: entries.length,
      });
    } catch (error) {
      // Soft-fail: matches the existing per-row createLedgerEntries behavior.
      logger.error('ChargeTransactionCollector: failed to flush ledger entries', {
        service: 'charge-batch-collector',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

/**
 * Run `fn` inside a process-scoped charge batch scope.
 *
 * - Installs a `ChargeTransactionCollector` as the `chargeTransactionSink` and
 *   a fresh `ledgerEaCache` on the current request context.
 * - The executor pushes transactions to the collector; the collector's
 *   `getByChargePluginKey` and `getByReferenceAndConfig` shims make pending
 *   entries visible to the plugin's own delete logic.
 * - `flush()` is invoked inside the `requestContext.run` callback (i.e. inside
 *   the same async scope as the run, so `ledgerEaCache` is still live), in a
 *   `finally` block so accumulated transactions are written even if `fn` throws.
 */
export async function withChargeBatchCollector<T>(fn: () => Promise<T>): Promise<T> {
  const collector = new ChargeTransactionCollector();
  const current = requestContext.getStore();
  const sink: RequestContext['chargeTransactionSink'] = {
    push: (t) => collector.push(t),
    getPendingAsEntry: (p, k) => collector.getPendingAsEntry(p, k),
    getPendingByReference: (r, c) => collector.getPendingByReference(r, c),
    cancelBySyntheticId: (id) => collector.cancelBySyntheticId(id),
  };
  const next: RequestContext = {
    ...(current ?? {}),
    chargeTransactionSink: sink,
    ledgerEaCache: current?.ledgerEaCache ?? new Map<string, { id: string }>(),
  };

  // Run fn AND flush inside the same requestContext.run scope so the EA cache
  // is live during flush (it is discarded once the run() callback returns).
  return requestContext.run(next, async () => {
    try {
      return await fn();
    } finally {
      await collector.flush();
    }
  });
}

// Import RequestContext type for the sink shape
import type { RequestContext } from '../../../middleware/request-context.js';
