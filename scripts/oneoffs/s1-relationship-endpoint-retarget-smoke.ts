/**
 * DEV-ONLY regression smoke for S1 relationship endpoint reconciliation.
 *
 * Proves:
 *   1. Normal staff-facing storage update still forbids worker endpoint edits.
 *   2. The migration-only reconcile path retargets worker_2 in place.
 *   3. Retargeting preserves the relation UUID.
 *   4. The normal duplicate-overlap guard still blocks a conflicting retarget.
 *
 * Uses three existing dev workers plus a temporary relation type and removes
 * every created row in finally.
 *
 * Run: npx tsx scripts/oneoffs/s1-relationship-endpoint-retarget-smoke.ts
 */
import { sql } from "drizzle-orm";
import { db, pool } from "../../server/storage/db";
import { storage } from "../../server/storage/database";
import { WorkerRelationValidationError } from "../../server/storage/workers/relations";
import { withNotificationsSuppressed } from "../../server/middleware/request-context";

const TEMP_TYPE_NAME = `S1 endpoint-retarget smoke ${Date.now()}`;
let failures = 0;

function check(name: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    console.log(`ok: ${name}`);
    return;
  }
  failures++;
  console.error(`FAIL: ${name}${detail === undefined ? "" : ` — ${JSON.stringify(detail)}`}`);
}

async function rows<T>(query: ReturnType<typeof sql>): Promise<T[]> {
  return ((await db.execute(query)) as unknown as { rows: T[] }).rows;
}

async function main(): Promise<void> {
  const workers = await rows<{ id: string }>(sql`SELECT id FROM workers ORDER BY id LIMIT 3`);
  if (workers.length < 3) {
    throw new Error("dev DB needs at least three workers for the endpoint-retarget smoke");
  }
  const [workerA, workerB, workerC] = workers.map((worker) => worker.id);

  let relationTypeId: string | null = null;
  const relationIds: string[] = [];
  try {
    const typeRows = await rows<{ id: string }>(sql`
      INSERT INTO options_worker_relation_type (name)
      VALUES (${TEMP_TYPE_NAME})
      RETURNING id
    `);
    relationTypeId = typeRows[0].id;

    const originalRows = await rows<{ id: string }>(sql`
      INSERT INTO worker_relations (
        worker_1,
        worker_2,
        relation_type,
        start_ymd,
        end_ymd,
        data
      )
      VALUES (
        ${workerA},
        ${workerB},
        ${relationTypeId},
        '2020-01-01',
        NULL,
        '{"s1RetargetSmoke":true}'::jsonb
      )
      RETURNING id
    `);
    const originalId = originalRows[0].id;
    relationIds.push(originalId);

    let normalUpdateError: unknown;
    try {
      await storage.workerRelations.update(originalId, { worker2: workerC });
    } catch (error) {
      normalUpdateError = error;
    }
    check(
      "normal update still rejects endpoint changes",
      normalUpdateError instanceof WorkerRelationValidationError &&
        normalUpdateError.field === "worker2",
      normalUpdateError instanceof Error ? normalUpdateError.message : normalUpdateError,
    );

    const retargeted = await withNotificationsSuppressed(() =>
      storage.workerRelations.reconcileFromMigration(originalId, {
        worker1: workerA,
        worker2: workerC,
        relationType: relationTypeId!,
        startYmd: "2020-01-01",
        endYmd: null,
        data: { s1RetargetSmoke: true },
      }),
    );
    check("migration retarget returns a row", retargeted != null);
    check("migration retarget preserves relation UUID", retargeted?.id === originalId, retargeted);
    check("migration retarget updates worker_2", retargeted?.worker2 === workerC, retargeted);

    const conflictRows = await rows<{ id: string }>(sql`
      INSERT INTO worker_relations (
        worker_1,
        worker_2,
        relation_type,
        start_ymd,
        end_ymd,
        data
      )
      VALUES (
        ${workerA},
        ${workerB},
        ${relationTypeId},
        '2021-01-01',
        NULL,
        '{"s1RetargetSmoke":true}'::jsonb
      )
      RETURNING id
    `);
    const conflictId = conflictRows[0].id;
    relationIds.push(conflictId);

    let overlapError: unknown;
    try {
      await withNotificationsSuppressed(() =>
        storage.workerRelations.reconcileFromMigration(conflictId, {
          worker1: workerA,
          worker2: workerC,
          relationType: relationTypeId!,
          startYmd: "2021-01-01",
          endYmd: null,
        }),
      );
    } catch (error) {
      overlapError = error;
    }
    check(
      "migration retarget still rejects an overlapping duplicate",
      overlapError instanceof WorkerRelationValidationError &&
        /overlapping period/i.test(overlapError.message),
      overlapError instanceof Error ? overlapError.message : overlapError,
    );

    const [conflictAfter] = await rows<{ worker_2: string }>(sql`
      SELECT worker_2 FROM worker_relations WHERE id = ${conflictId}
    `);
    check("failed overlap retarget leaves the endpoint unchanged", conflictAfter?.worker_2 === workerB, conflictAfter);
  } finally {
    if (relationIds.length > 0) {
      await db.execute(sql`
        DELETE FROM worker_relations
         WHERE id IN (${sql.join(relationIds.map((id) => sql`${id}`), sql`, `)})
      `).catch(() => undefined);
    }
    if (relationTypeId) {
      await db.execute(sql`
        DELETE FROM options_worker_relation_type WHERE id = ${relationTypeId}
      `).catch(() => undefined);
    }
    await pool.end();
  }

  console.log(failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error(error);
  await pool.end().catch(() => undefined);
  process.exit(1);
});