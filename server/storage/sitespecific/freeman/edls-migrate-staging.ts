import { getClient } from "../../transaction-context";
import { asc, eq, getTableName, notInArray, sql } from "drizzle-orm";
import { tableExists as tableExistsUtil } from "../../utils";
import {
  sitespecificFreemanEdlsMigrate,
  type FreemanEdlsMigrateRow,
} from "../../../../shared/schema/sitespecific/freeman/edls-migrate-schema";

export type { FreemanEdlsMigrateRow };

/** One legacy row, as fetched: column name to value, nothing interpreted. */
export type LegacyRow = Record<string, unknown>;

/**
 * What a staged sheet's `data` holds. Written in two passes — the node sweep
 * fills `node`, the field sweep fills `fields` — so either may be absent, and
 * the timestamps say which pass a row last went through.
 */
export interface StagedSheetData {
  node?: LegacyRow;
  nodeFetchedAt?: string;
  /** Legacy field table name -> its rows for this node, deltas and all. */
  fields?: Record<string, LegacyRow[]>;
  fieldsFetchedAt?: string;
}

export interface StagedNodeInput {
  nid: string;
  type: string;
  node: LegacyRow;
}

export interface FreemanEdlsMigrateStagingStorage {
  tableExists(): Promise<boolean>;
  /** Every staged row, oldest legacy node first. */
  listAll(): Promise<FreemanEdlsMigrateRow[]>;
  /** Just the staged node ids — what the field sweep filters legacy rows against. */
  listNids(): Promise<string[]>;
  count(): Promise<number>;
  /**
   * Store fetched nodes, keyed on the legacy nid. Re-running a sweep updates
   * in place; previously fetched field rows survive (the field sweep replaces
   * those) because the node pass merges into `data` rather than replacing it.
   */
  upsertNodes(records: StagedNodeInput[]): Promise<number>;
  /**
   * Drop every staged row whose nid is not in `nids`. An empty list empties the
   * table: "the legacy system has no sheets" is an answer, not a no-op.
   */
  deleteNidsNotIn(nids: string[]): Promise<number>;
  /**
   * Replace the field rows staged for one node. Whole-value replacement, not a
   * merge: a field table that no longer returns rows for this node must end up
   * absent, not linger from the previous sweep.
   */
  setFieldRows(nid: string, fields: Record<string, LegacyRow[]>): Promise<boolean>;
  /** Empty the staging table. Returns how many rows went. */
  deleteAll(): Promise<number>;
}

const tableName = getTableName(sitespecificFreemanEdlsMigrate);

function requireTable(exists: boolean): void {
  if (!exists) {
    throw new Error("COMPONENT_TABLE_NOT_FOUND");
  }
}

export function createFreemanEdlsMigrateStagingStorage(): FreemanEdlsMigrateStagingStorage {
  return {
    async tableExists(): Promise<boolean> {
      return tableExistsUtil(tableName);
    },

    async listAll(): Promise<FreemanEdlsMigrateRow[]> {
      requireTable(await this.tableExists());
      const client = getClient();
      // nid is the legacy system's numeric id kept as text; sort it as a
      // number so 9 comes before 10 in the inspection list.
      return client
        .select()
        .from(sitespecificFreemanEdlsMigrate)
        .orderBy(
          asc(sql`
            CASE WHEN ${sitespecificFreemanEdlsMigrate.nid} ~ '^[0-9]+$'
              THEN (${sitespecificFreemanEdlsMigrate.nid})::bigint
              ELSE NULL
            END
          `),
          asc(sitespecificFreemanEdlsMigrate.nid),
        );
    },

    async listNids(): Promise<string[]> {
      requireTable(await this.tableExists());
      const client = getClient();
      const rows = await client
        .select({ nid: sitespecificFreemanEdlsMigrate.nid })
        .from(sitespecificFreemanEdlsMigrate);
      return rows.map((r) => r.nid);
    },

    async count(): Promise<number> {
      requireTable(await this.tableExists());
      const client = getClient();
      const rows = await client
        .select({ value: sql<number>`count(*)::int` })
        .from(sitespecificFreemanEdlsMigrate);
      return rows[0]?.value ?? 0;
    },

    async upsertNodes(records: StagedNodeInput[]): Promise<number> {
      if (records.length === 0) return 0;
      requireTable(await this.tableExists());
      const client = getClient();
      const fetchedAt = new Date().toISOString();

      let written = 0;
      // Chunked so a large sweep doesn't build one enormous statement.
      const chunkSize = 200;
      for (let i = 0; i < records.length; i += chunkSize) {
        const chunk = records.slice(i, i + chunkSize);
        const values = chunk.map((record) => ({
          nid: record.nid,
          type: record.type,
          data: { node: record.node, nodeFetchedAt: fetchedAt } satisfies StagedSheetData,
        }));
        const result = await client
          .insert(sitespecificFreemanEdlsMigrate)
          .values(values)
          .onConflictDoUpdate({
            target: sitespecificFreemanEdlsMigrate.nid,
            set: {
              type: sql`excluded.type`,
              // Merge, so the field rows staged for this node survive a
              // repeated node sweep; `node` itself is replaced.
              data: sql`coalesce(${sitespecificFreemanEdlsMigrate.data}, '{}'::jsonb) || excluded.data`,
            },
          })
          .returning({ id: sitespecificFreemanEdlsMigrate.id });
        written += result.length;
      }
      return written;
    },

    async deleteNidsNotIn(nids: string[]): Promise<number> {
      requireTable(await this.tableExists());
      const client = getClient();
      if (nids.length === 0) {
        // Nothing belongs here any more. A completed sweep that found no
        // sheets is a statement about the legacy system, not a missing answer.
        const emptied = await client
          .delete(sitespecificFreemanEdlsMigrate)
          .returning({ id: sitespecificFreemanEdlsMigrate.id });
        return emptied.length;
      }
      const result = await client
        .delete(sitespecificFreemanEdlsMigrate)
        .where(notInArray(sitespecificFreemanEdlsMigrate.nid, nids))
        .returning({ id: sitespecificFreemanEdlsMigrate.id });
      return result.length;
    },

    async setFieldRows(nid: string, fields: Record<string, LegacyRow[]>): Promise<boolean> {
      requireTable(await this.tableExists());
      const client = getClient();
      const payload = JSON.stringify({
        fields,
        fieldsFetchedAt: new Date().toISOString(),
      });
      const result = await client
        .update(sitespecificFreemanEdlsMigrate)
        .set({
          data: sql`coalesce(${sitespecificFreemanEdlsMigrate.data}, '{}'::jsonb) || ${payload}::jsonb`,
        })
        .where(eq(sitespecificFreemanEdlsMigrate.nid, nid))
        .returning({ id: sitespecificFreemanEdlsMigrate.id });
      return result.length > 0;
    },

    async deleteAll(): Promise<number> {
      requireTable(await this.tableExists());
      const client = getClient();
      const result = await client
        .delete(sitespecificFreemanEdlsMigrate)
        .returning({ id: sitespecificFreemanEdlsMigrate.id });
      return result.length;
    },
  };
}
