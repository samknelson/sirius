/**
 * Verify task: T631 interviews CRUD storage, events, worker-attributed
 * logging, denorm plugin facts, and the eligibility condition.
 *
 * SAFETY: refuses to run outside development (or without VERIFY_ALLOW_DESTRUCTIVE=1).
 * All writes are scoped to a DEDICATED throwaway worker (contact + worker created
 * by this script and deleted at the end); no pre-existing rows are touched.
 * Dispatch jobs are only referenced read-only for FK targets.
 *
 * Imports the denorm plugin file directly (NOT the denorm barrel — that
 * crash-loops standalone scripts via PluginRegistry init, see memory).
 */
import { storage } from "../../server/storage";
import { db } from "../../server/db";
import { sql } from "drizzle-orm";
import { eventBus, EventType, type SitespecificT631InterviewSavedPayload } from "../../server/services/event-bus";
import "../../server/plugins/system/denorm/plugins/dispatch/sitespecific-t631-interview";
import { getDenormPlugin } from "../../server/plugins/system/denorm/registry";
import { applyComputed } from "../../server/plugins/system/denorm/apply";
import { t631InterviewPlugin } from "../../server/plugins/dispatch/eligibility/plugins/sitespecific-t631-interview";
import { getEnvironmentVariable, registerEnvironmentVariables } from "../../server/config/env-registry";

registerEnvironmentVariables([
  { name: "VERIFY_ALLOW_DESTRUCTIVE", description: "Set to 1 to let destructive verify scripts run outside development.", secret: false, category: "core" },
]);

