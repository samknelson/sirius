import { snapshots, type Snapshot, type InsertSnapshot } from "@shared/schema";
import type { SnapshotMeta } from "@shared/snapshots";
import { eq, and, desc } from "drizzle-orm";
import { getClient } from "../transaction-context";
import { defineLoggingConfig } from "../middleware/logging";

export interface SnapshotsStorage {
  create(snapshot: InsertSnapshot): Promise<Snapshot>;
  /** Metadata only (no data payload), newest first. */
  listByEntity(entityType: string, entityId: string): Promise<SnapshotMeta[]>;
  get(id: string): Promise<Snapshot | undefined>;
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

    async get(id: string): Promise<Snapshot | undefined> {
      const client = getClient();
      const [row] = await client.select().from(snapshots).where(eq(snapshots.id, id));
      return row || undefined;
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
