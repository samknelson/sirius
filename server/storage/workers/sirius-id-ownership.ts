import { sql, type SQL } from "drizzle-orm";
import { getClient, runInTransaction } from "../transaction-context";
import {
  planSiriusIdOwnership,
  nextRelationshipShellSiriusId,
  siriusIdPlanHash,
  type SiriusIdOwnershipPlan,
  type SiriusIdOwnershipSnapshot,
} from "./sirius-id-ownership-plan";

type SqlClient = { execute(query: SQL): Promise<unknown> };
const rowsOf = <T>(result: unknown): T[] => ((result as { rows?: T[] }).rows ?? []);

function sourceIdClaim(sourceNid: number, rawSiriusId: string | null) {
  if (rawSiriusId == null) return { sourceNid, rawSiriusId, siriusId: null, sourceIdProblem: "missing" as const };
  if (!/^\d+$/.test(rawSiriusId)) {
    return { sourceNid, rawSiriusId, siriusId: null, sourceIdProblem: "non_numeric" as const };
  }
  const parsed = BigInt(rawSiriusId);
  if (parsed < 1n || parsed > 2_147_483_647n) {
    return { sourceNid, rawSiriusId, siriusId: null, sourceIdProblem: "out_of_range" as const };
  }
  return { sourceNid, rawSiriusId, siriusId: Number(parsed), sourceIdProblem: null };
}

async function stagingPresent(client: SqlClient, name: string): Promise<boolean> {
  const result = await client.execute(sql`SELECT to_regclass(${name}) IS NOT NULL AS present`);
  return Boolean(rowsOf<{ present: boolean }>(result)[0]?.present);
}

/** Read-only source/target evidence.  It intentionally tolerates a target
 * before staging/id_map exists so the dashboard and diagnostic can say why
 * planning is unavailable rather than guessing. */
export async function readSiriusIdOwnershipSnapshot(): Promise<SiriusIdOwnershipSnapshot> {
  const client = getClient();
  const hasRecords = await stagingPresent(client, "s1_staging.records");
  const hasMap = await stagingPresent(client, "s1_staging.id_map");
  if (!hasRecords) return { stagingPresent: false, idMapPresent: hasMap, claims: [], workers: [] };
  const claimsResult = await client.execute(sql`
    SELECT nid, raw
      FROM (
        SELECT nid, NULLIF(TRIM(COALESCE(
          fields->'field_sirius_id'->>'value',
          fields->'field_sirius_id'->0->>'value',
          fields->>'field_sirius_id'
        )), '') AS raw
        FROM s1_staging.records WHERE bundle = 'sirius_worker'
      ) staged
  `);
  const claims = rowsOf<{ nid: number | string; raw: string | null }>(claimsResult)
    .map((row) => sourceIdClaim(Number(row.nid), row.raw));
  const workersResult = await client.execute(sql`
    SELECT id, sirius_id, data FROM workers ORDER BY id
  `);
  const workers = rowsOf<{ id: string; sirius_id: number | string; data: Record<string, unknown> | null }>(workersResult)
    .map((row) => ({
      id: String(row.id),
      siriusId: Number(row.sirius_id),
      data: row.data ?? null,
      workerMappings: [] as Array<{ sourceNid: number; stub: boolean; loader: string }>,
      shellMappings: [] as Array<{ sourceNid: number; stub: boolean; loader: string }>,
    }));
  if (!hasMap) return { stagingPresent: true, idMapPresent: false, claims, workers };
  const byId = new Map(workers.map((worker) => [worker.id, worker]));
  const mappingsResult = await client.execute(sql`
    SELECT entity, s1_id, s2_id, stub, loader
      FROM s1_staging.id_map
     WHERE entity IN ('worker', 'shell-worker')
  `);
  for (const row of rowsOf<{ entity: string; s1_id: number | string; s2_id: string; stub: boolean; loader: string }>(mappingsResult)) {
    const worker = byId.get(String(row.s2_id));
    if (!worker) continue;
    const mapping = { sourceNid: Number(row.s1_id), stub: Boolean(row.stub), loader: String(row.loader) };
    if (row.entity === "worker") worker.workerMappings.push(mapping);
    else worker.shellMappings.push(mapping);
  }
  return { stagingPresent: true, idMapPresent: true, claims, workers };
}

