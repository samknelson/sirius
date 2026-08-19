/**
 * s1_staging.id_map — the S1→S2 identity crosswalk shared by all loaders.
 *
 * Every loader that creates (or matches) an S2 row for an S1 entity records
 * it here; every downstream loader resolves references through it. `stub`
 * rows are minimal placeholders created by a dependent loader (e.g. T20
 * hours stubbing a worker in dev) — the entity's real loader later ENRICHES
 * the same S2 row instead of creating a duplicate.
 *
 * Sync columns (Task 292 — dual-run reconciliation, see lib/sync.ts):
 *   consumed_fingerprint  what the loader consumed for this row — the staged
 *                         content_hash for single-source loaders (kept
 *                         SQL-joinable against staging), or a combined hash
 *                         for composite inputs.
 *   logic_version         the loader's declared logic version at consume
 *                         time — bumping it forces reconciliation of every
 *                         row even when S1 content is unchanged.
 *   last_synced_at        when the row was last actually reconciled (NOT
 *                         merely fast-path-skipped).
 *   s1_deleted_at         stamped by the deletion sweep's `deactivate`
 *                         policy so re-sweeps are idempotent; cleared when a
 *                         fingerprint advances (the source reappeared).
 */
import { db } from "../../../server/storage/db";
import { sql } from "drizzle-orm";

