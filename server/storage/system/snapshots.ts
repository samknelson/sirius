import { snapshots, type Snapshot, type InsertSnapshot } from "@shared/schema";
import type { SnapshotMeta } from "@shared/snapshots";
import { eq, and, desc, inArray, lt } from "drizzle-orm";
import { getClient } from "../transaction-context";
import { defineLoggingConfig } from "../middleware/logging";

export interface SnapshotsStorage {
  create(snapshot: InsertSnapshot): Promise<Snapshot>;
  /** Metadata only (no data payload), newest first. */
  listByEntity(entityType: string, entityId: string): Promise<SnapshotMeta[]>;
  /**
   * Bulk "most recent snapshot id" lookup, keyed by entity id. Entities with
   * no snapshot at all are simply absent from the map — snapshots are only
   * captured on qualifying events, so having none is normal.
   */
  getLatestIdsByEntity(entityType: string, entityIds: string[]): Promise<Map<string, string>>;
  /**
   * One page of an entity's full snapshots (payload included), newest first:
   * `limit` rows starting at `offset`. Paging exists so a caller searching
   * backwards through history for a particular earlier state can walk it to
   * the end — a page that comes back short is the end — without holding the
   * whole history in memory at once.
   *
   * `created_at` orders WRITES. A caller that needs to place a snapshot
   * relative to a particular save should read the save's own identity out of
   * the captured bundle rather than infer it from this ordering.
   */
  listRecent(
    entityType: string,
    entityId: string,
    limit: number,
    offset?: number,
  ): Promise<Snapshot[]>;
  get(id: string): Promise<Snapshot | undefined>;
  delete(id: string): Promise<boolean>;
}

export function createSnapshotsStorage(): SnapshotsStorage {
  return {
    async create(insertSnapshot: InsertSnapshot): Promise<Snapshot> {
      const client = getClient();
      const [row] = await client.insert(snapshots).values(insertSnapshot).returning();
      return row;
    },

    async listByEntity(entityType: string, entityId: string): Promise<SnapshotMeta[]> {
      const client = getClient();
      const rows = await client
        .select({
          id: snapshots.id,
          entityType: snapshots.entityType,
          entityId: snapshots.entityId,
          createdAt: snapshots.createdAt,
          authorId: snapshots.authorId,
          authorName: snapshots.authorName,
          label: snapshots.label,
        })
        .from(snapshots)
        .where(and(eq(snapshots.entityType, entityType), eq(snapshots.entityId, entityId)))
        .orderBy(desc(snapshots.createdAt));
      return rows.map((row) => ({
        ...row,
        createdAt: row.createdAt.toISOString(),
      }));
    },

    async getLatestIdsByEntity(entityType: string, entityIds: string[]): Promise<Map<string, string>> {
      if (entityIds.length === 0) return new Map();
      const client = getClient();
      const rows = await client
        .selectDistinctOn([snapshots.entityId], {
          entityId: snapshots.entityId,
          id: snapshots.id,
        })
        .from(snapshots)
        .where(and(eq(snapshots.entityType, entityType), inArray(snapshots.entityId, entityIds)))
        .orderBy(snapshots.entityId, desc(snapshots.createdAt), desc(snapshots.id));
      return new Map(rows.map((row) => [row.entityId, row.id]));
    },

    async listRecent(
      entityType: string,
      entityId: string,
      limit: number,
      offset = 0,
    ): Promise<Snapshot[]> {
      const client = getClient();
      return client
        .select()
        .from(snapshots)
        .where(
          and(eq(snapshots.entityType, entityType), eq(snapshots.entityId, entityId)),
        )
        .orderBy(desc(snapshots.createdAt), desc(snapshots.id))
        .limit(limit)
        .offset(offset);
    },

    async get(id: string): Promise<Snapshot | undefined> {
      const client = getClient();
      const [row] = await client.select().from(snapshots).where(eq(snapshots.id, id));
      return row || undefined;
    },

    async delete(id: string): Promise<boolean> {
      const client = getClient();
      const result = await client.delete(snapshots).where(eq(snapshots.id, id)).returning();
      return result.length > 0;
    },
  };
}

export const snapshotsLoggingConfig = defineLoggingConfig<SnapshotsStorage>({
  module: 'snapshots',
  methods: {
    create: {
      state: { fallbackId: 'new snapshot' },
      getHostEntityId: (args, result) => result?.entityId || args[0]?.entityId,
      getDescription: async (args, result) => {
        const entityType = result?.entityType || args[0]?.entityType || 'unknown';
        const label = result?.label || args[0]?.label || '';
        return `Captured snapshot of ${entityType}${label ? ` [${label}]` : ''}`;
      },
    },
  },
});
