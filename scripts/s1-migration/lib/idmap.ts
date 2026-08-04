/**
 * s1_staging.id_map — the S1→S2 identity crosswalk shared by all loaders.
 *
 * Every loader that creates (or matches) an S2 row for an S1 entity records
 * it here; every downstream loader resolves references through it. `stub`
 * rows are minimal placeholders created by a dependent loader (e.g. T20
 * hours stubbing a worker in dev) — the entity's real loader later ENRICHES
 * the same S2 row instead of creating a duplicate.
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
      PRIMARY KEY (entity, s1_id)
    )
  `);
}

/** Bulk-resolve S1 ids for one entity type. Returns only the ids that exist. */
export async function getMappings(
  entity: string,
  s1Ids: number[],
): Promise<Map<number, { s2Id: string; stub: boolean }>> {
  const out = new Map<number, { s2Id: string; stub: boolean }>();
  if (s1Ids.length === 0) return out;
  for (let i = 0; i < s1Ids.length; i += 500) {
    const chunk = s1Ids.slice(i, i + 500);
    const res = await db.execute(sql`
      SELECT s1_id, s2_id, stub FROM s1_staging.id_map
       WHERE entity = ${entity} AND s1_id IN (${sql.join(chunk.map((n) => sql`${n}`), sql`, `)})
    `);
    for (const row of (res as unknown as { rows: Array<{ s1_id: string | number; s2_id: string; stub: boolean }> }).rows) {
      out.set(Number(row.s1_id), { s2Id: row.s2_id, stub: row.stub });
    }
  }
  return out;
}

/**
 * Record a mapping and return the WINNING s2_id. On conflict the existing
 * mapping wins — a caller that created an S2 row and lost the race must use
 * the returned id (its own row is an orphan; callers should log that).
 */
export async function putMapping(
  entity: string,
  s1Id: number,
  s2Id: string,
  opts: { stub: boolean; loader: string },
): Promise<string> {
  const res = await db.execute(sql`
    INSERT INTO s1_staging.id_map (entity, s1_id, s2_id, stub, loader)
    VALUES (${entity}, ${s1Id}, ${s2Id}, ${opts.stub}, ${opts.loader})
    ON CONFLICT (entity, s1_id) DO UPDATE SET entity = id_map.entity
    RETURNING s2_id
  `);
  const rows = (res as unknown as { rows: Array<{ s2_id: string }> }).rows;
  return rows[0]?.s2_id ?? s2Id;
}
