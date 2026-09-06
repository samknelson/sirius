import {
  snapshots,
  users,
  type Snapshot,
  type InsertSnapshot,
} from "@shared/schema";
import {
  snapshotRevisionFromValues,
  type SnapshotMeta,
} from "@shared/snapshots";
import { eq, and, desc, inArray, sql } from "drizzle-orm";
import { getClient } from "../transaction-context";
import { defineLoggingConfig } from "../middleware/logging";
import { getRequestContext } from "../../middleware/request-context";

/** The raw table these records live in, used by the audit logging config. */
const SNAPSHOTS_TABLE = "snapshots";

/**
 * Snapshots are process output, not user-maintained records, so their capture
 * provenance lives on the snapshot row rather than in entity metadata.
 */
export interface SnapshotProvenance {
  capturedAt: Date | null;
  /** Resolved from the account at read time, so a rename shows through. */
  capturedByName: string | null;
}

/** A full snapshot row (payload included) with the history the framework holds. */
export type SnapshotWithProvenance = Snapshot & SnapshotProvenance;

function personName(row: {
  firstName: string | null;
  lastName: string | null;
  email: string | null;
}): string | null {
  const part = (value: string | null) =>
    typeof value === "string" && value.trim() !== "" ? value.trim() : null;
  const full = [part(row.firstName), part(row.lastName)].filter(Boolean).join(" ");
  return full || part(row.email);
}

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
   * `capturedAt` orders WRITES. A caller that needs to place a snapshot
   * relative to a particular save should read the save's own identity out of
   * the captured bundle rather than infer it from this ordering.
   */
  listRecent(
    entityType: string,
    entityId: string,
    limit: number,
    offset?: number,
  ): Promise<SnapshotWithProvenance[]>;
  get(id: string): Promise<SnapshotWithProvenance | undefined>;
  delete(id: string): Promise<boolean>;
}

export function createSnapshotsStorage(): SnapshotsStorage {
  const provenanceColumns = {
    capturedAt: snapshots.capturedAt,
    capturedBy: snapshots.capturedBy,
    capturedByFirstName: users.firstName,
    capturedByLastName: users.lastName,
    capturedByEmail: users.email,
  };
  const newestFirst = [desc(snapshots.capturedAt), desc(snapshots.id)];

  return {
    async create(insertSnapshot: InsertSnapshot): Promise<Snapshot> {
      const client = getClient();
      const context = getRequestContext();
      const [row] = await client
        .insert(snapshots)
        .values({
          ...insertSnapshot,
          capturedAt: insertSnapshot.capturedAt ?? new Date(),
          capturedBy: insertSnapshot.capturedBy ?? context?.userId ?? null,
        })
        .returning();
      return row;
    },

    async listByEntity(entityType: string, entityId: string): Promise<SnapshotMeta[]> {
      const client = getClient();
      const rows = await client
        .select({
          id: snapshots.id,
          entityType: snapshots.entityType,
          entityId: snapshots.entityId,
          label: snapshots.label,
          revisionSeq: sql<string | null>`${snapshots.data}->'metadata'->>'seq'`,
          revisionRev: sql<string | null>`${snapshots.data}->'metadata'->>'rev'`,
          ...provenanceColumns,
        })
        .from(snapshots)
        .leftJoin(users, eq(users.id, snapshots.capturedBy))
        .where(and(eq(snapshots.entityType, entityType), eq(snapshots.entityId, entityId)))
        .orderBy(...newestFirst);
      return rows.map((row) => ({
        id: row.id,
        entityType: row.entityType,
        entityId: row.entityId,
        revision: snapshotRevisionFromValues(row.revisionSeq, row.revisionRev),
        label: row.label,
        capturedAt: row.capturedAt ? row.capturedAt.toISOString() : null,
        capturedByName: personName({
          firstName: row.capturedByFirstName,
          lastName: row.capturedByLastName,
          email: row.capturedByEmail,
        }),
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
        .orderBy(snapshots.entityId, ...newestFirst);
      return new Map(rows.map((row) => [row.entityId, row.id]));
    },

    async listRecent(
      entityType: string,
      entityId: string,
      limit: number,
      offset = 0,
    ): Promise<SnapshotWithProvenance[]> {
      const client = getClient();
      const rows = await client
        .select({
          id: snapshots.id,
          entityType: snapshots.entityType,
          entityId: snapshots.entityId,
          label: snapshots.label,
          data: snapshots.data,
          ...provenanceColumns,
        })
        .from(snapshots)
        .leftJoin(users, eq(users.id, snapshots.capturedBy))
        .where(
          and(eq(snapshots.entityType, entityType), eq(snapshots.entityId, entityId)),
        )
        .orderBy(...newestFirst)
        .limit(limit)
        .offset(offset);
      return rows.map(toSnapshotWithProvenance);
    },

    async get(id: string): Promise<SnapshotWithProvenance | undefined> {
      const client = getClient();
      const [row] = await client
        .select({
          id: snapshots.id,
          entityType: snapshots.entityType,
          entityId: snapshots.entityId,
          label: snapshots.label,
          data: snapshots.data,
           ...provenanceColumns,
        })
        .from(snapshots)
         .leftJoin(users, eq(users.id, snapshots.capturedBy))
        .where(eq(snapshots.id, id));
      return row ? toSnapshotWithProvenance(row) : undefined;
    },

    async delete(id: string): Promise<boolean> {
      const client = getClient();
      const result = await client.delete(snapshots).where(eq(snapshots.id, id)).returning();
      return result.length > 0;
    },
  };
}

/** A snapshot row with its own capture provenance. */
function toSnapshotWithProvenance(row: {
  id: string;
  entityType: string;
  entityId: string;
  label: string | null;
  data: unknown;
  capturedAt: Date;
  capturedBy: string | null;
  capturedByFirstName: string | null;
  capturedByLastName: string | null;
  capturedByEmail: string | null;
}): SnapshotWithProvenance {
  return {
    id: row.id,
    entityType: row.entityType,
    entityId: row.entityId,
    capturedBy: row.capturedBy,
    label: row.label,
    data: row.data,
    capturedAt: row.capturedAt,
    capturedByName: personName({
      firstName: row.capturedByFirstName,
      lastName: row.capturedByLastName,
      email: row.capturedByEmail,
    }),
  };
}

export const snapshotsLoggingConfig = defineLoggingConfig<SnapshotsStorage>({
  module: 'snapshots',
  table: SNAPSHOTS_TABLE,
  methods: {
    // The audit entry still names the captured entity; capture provenance is
    // stored on the snapshot row itself.
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
