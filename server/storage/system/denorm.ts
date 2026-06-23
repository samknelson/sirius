import { createNoopValidator } from '../utils/validation';
import { getClient } from '../transaction-context';
import {
  denorm,
  type Denorm,
  type InsertDenorm,
  type DenormStatus,
} from "@shared/schema";
import { eq, and, asc, sql, inArray } from "drizzle-orm";

/**
 * Stub validator - add validation logic here when needed.
 */
export const validate = createNoopValidator<InsertDenorm, Denorm>();

/**
 * Fields the caller supplies when recording a denorm status. `entityType` is a
 * plain plugin-defined string. `computedAt` / `staleAt` / `message` are
 * optional and default to NULL when omitted.
 */
export interface DenormStatusInput {
  entityId: string;
  entityType: string;
  configId: string;
  status: DenormStatus;
  computedAt?: Date | null;
  staleAt?: Date | null;
  message?: string | null;
}

/**
 * A single backfill seed: an (entity, config) pair to enqueue as `stale`.
 * `entityType` comes from the owning plugin. The storage method fills in the
 * status (`stale`), `stale_at` (now), and leaves `computed_at` / `message`
 * null.
 */
export interface DenormStaleSeed {
  entityId: string;
  entityType: string;
  configId: string;
}

/**
 * Per-config breakdown of denorm record counts by status. `total` is the sum
 * of the three status buckets (every denorm row has exactly one status).
 */
export interface DenormStatusCounts {
  ok: number;
  stale: number;
  error: number;
  total: number;
}

export interface DenormStorage {
  /** Read the denorm row for a single (entity, config) pair, if any. */
  get(entityId: string, configId: string): Promise<Denorm | undefined>;
  /** All denorm rows in a given status (e.g. `stale` for a recompute sweep). */
  listByStatus(status: DenormStatus): Promise<Denorm[]>;
  /**
   * Fetch up to `limit` `stale` denorm rows for a single config, oldest stale
   * first. This is the batch the recompute sweep (`recomputeStaleDenorm`) drains
   * each run; capping per run lets a large backlog drain over successive runs.
   */
  getStaleBatchForConfig(configId: string, limit: number): Promise<Denorm[]>;
  /**
   * Count denorm records grouped by status for a single plugin config. Uses a
   * grouped SQL aggregate (not an in-memory scan). Returns zeros for a config
   * with no records.
   */
  countByStatusForConfig(configId: string): Promise<DenormStatusCounts>;
  /**
   * Count denorm records grouped by status for every plugin config that has at
   * least one denorm row, keyed by `config_id`. One grouped SQL aggregate over
   * the whole table. Configs with no records are absent from the map.
   */
  countByStatusByConfig(): Promise<Record<string, DenormStatusCounts>>;
  /**
   * Upsert the status row for an (entity, config) pair, keyed by the unique
   * (entity_id, config_id) index. Creates the row on first write and overwrites
   * status / entity_type / timestamps / message on subsequent writes.
   */
  upsertStatus(input: DenormStatusInput): Promise<Denorm>;
  /**
   * Bulk-insert backfill seeds as `stale` rows, skipping any (entity, config)
   * pair that already has a row (`ON CONFLICT DO NOTHING` on the
   * (entity_id, config_id) unique index). Returns the number of rows actually
   * inserted. This is the enqueue half of the backfill sweep: it only ever
   * *adds* missing rows and never clobbers an existing row (e.g. a freshly
   * event-written `ok` row), so backfill stays idempotent.
   */
  insertStaleBatch(seeds: DenormStaleSeed[]): Promise<number>;
  /**
   * Delete denorm rows for a config whose entity ids are in `entityIds`,
   * returning the number of rows deleted. This is the widow-cleanup half of the
   * backfill sweep: it removes orphaned denorm rows whose underlying entity no
   * longer exists. Dependent payload rows (e.g. `worker_msh_denorm`) are removed
   * automatically by their `ON DELETE CASCADE` foreign key.
   */
  deleteByEntityIdsForConfig(configId: string, entityIds: string[]): Promise<number>;
  /**
   * Delete every denorm row for a single plugin config, returning the number of
   * rows deleted. This is the operator "clear" tool: it wipes a config's
   * precomputed status so the next backfill sweep re-enqueues all of its
   * entities as `stale`, forcing a full rebuild. Dependent payload rows (e.g.
   * `worker_msh_denorm`) are removed automatically by their `ON DELETE CASCADE`
   * foreign key. A config with no rows is a harmless no-op that returns 0.
   */
  clearForConfig(configId: string): Promise<number>;
}

