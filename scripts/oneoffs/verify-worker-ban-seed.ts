/**
 * Real-database verification for the worker-ban recovery.
 *
 * Creates one isolated worker + legacy ban, verifies legacy resolution,
 * exercises concurrent and repeated seeds, verifies canonical resolution,
 * then removes the fixture. The canonical Dispatch option is intentionally
 * retained because it is application seed data.
 */
import { sql } from "drizzle-orm";
import { db, pool } from "../../server/storage/db";
import {
  initializeWorkerBanSystem,
  resolveBanType,
  seedWorkerBanTypes,
} from "../../server/plugins/worker-bans";
import { preflightWorkerBanSeed } from "../../server/storage/worker-ban-seed";

function rowsOf<T>(result: unknown): T[] {
  return ((result as { rows?: T[] }).rows ?? []) as T[];
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

let contactId: string | undefined;
let workerId: string | undefined;
let banId: string | undefined;

try {
  initializeWorkerBanSystem();
  const contact = await db.execute(sql`
    INSERT INTO contacts (display_name)
    VALUES ('[fixture] worker-ban seed verification')
    RETURNING id
  `);
  contactId = rowsOf<{ id: string }>(contact)[0]?.id;
  assert(contactId, "Fixture contact was not created");

  const worker = await db.execute(sql`
    INSERT INTO workers (contact_id) VALUES (${contactId}) RETURNING id
  `);
  workerId = rowsOf<{ id: string }>(worker)[0]?.id;
  assert(workerId, "Fixture worker was not created");

  const ban = await db.execute(sql`
    INSERT INTO worker_bans (worker_id, type, start_date)
    VALUES (${workerId}, 'dispatch', now())
    RETURNING id, type
  `);
  const legacyBan = rowsOf<{ id: string; type: string }>(ban)[0];
  assert(legacyBan, "Fixture legacy ban was not created");
  banId = legacyBan.id;

  const before = await resolveBanType(legacyBan);
  assert(
    before.pluginIds.includes("all-dispatch"),
    "Legacy literal did not resolve to all-dispatch before conversion",
  );

  await Promise.all([seedWorkerBanTypes(), seedWorkerBanTypes()]);
  await seedWorkerBanTypes();

  const convertedResult = await db.execute(sql`
    SELECT id, type FROM worker_bans WHERE id = ${banId}
  `);
  const converted = rowsOf<{ id: string; type: string }>(convertedResult)[0];
  assert(converted?.type && converted.type !== "dispatch", "Legacy ban was not converted");

  const after = await resolveBanType(converted);
  assert(
    after.pluginIds.includes("all-dispatch"),
    "Converted ban did not resolve to all-dispatch",
  );

  const report = await preflightWorkerBanSeed();
  assert(report.dispatchOptions.length === 1, "Expected exactly one canonical Dispatch option");
  console.log(
    JSON.stringify(
      {
        ok: true,
        legacyEnforcedBefore: true,
        canonicalEnforcedAfter: true,
        repeatedSeed: true,
        concurrentSeed: true,
        preflight: report,
      },
      null,
      2,
    ),
  );
} finally {
  if (banId) await db.execute(sql`DELETE FROM worker_bans WHERE id = ${banId}`);
  if (workerId) await db.execute(sql`DELETE FROM workers WHERE id = ${workerId}`);
  if (contactId) await db.execute(sql`DELETE FROM contacts WHERE id = ${contactId}`);
  await pool.end();
}