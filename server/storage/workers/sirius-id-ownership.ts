import { sql, type SQL } from "drizzle-orm";
import { getClient, runInTransaction } from "../transaction-context";
import {
  planSiriusIdOwnership,
  assertSiriusIdReferenceRetention,
  siriusIdPlanHash,
  type SiriusIdOwnershipPlanOptions,
  type SiriusIdReferenceRetention,
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

function sourceContactClaim(rawContactNid: string | null) {
  if (rawContactNid == null) return { contactNid: null, sourceContactProblem: "missing" as const };
  if (!/^\d+$/.test(rawContactNid)) return { contactNid: null, sourceContactProblem: "non_numeric" as const };
  const parsed = BigInt(rawContactNid);
  if (parsed < 1n || parsed > 2_147_483_647n) {
    return { contactNid: null, sourceContactProblem: "out_of_range" as const };
  }
  return { contactNid: Number(parsed), sourceContactProblem: null };
}

async function stagingPresent(client: SqlClient, name: string): Promise<boolean> {
  const result = await client.execute(sql`SELECT to_regclass(${name}) IS NOT NULL AS present`);
  return Boolean(rowsOf<{ present: boolean }>(result)[0]?.present);
}

/** Read-only source/target evidence. It tolerates absent staging so a
 * diagnostic can explain why no repair is available rather than guessing. */
export async function readSiriusIdOwnershipSnapshotWithClient(client: SqlClient): Promise<SiriusIdOwnershipSnapshot> {
  const hasRecords = await stagingPresent(client, "s1_staging.records");
  const hasMap = await stagingPresent(client, "s1_staging.id_map");
  if (!hasRecords) return { stagingPresent: false, idMapPresent: hasMap, claims: [], workers: [] };
  const claimsResult = await client.execute(sql`
    SELECT nid, raw_sirius_id, raw_contact_nid
      FROM (
        SELECT nid, NULLIF(TRIM(COALESCE(
          fields->'field_sirius_id'->>'value',
          fields->'field_sirius_id'->0->>'value',
          fields->>'field_sirius_id'
        )), '') AS raw_sirius_id,
        NULLIF(TRIM(COALESCE(
          fields->'field_sirius_contact'->>'target_id',
          fields->'field_sirius_contact'->>'value',
          fields->'field_sirius_contact'->0->>'target_id',
          fields->'field_sirius_contact'->0->>'value',
          fields->>'field_sirius_contact'
        )), '') AS raw_contact_nid
        FROM s1_staging.records WHERE bundle = 'sirius_worker'
      ) staged
  `);
  const claims = rowsOf<{ nid: number | string; raw_sirius_id: string | null; raw_contact_nid: string | null }>(claimsResult)
    .map((row) => ({
      ...sourceIdClaim(Number(row.nid), row.raw_sirius_id),
      ...sourceContactClaim(row.raw_contact_nid),
    }));
  // Only migration markers participate in planning; do not fetch arbitrary
  // profile JSON (which can be large and may contain sensitive fields).
  const workersResult = await client.execute(sql`
    SELECT id, contact_id, sirius_id,
      jsonb_strip_nulls(jsonb_build_object(
        'migrationShell', data->'migrationShell',
        's1ContactNid', data->'s1ContactNid',
        'migrationSiriusIdAllocation', data->'migrationSiriusIdAllocation'
      )) AS data
      FROM workers ORDER BY id
  `);
  const workers = rowsOf<{ id: string; contact_id: string | null; sirius_id: number | string | null; data: Record<string, unknown> | null }>(workersResult)
    .map((row) => ({
      id: String(row.id),
      contactId: row.contact_id == null ? null : String(row.contact_id),
      siriusId: row.sirius_id == null ? null : Number(row.sirius_id),
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
       AND s2_id IN (SELECT id::text FROM workers)
  `);
  for (const row of rowsOf<{ entity: string; s1_id: number | string; s2_id: string; stub: boolean; loader: string }>(mappingsResult)) {
    const worker = byId.get(String(row.s2_id));
    if (!worker) continue;
    const mapping = { sourceNid: Number(row.s1_id), stub: Boolean(row.stub), loader: String(row.loader) };
    if (row.entity === "worker") worker.workerMappings.push(mapping);
    else if (row.entity === "shell-worker") worker.shellMappings.push(mapping);
  }
  const shellContactNids = [...new Set(workers.flatMap((worker) =>
    typeof worker.data?.s1ContactNid === "number" ? [worker.data.s1ContactNid] : []))];
  const contactResult = shellContactNids.length === 0 ? { rows: [] } : await client.execute(sql`
    SELECT entity, s1_id, s2_id, stub, loader
      FROM s1_staging.id_map
     WHERE entity = 'contact'
       AND s1_id IN (${sql.join(shellContactNids.map((nid) => sql`${nid}`), sql`, `)})
  `);
  const contactMappings = rowsOf<{ entity: string; s1_id: number | string; s2_id: string; stub: boolean; loader: string }>(contactResult)
    .map((row) => ({
      sourceNid: Number(row.s1_id),
      s2Id: String(row.s2_id),
      stub: Boolean(row.stub),
      loader: String(row.loader),
    }));
  return { stagingPresent: true, idMapPresent: true, claims, workers, contactMappings };
}

export async function readSiriusIdOwnershipSnapshot(): Promise<SiriusIdOwnershipSnapshot> {
  return readSiriusIdOwnershipSnapshotWithClient(getClient());
}

/**
 * Retained because authoritative S1 imports can still explicitly write an ID.
 * It only advances the serial association and never allocates, parks, or
 * writes a worker ID. The association remains valid after sirius_id becomes
 * nullable (and when its default is policy-gated by worker_sirius_id_authority).
 */
export async function advanceWorkerSequenceSafely(): Promise<void> {
  const client = getClient();
  await client.execute(sql`
    SELECT setval(
      pg_get_serial_sequence('workers', 'sirius_id'),
      GREATEST(
        1,
        COALESCE(pg_sequence_last_value(pg_get_serial_sequence('workers', 'sirius_id')::regclass), 0),
        (SELECT COALESCE(MAX(sirius_id), 0) FROM workers)
      ),
      true
    )
  `);
}

export interface ApplySiriusIdOwnershipPlanInput {
  approvalHash: string;
  siriusIds?: number[];
  sourceNids?: number[];
  retireShells?: boolean;
  allShells?: boolean;
  shellWorkerIds?: string[];
}

export interface ApplySiriusIdOwnershipPlanResult {
  applied: number;
  planHash: string;
  retiredShells: number;
  authoritativeRekeys: number;
  referenceRetention: { before: SiriusIdReferenceRetention; after: SiriusIdReferenceRetention; verified: true };
}

function planOptions(input: ApplySiriusIdOwnershipPlanInput): SiriusIdOwnershipPlanOptions {
  return {
    retireShells: input.retireShells === true,
    allShells: input.allShells === true,
    shellWorkerIds: input.shellWorkerIds == null ? undefined : new Set(input.shellWorkerIds),
  };
}

async function lockEvidenceTables(client: SqlClient): Promise<void> {
  // SHARE blocks staging writes while allowing the snapshot's source evidence
  // to be read. We only name tables after confirming that they exist.
  if (await stagingPresent(client, "s1_staging.records")) {
    await client.execute(sql`LOCK TABLE s1_staging.records IN SHARE MODE`);
  }
  if (await stagingPresent(client, "s1_staging.id_map")) {
    await client.execute(sql`LOCK TABLE s1_staging.id_map IN SHARE MODE`);
  }
}

interface ForeignKeyReference {
  constraintName: string;
  schemaName: string;
  tableName: string;
  columnName: string;
}

async function discoverWorkerUuidReferences(client: SqlClient): Promise<ForeignKeyReference[]> {
  const result = await client.execute(sql`
    SELECT con.conname AS constraint_name, ns.nspname AS schema_name,
           rel.relname AS table_name, attr.attname AS column_name
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
      JOIN pg_namespace ns ON ns.oid = rel.relnamespace
      JOIN pg_attribute attr ON attr.attrelid = con.conrelid AND attr.attnum = con.conkey[1]
     WHERE con.contype = 'f'
       AND con.confrelid = 'workers'::regclass
       AND array_length(con.conkey, 1) = 1
       AND array_length(con.confkey, 1) = 1
       AND con.confkey[1] = (
         SELECT attnum FROM pg_attribute
          WHERE attrelid = 'workers'::regclass AND attname = 'id' AND NOT attisdropped
       )
     ORDER BY ns.nspname, rel.relname, attr.attname, con.conname
  `);
  return rowsOf<{ constraint_name: string; schema_name: string; table_name: string; column_name: string }>(result)
    .map((row) => ({
      constraintName: String(row.constraint_name),
      schemaName: String(row.schema_name),
      tableName: String(row.table_name),
      columnName: String(row.column_name),
    }));
}

async function referenceRetention(
  client: SqlClient,
  workerIds: readonly string[],
  references: readonly ForeignKeyReference[],
): Promise<SiriusIdReferenceRetention> {
  const workerRows: SiriusIdReferenceRetention["workerRows"] = [];
  for (const workerId of workerIds) {
    const workers = await client.execute(sql`
      SELECT COUNT(*)::int AS rows FROM workers WHERE id = ${workerId}
    `);
    workerRows.push({ workerId, rows: Number(rowsOf<{ rows: number | string }>(workers)[0]?.rows ?? 0) });
  }
  const foreignKeyReferences: SiriusIdReferenceRetention["foreignKeyReferences"] = [];
  for (const reference of references) {
    await client.execute(sql`
      LOCK TABLE ${sql.identifier(reference.schemaName)}.${sql.identifier(reference.tableName)} IN SHARE MODE
    `);
    const byWorker: SiriusIdReferenceRetention["foreignKeyReferences"][number]["byWorker"] = [];
    for (const workerId of workerIds) {
      const result = await client.execute(sql`
        SELECT COUNT(*)::int AS rows,
               md5(COALESCE(string_agg(ctid::text, ',' ORDER BY ctid::text), '')) AS row_identity_hash
          FROM ${sql.identifier(reference.schemaName)}.${sql.identifier(reference.tableName)}
         WHERE ${sql.identifier(reference.columnName)} = ${workerId}
      `);
      const row = rowsOf<{ rows: number | string; row_identity_hash: string }>(result)[0];
      byWorker.push({
        workerId,
        rows: Number(row?.rows ?? 0),
        rowIdentityHash: String(row?.row_identity_hash ?? ""),
      });
    }
    foreignKeyReferences.push({
      constraintName: reference.constraintName,
      table: `${reference.schemaName}.${reference.tableName}`,
      column: reference.columnName,
      byWorker,
    });
  }
  return {
    workerRows,
    foreignKeyReferences,
  };
}

/**
 * Explicitly approved repair. Every affected worker is first parked at NULL,
 * never at a generated number, then exact S1 authoritative rekeys are written.
 * UUIDs are never changed; all foreign-key reference counts are compared under
 * the same transaction/locks before commit.
 */
export async function applySiriusIdOwnershipPlan(
  input: ApplySiriusIdOwnershipPlanInput,
): Promise<ApplySiriusIdOwnershipPlanResult> {
  return runInTransaction(async () => {
    const client = getClient();
    // A human-run repair must fail promptly rather than queue behind ordinary
    // production traffic while holding an approval hash.
    await client.execute(sql`SET LOCAL lock_timeout = '5s'`);
    await client.execute(sql`LOCK TABLE workers IN EXCLUSIVE MODE`);
    await lockEvidenceTables(client);
    const snapshot = await readSiriusIdOwnershipSnapshot();
    const plan = planSiriusIdOwnership(
      snapshot,
      input.siriusIds ? new Set(input.siriusIds) : undefined,
      input.sourceNids ? new Set(input.sourceNids) : undefined,
      planOptions(input),
    );
    const planHash = siriusIdPlanHash(plan);
    if (planHash !== input.approvalHash) {
      throw new Error("Sirius ID ownership plan changed or was produced by a retired planner; rerun the read-only diagnostic and approve its new hash.");
    }
    if (plan.hardBlockers > 0) {
      throw new Error("Sirius ID ownership plan has unresolved, out-of-scope, or unproven claims; no repair was applied.");
    }
    if (plan.rekeys.length === 0) {
      throw new Error("Sirius ID ownership plan has no approved NULL retirements or authoritative rekeys to apply.");
    }

    const workerIds = plan.rekeys.map((rekey) => rekey.workerId).sort();
    const references = await discoverWorkerUuidReferences(client);
    const before = await referenceRetention(client, workerIds, references);
    if (before.workerRows.some((worker) => worker.rows !== 1)) {
      throw new Error("The approved worker UUID scope changed before repair; no changes were committed.");
    }

    for (const rekey of plan.rekeys.filter((candidate) => candidate.fromSiriusId != null)) {
      const result = await client.execute(sql`
        UPDATE workers SET sirius_id = NULL
         WHERE id = ${rekey.workerId} AND sirius_id = ${rekey.fromSiriusId}
      `);
      if ((result as { rowCount?: number }).rowCount !== 1) {
        throw new Error("Sirius ID ownership changed during NULL parking; no changes were committed.");
      }
    }
    for (const rekey of plan.rekeys.filter((candidate) => candidate.toSiriusId != null)) {
      const result = await client.execute(sql`
        UPDATE workers SET sirius_id = ${rekey.toSiriusId}
         WHERE id = ${rekey.workerId} AND sirius_id IS NULL
      `);
      if ((result as { rowCount?: number }).rowCount !== 1) {
        throw new Error("Sirius ID ownership changed during authoritative rekey; no changes were committed.");
      }
    }

    const actualIds = await client.execute(sql`
      SELECT id, sirius_id FROM workers
       WHERE id IN (${sql.join(workerIds.map((id) => sql`${id}`), sql`, `)})
    `);
    const actualByWorker = new Map(rowsOf<{ id: string; sirius_id: number | string | null }>(actualIds)
      .map((row) => [String(row.id), row.sirius_id == null ? null : Number(row.sirius_id)]));
    if (plan.rekeys.some((rekey) => actualByWorker.get(rekey.workerId) !== rekey.toSiriusId)) {
      throw new Error("Sirius ID postcondition was changed by a database rule or trigger; no changes were committed.");
    }
    const after = await referenceRetention(client, workerIds, references);
    assertSiriusIdReferenceRetention(before, after);
    const retiredShells = plan.rekeys.filter((rekey) => rekey.reason === "retire_shell").length;
    return {
      applied: plan.rekeys.length,
      planHash,
      retiredShells,
      authoritativeRekeys: plan.rekeys.length - retiredShells,
      referenceRetention: { before, after, verified: true },
    };
  });
}