export async function ensureIdMap(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS s1_staging.id_map (
      entity text NOT NULL,
      s1_id bigint NOT NULL,
      s2_id varchar NOT NULL,
      stub boolean NOT NULL DEFAULT false,
      loader text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      consumed_fingerprint text,
      logic_version integer,
      last_synced_at timestamptz,
      s1_deleted_at timestamptz,
      PRIMARY KEY (entity, s1_id)
    )
  `);
  // In-place upgrade of pre-sync id_map tables (s1_staging is outside the
  // drift gate; every loader calls ensureIdMap() first, so this suffices).
  await db.execute(sql`ALTER TABLE s1_staging.id_map ADD COLUMN IF NOT EXISTS consumed_fingerprint text`);
  await db.execute(sql`ALTER TABLE s1_staging.id_map ADD COLUMN IF NOT EXISTS logic_version integer`);
  await db.execute(sql`ALTER TABLE s1_staging.id_map ADD COLUMN IF NOT EXISTS last_synced_at timestamptz`);
  await db.execute(sql`ALTER TABLE s1_staging.id_map ADD COLUMN IF NOT EXISTS s1_deleted_at timestamptz`);
}

export interface MappingInfo {
  s2Id: string;
  stub: boolean;
  consumedFingerprint: string | null;
  logicVersion: number | null;
  lastSyncedAt: string | null;
  s1DeletedAt: string | null;
}

type RawMappingRow = {
  s1_id: string | number;
  s2_id: string;
  stub: boolean;
  consumed_fingerprint: string | null;
  logic_version: string | number | null;
  last_synced_at: string | Date | null;
  s1_deleted_at: string | Date | null;
};

function mapRow(row: RawMappingRow): MappingInfo {
  return {
    s2Id: row.s2_id,
    stub: row.stub,
    consumedFingerprint: row.consumed_fingerprint ?? null,
    logicVersion: row.logic_version == null ? null : Number(row.logic_version),
    lastSyncedAt: row.last_synced_at == null ? null : String(row.last_synced_at),
    s1DeletedAt: row.s1_deleted_at == null ? null : String(row.s1_deleted_at),
  };
}

const MAPPING_COLUMNS = sql`s1_id, s2_id, stub, consumed_fingerprint, logic_version, last_synced_at, s1_deleted_at`;

/** Bulk-resolve S1 ids for one entity type. Returns only the ids that exist. */
export async function getMappings(entity: string, s1Ids: number[]): Promise<Map<number, MappingInfo>> {
  const out = new Map<number, MappingInfo>();
  if (s1Ids.length === 0) return out;
  for (let i = 0; i < s1Ids.length; i += 500) {
    const chunk = s1Ids.slice(i, i + 500);
    const res = await db.execute(sql`
      SELECT ${MAPPING_COLUMNS} FROM s1_staging.id_map
       WHERE entity = ${entity} AND s1_id IN (${sql.join(chunk.map((n) => sql`${n}`), sql`, `)})
    `);
    for (const row of (res as unknown as { rows: RawMappingRow[] }).rows) {
      out.set(Number(row.s1_id), mapRow(row));
    }
  }
  return out;
}

/** ALL mappings for one entity type (used for lifecycle reconciliation). */
export async function getAllMappings(entity: string): Promise<Map<number, MappingInfo>> {
  const out = new Map<number, MappingInfo>();
  const res = await db.execute(sql`
    SELECT ${MAPPING_COLUMNS} FROM s1_staging.id_map WHERE entity = ${entity}
  `);
  for (const row of (res as unknown as { rows: RawMappingRow[] }).rows) {
    out.set(Number(row.s1_id), mapRow(row));
  }
  return out;
}

/** Remove a mapping (lifecycle remediation, e.g. reserved uids). */
/**
 * Clear consumed fingerprints so the next run reclassifies these rows as
 * changed and rewrites them through the standard update path (used by
 * degraded-state heal passes — e.g. re-resolving references once a
 * late-arriving mapping appears).
 */
export async function clearFingerprints(entity: string, s1Ids: number[]): Promise<void> {
  for (let i = 0; i < s1Ids.length; i += 500) {
    const batch = s1Ids.slice(i, i + 500);
    await db.execute(sql`
      UPDATE s1_staging.id_map SET consumed_fingerprint = NULL
       WHERE entity = ${entity} AND s1_id IN (${sql.join(batch.map((n) => sql`${n}`), sql`, `)})
    `);
  }
}

export async function deleteMapping(entity: string, s1Id: number): Promise<void> {
  await db.execute(sql`
    DELETE FROM s1_staging.id_map WHERE entity = ${entity} AND s1_id = ${s1Id}
  `);
}

/**
 * Record a mapping and return the WINNING s2_id. On conflict the existing
 * mapping wins — a caller that created an S2 row and lost the race must use
 * the returned id (its own row is an orphan; callers should log that).
 *
 * Sync-aware loaders pass `fingerprint`/`logicVersion` so a NEW mapping is
 * stamped as consumed at insert time (the S2 write happens immediately
 * before). On conflict the winner's sync state is retained untouched.
 */
export async function putMapping(
  entity: string,
  s1Id: number,
  s2Id: string,
  opts: { stub: boolean; loader: string; fingerprint?: string | null; logicVersion?: number },
): Promise<string> {
  const stamped = opts.fingerprint !== undefined || opts.logicVersion !== undefined;
  const res = await db.execute(sql`
    INSERT INTO s1_staging.id_map (entity, s1_id, s2_id, stub, loader, consumed_fingerprint, logic_version, last_synced_at)
    VALUES (${entity}, ${s1Id}, ${s2Id}, ${opts.stub}, ${opts.loader},
            ${opts.fingerprint ?? null}, ${opts.logicVersion ?? null}, ${stamped ? sql`now()` : sql`NULL`})
    ON CONFLICT (entity, s1_id) DO UPDATE SET entity = id_map.entity
    RETURNING s2_id
  `);
  const rows = (res as unknown as { rows: Array<{ s2_id: string }> }).rows;
  return rows[0]?.s2_id ?? s2Id;
}

/**
 * Bulk putMapping for mass-adoption paths (e.g. first converted t18 run
 * adopting ~547K pre-sync ledger rows): multi-VALUES INSERT, ON CONFLICT the
 * existing mapping wins untouched. Every row is stamped as consumed at
 * insert (fingerprint/logicVersion/last_synced_at) — callers only enqueue
 * rows whose S2 state is verified-desired at enqueue time. Unlike
 * putMapping, the winner s2_id is NOT returned — bulk callers must not need
 * it (they resolve identity through the S2 row itself, not the mapping).
 */
export async function putMappings(
  entity: string,
  rows: Array<{ s1Id: number; s2Id: string; fingerprint: string | null }>,
  opts: { loader: string; logicVersion: number },
): Promise<void> {
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const values = chunk.map(
      (r) => sql`(${entity}, ${r.s1Id}, ${r.s2Id}, false, ${opts.loader}, ${r.fingerprint}, ${opts.logicVersion}, now())`,
    );
    await db.execute(sql`
      INSERT INTO s1_staging.id_map (entity, s1_id, s2_id, stub, loader, consumed_fingerprint, logic_version, last_synced_at)
      VALUES ${sql.join(values, sql`, `)}
      ON CONFLICT (entity, s1_id) DO NOTHING
    `);
  }
}

/** Mark a stub mapping as absorbed by the entity's real loader (stub=false). */
export async function markAbsorbed(entity: string, s1Id: number, loader: string): Promise<void> {
  await db.execute(sql`
    UPDATE s1_staging.id_map SET stub = false, loader = ${loader}
     WHERE entity = ${entity} AND s1_id = ${s1Id} AND stub = true
  `);
}

/**
 * Batch-advance consumed fingerprints AFTER the S2 write landed and the
 * verify target is established — failed writes stay retryable because their
 * fingerprints were never advanced. Also clears s1_deleted_at (the source is
 * demonstrably present again) and stamps last_synced_at.
 */
export async function advanceFingerprints(
  entity: string,
  rows: Array<{ s1Id: number; fingerprint: string | null }>,
  logicVersion: number,
): Promise<void> {
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const values = chunk.map((r) => sql`(${r.s1Id}::bigint, ${r.fingerprint}::text)`);
    await db.execute(sql`
      UPDATE s1_staging.id_map m
         SET consumed_fingerprint = v.fp,
             logic_version = ${logicVersion},
             last_synced_at = now(),
             s1_deleted_at = NULL
        FROM (VALUES ${sql.join(values, sql`, `)}) AS v(s1_id, fp)
       WHERE m.entity = ${entity} AND m.s1_id = v.s1_id
    `);
  }
}

/**
 * Retarget an existing mapping to a different S2 row (S1-wins remap: the
 * changed source now resolves elsewhere, e.g. a policy node retitled onto a
 * different configured policy). Does NOT advance the fingerprint — callers
 * advance after their verify target is established.
 */
export async function remapMapping(entity: string, s1Id: number, newS2Id: string, loader: string): Promise<void> {
  await db.execute(sql`
    UPDATE s1_staging.id_map SET s2_id = ${newS2Id}, loader = ${loader}
     WHERE entity = ${entity} AND s1_id = ${s1Id}
  `);
}

/** Stamp a mapping as source-deleted (deactivate sweeps — idempotence marker). */
export async function markSourceDeleted(entity: string, s1Id: number): Promise<void> {
  await db.execute(sql`
    UPDATE s1_staging.id_map SET s1_deleted_at = now()
     WHERE entity = ${entity} AND s1_id = ${s1Id} AND s1_deleted_at IS NULL
  `);
}