if (getEnvironmentVariable("NODE_ENV") !== "development" && getEnvironmentVariable("VERIFY_ALLOW_DESTRUCTIVE") !== "1") {
  console.error(`Refusing to run in NODE_ENV=${getEnvironmentVariable("NODE_ENV") ?? "(unset)"} — development only. Set VERIFY_ALLOW_DESTRUCTIVE=1 to override.`);
  process.exit(1);
}

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : ` :: ${JSON.stringify(detail)}`}`);
  if (!ok) failures++;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const FIXTURE_TAG = `verify-t631-${Date.now()}`;

async function main() {
  const startedAt = new Date();

  // check prerequisites BEFORE creating any fixture rows (read-only FK targets)
  const j = await db.execute(sql`SELECT id FROM dispatch_jobs ORDER BY id LIMIT 2`);
  const [jobA, jobB] = (j.rows as any[]).map((r) => r.id as string);
  if (!jobA || !jobB) {
    console.error("Need at least 2 dispatch jobs in dev DB");
    process.exit(1);
  }

  // --- dedicated fixture worker (contact + worker); every step after a
  // successful creation is inside try/finally so failures still clean up.
  let contactId: string | undefined;
  let workerId: string | undefined;

  const events: SitespecificT631InterviewSavedPayload[] = [];
  eventBus.on({
    event: EventType.SITESPECIFIC_T631_INTERVIEW_SAVED,
    handler: async (p) => { if (p.workerId === workerId) events.push(p); },
    name: "verify-t631-interviews",
    description: "verify script listener",
  });

  const plugin = getDenormPlugin("sitespecific_t631_interview")!;
  const cfg = await db.execute(sql`
    SELECT pc.id FROM plugin_configs pc
    WHERE pc.plugin_kind = 'denorm' AND pc.plugin_id = 'sitespecific_t631_interview' LIMIT 1
  `);
  const configId = (cfg.rows[0] as any)?.id as string | undefined;

  try {
    const contactRes = await db.execute(sql`
      INSERT INTO contacts (display_name) VALUES (${`[fixture] ${FIXTURE_TAG}`}) RETURNING id
    `);
    contactId = (contactRes.rows[0] as any).id as string;
    const workerRes = await db.execute(sql`
      INSERT INTO workers (contact_id, data) VALUES (${contactId}, ${JSON.stringify({ fixture: FIXTURE_TAG })}::jsonb) RETURNING id
    `);
    workerId = (workerRes.rows[0] as any).id as string;
    // --- CRUD + events
    const created = await storage.t631Interviews.create({ workerId, jobId: jobA, status: "offered", data: { note: FIXTURE_TAG } });
    check("create returns row", created.workerId === workerId && created.jobId === jobA && created.status === "offered");

    const dup = await storage.t631Interviews.create({ workerId, jobId: jobA, status: "offered", data: null }).then(() => true).catch((e: any) => e?.code === "23505" ? false : Promise.reject(e));
    check("unique (job, worker) enforced", dup === false);

    const second = await storage.t631Interviews.create({ workerId, jobId: jobB, status: "passed", data: null });

    const updated = await storage.t631Interviews.update(created.id, { status: "passed" });
    check("update flips status", updated?.status === "passed");

    const byWorker = await storage.t631Interviews.getByWorker(workerId);
    check("getByWorker returns both", byWorker.length === 2);
    const byJob = await storage.t631Interviews.getByJob(jobA);
    check("getByJob includes fixture row", byJob.some((r) => r.id === created.id));

    await sleep(300);
    check("events emitted for create+create+update (with worker/job ids)",
      events.length === 3 && events.every((e) => e.workerId === workerId) &&
      events.filter((e) => e.jobId === jobA).length === 2,
      events);

    // --- denorm compute + write (facts scoped to the fixture worker only)
    check("denorm plugin registered", !!plugin);
    const payload = await plugin.compute(workerId) as { entries: Array<{ workerId: string; category: string; value: string }> };
    check("compute → one fact per PASSED interview (both passed now)",
      payload.entries.length === 2 &&
      payload.entries.every((e) => e.category === "t631_interview" && e.workerId === workerId) &&
      new Set(payload.entries.map((e) => e.value)).size === 2,
      payload);

    check("singleton denorm config seeded at boot", !!configId);

    if (configId) {
      await applyComputed(plugin, configId, workerId, payload);
      const facts = await db.execute(sql`
        SELECT value FROM worker_dispatch_elig_denorm
        WHERE worker_id = ${workerId} AND category = 't631_interview' ORDER BY value
      `);
      check("facts written to worker_dispatch_elig_denorm", facts.rows.length === 2, facts.rows);

      await storage.t631Interviews.update(created.id, { status: "failed" });
      await applyComputed(plugin, configId, workerId, await plugin.compute(workerId));
      const facts2 = await db.execute(sql`
        SELECT value FROM worker_dispatch_elig_denorm
        WHERE worker_id = ${workerId} AND category = 't631_interview'
      `);
      check("fact removed when interview no longer passed",
        facts2.rows.length === 1 && (facts2.rows[0] as any).value === jobB, facts2.rows);

      const deleted = await storage.t631Interviews.delete(second.id);
      check("delete returns deleted row", deleted?.id === second.id && deleted?.workerId === workerId);
      await applyComputed(plugin, configId, workerId, await plugin.compute(workerId));
      const facts3 = await db.execute(sql`
        SELECT value FROM worker_dispatch_elig_denorm
        WHERE worker_id = ${workerId} AND category = 't631_interview'
      `);
      check("no facts after delete of passed interview", facts3.rows.length === 0, facts3.rows);
    }

    await sleep(300);
    check("delete emitted event too",
      events.length === 5 && events[4].jobId === jobB, events.length);

    // --- logging: scoped to this run's fixture worker + time window
    await sleep(1200);
    const logs = await db.execute(sql`
      SELECT description, host_entity_id FROM winston_logs
      WHERE module = 'sitespecific.t631.interviews'
        AND timestamp >= ${startedAt.toISOString()}
        AND (host_entity_id = ${workerId} OR host_entity_id IS NULL)
      ORDER BY timestamp ASC, id ASC
    `);
    const rows = logs.rows as Array<{ description: string; host_entity_id: string | null }>;
    // The deliberate duplicate-create produces an error entry ("Failed to
    // create ...") — error-path logs have no result row to attribute from.
    const successRows = rows.filter((r) => !r.description.startsWith("Failed"));
    check("all successful interview logs attributed to the fixture worker",
      successRows.length >= 5 && successRows.every((r) => r.host_entity_id === workerId),
      rows);
    check("delete log present and worker-attributed (via RETURNING row)",
      successRows.some((r) => r.description.startsWith("Deleted interview")),
      successRows.map((r) => r.description));
    check("status change described",
      successRows.some((r) => r.description.includes("status passed → failed")),
      successRows.map((r) => r.description));

    // --- eligibility condition shape
    const cond = t631InterviewPlugin.getEligibilityCondition(
      { jobId: jobA } as any, {},
    ) as { category: string; type: string; value: string };
    check("eligibility condition requires passed-interview fact for THIS job",
      cond.category === "t631_interview" && cond.type === "exists" && cond.value === jobA,
      cond);
  } finally {
    // cleanup ONLY fixture-created rows: interviews via storage (emits events),
    // recompute so no stale facts survive, then the fixture worker + contact.
    if (workerId) {
      for (const row of await storage.t631Interviews.getByWorker(workerId)) {
        await storage.t631Interviews.delete(row.id);
      }
      if (plugin && configId) {
        await applyComputed(plugin, configId, workerId, await plugin.compute(workerId));
      }
      await db.execute(sql`DELETE FROM denorm WHERE entity_id = ${workerId}`);
      await db.execute(sql`DELETE FROM workers WHERE id = ${workerId}`);
    }
    if (contactId) {
      await db.execute(sql`DELETE FROM contacts WHERE id = ${contactId}`);
    }
  }

  console.log(failures === 0 ? "ALL PASS" : `${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