/** Call while a workers table lock is held, after any explicit ID write. */
export async function advanceWorkerSequenceSafely(): Promise<void> {
  const client = getClient();
  // Never lower the sequence: rows may have been deleted, and a native insert
  // can have consumed a sequence value before waiting on the table lock.
  await client.execute(sql`
    SELECT setval(
      pg_get_serial_sequence('workers', 'sirius_id'),
      GREATEST(
        COALESCE(pg_sequence_last_value(pg_get_serial_sequence('workers', 'sirius_id')::regclass), 0),
        (SELECT COALESCE(MAX(sirius_id), 0) FROM workers)
      ),
      true
    )
  `);
}

/**
 * Reserve a generated ID for a relationship shell.  Generated IDs are always
 * above every current worker and every authoritative staged reservation.  The
 * table lock also serializes native worker inserts with this decision.
 */
export async function allocateRelationshipShellSiriusId(
  reservedSiriusIds: readonly number[],
): Promise<number> {
  const client = getClient();
  await client.execute(sql`LOCK TABLE workers IN EXCLUSIVE MODE`);
  const result = await client.execute(sql`
    SELECT COALESCE(MAX(sirius_id), 0) AS max_id,
           COALESCE(pg_sequence_last_value(pg_get_serial_sequence('workers', 'sirius_id')::regclass), 0) AS sequence_last_value
      FROM workers
  `);
  const state = rowsOf<{ max_id: number | string; sequence_last_value: number | string }>(result)[0];
  return nextRelationshipShellSiriusId(
    [Number(state?.max_id ?? 0)],
    reservedSiriusIds,
    Number(state?.sequence_last_value ?? 0),
  );
}

export interface ApplySiriusIdOwnershipPlanInput {
  approvalHash: string;
  siriusIds?: number[];
  sourceNids?: number[];
}

export interface ApplySiriusIdOwnershipPlanResult {
  applied: number;
  planHash: string;
}

/**
 * Explicitly approved, grouped repair only.  The complete evidence is reread
 * while an EXCLUSIVE workers lock is held; a stale hash, any ambiguity, or an
 * already-resolved plan is refused.  Parking avoids unique-index collisions
 * for swaps while preserving every worker UUID and all foreign-key references.
 */
export async function applySiriusIdOwnershipPlan(
  input: ApplySiriusIdOwnershipPlanInput,
): Promise<ApplySiriusIdOwnershipPlanResult> {
  return runInTransaction(async () => {
    const client = getClient();
    await client.execute(sql`LOCK TABLE workers IN EXCLUSIVE MODE`);
    const snapshot = await readSiriusIdOwnershipSnapshot();
    const plan = planSiriusIdOwnership(
      snapshot,
      input.siriusIds ? new Set(input.siriusIds) : undefined,
      input.sourceNids ? new Set(input.sourceNids) : undefined,
    );
    const planHash = siriusIdPlanHash(plan);
    if (planHash !== input.approvalHash) throw new Error("Sirius ID ownership plan changed; rerun the read-only diagnostic and approve its new hash.");
    if (plan.hardBlockers > 0) throw new Error("Sirius ID ownership plan has unresolved or ambiguous claims; no repair was applied.");
    if (plan.rekeys.length === 0) throw new Error("Sirius ID ownership plan has no approved rekeys to apply.");

    const occupied = new Set<number>([
      ...snapshot.claims.flatMap((claim) => claim.siriusId == null ? [] : [claim.siriusId]),
      ...snapshot.workers.map((worker) => worker.siriusId),
      ...plan.rekeys.map((rekey) => rekey.toSiriusId),
    ]);
    let park = Math.max(0, ...occupied) + 1;
    for (const rekey of plan.rekeys) {
      while (occupied.has(park)) park++;
      const parkingId = park++;
      occupied.add(parkingId);
      const result = await client.execute(sql`
        UPDATE workers SET sirius_id = ${parkingId}
         WHERE id = ${rekey.workerId} AND sirius_id = ${rekey.fromSiriusId}
      `);
      if ((result as { rowCount?: number }).rowCount !== 1) {
        throw new Error("Sirius ID ownership changed during repair; no changes were committed.");
      }
    }
    for (const rekey of plan.rekeys) {
      await client.execute(sql`UPDATE workers SET sirius_id = ${rekey.toSiriusId} WHERE id = ${rekey.workerId}`);
    }
    await advanceWorkerSequenceSafely();
    return { applied: plan.rekeys.length, planHash };
  });
}