export function createDenormStorage(): DenormStorage {
  return {
    async get(entityId: string, configId: string): Promise<Denorm | undefined> {
      const client = getClient();
      const [row] = await client
        .select()
        .from(denorm)
        .where(and(eq(denorm.entityId, entityId), eq(denorm.configId, configId)));
      return row || undefined;
    },

    async listByStatus(status: DenormStatus): Promise<Denorm[]> {
      const client = getClient();
      return client.select().from(denorm).where(eq(denorm.status, status));
    },

    async getStaleBatchForConfig(configId: string, limit: number): Promise<Denorm[]> {
      const client = getClient();
      return client
        .select()
        .from(denorm)
        .where(and(eq(denorm.configId, configId), eq(denorm.status, "stale")))
        .orderBy(asc(denorm.staleAt))
        .limit(limit);
    },

    async countByStatusForConfig(configId: string): Promise<DenormStatusCounts> {
      const client = getClient();
      const rows = await client
        .select({ status: denorm.status, count: sql<number>`count(*)::int` })
        .from(denorm)
        .where(eq(denorm.configId, configId))
        .groupBy(denorm.status);
      const counts: DenormStatusCounts = { ok: 0, stale: 0, error: 0, total: 0 };
      for (const row of rows) {
        counts[row.status] = row.count;
        counts.total += row.count;
      }
      return counts;
    },

    async countByStatusByConfig(): Promise<Record<string, DenormStatusCounts>> {
      const client = getClient();
      const rows = await client
        .select({
          configId: denorm.configId,
          status: denorm.status,
          count: sql<number>`count(*)::int`,
        })
        .from(denorm)
        .groupBy(denorm.configId, denorm.status);
      const result: Record<string, DenormStatusCounts> = {};
      for (const row of rows) {
        const bucket =
          result[row.configId] ??
          (result[row.configId] = { ok: 0, stale: 0, error: 0, total: 0 });
        bucket[row.status] = row.count;
        bucket.total += row.count;
      }
      return result;
    },

    async upsertStatus(input: DenormStatusInput): Promise<Denorm> {
      const client = getClient();
      const values: InsertDenorm = {
        entityId: input.entityId,
        entityType: input.entityType,
        configId: input.configId,
        status: input.status,
        computedAt: input.computedAt ?? null,
        staleAt: input.staleAt ?? null,
        message: input.message ?? null,
      };
      const [row] = await client
        .insert(denorm)
        .values(values)
        .onConflictDoUpdate({
          target: [denorm.entityId, denorm.configId],
          set: {
            entityType: values.entityType,
            status: values.status,
            computedAt: values.computedAt,
            staleAt: values.staleAt,
            message: values.message,
          },
        })
        .returning();
      return row;
    },

    async insertStaleBatch(seeds: DenormStaleSeed[]): Promise<number> {
      if (seeds.length === 0) return 0;
      const client = getClient();
      const now = new Date();
      const values: InsertDenorm[] = seeds.map((seed) => ({
        entityId: seed.entityId,
        entityType: seed.entityType,
        configId: seed.configId,
        status: "stale",
        computedAt: null,
        staleAt: now,
        message: null,
      }));
      const inserted = await client
        .insert(denorm)
        .values(values)
        .onConflictDoNothing({ target: [denorm.entityId, denorm.configId] })
        .returning({ id: denorm.id });
      return inserted.length;
    },

    async deleteByEntityIdsForConfig(configId: string, entityIds: string[]): Promise<number> {
      if (entityIds.length === 0) return 0;
      const client = getClient();
      const deleted = await client
        .delete(denorm)
        .where(and(eq(denorm.configId, configId), inArray(denorm.entityId, entityIds)))
        .returning({ id: denorm.id });
      return deleted.length;
    },

    async clearForConfig(configId: string): Promise<number> {
      const client = getClient();
      const result = await client
        .delete(denorm)
        .where(eq(denorm.configId, configId));
      return result.rowCount ?? 0;
    },
  };
}
