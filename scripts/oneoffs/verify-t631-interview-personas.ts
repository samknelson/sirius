/**
 * Verify task: T631 interview persona rules (status transitions, comment
 * slot ownership, employer visibility filter) plus the row-locked
 * transition path used by the /transition endpoint.
 *
 * The persona rule matrix lives in pure functions
 * (server/modules/sitespecific/t631/interview-rules.ts) that the route
 * layer delegates to — verifying them verifies the server-side
 * enforcement regardless of what the UI offers.
 *
 * SAFETY: refuses to run outside development (or without
 * VERIFY_ALLOW_DESTRUCTIVE=1). DB writes are scoped to a DEDICATED
 * throwaway contact+worker created here and deleted in finally; dispatch
 * jobs are referenced read-only as FK targets.
 */
import { storage } from "../../server/storage";
import { db } from "../../server/db";
import { sql } from "drizzle-orm";
import { runInTransaction } from "../../server/storage/transaction-context";
import { jobInterviewsAvailable } from "../../shared/access-policies/sitespecific/t631/job-interviews";
import {
  INTERVIEW_STATUSES,
  EMPLOYER_VISIBLE_STATUSES,
  allowedTargetStatuses,
  editableCommentSlots,
  validateTransition,
  validateCommentEdits,
  mergeComments,
  readComments,
  type InterviewStatus,
} from "../../server/modules/sitespecific/t631/interview-rules";
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

const FIXTURE_TAG = `verify-t631-personas-${Date.now()}`;

function eq(a: unknown, b: unknown) {
  return JSON.stringify(a) === JSON.stringify(b);
}

async function main() {
  // ---------- pure rule matrix ----------
  // worker: only offered → accepted|declined
  check("worker: offered → accepted/declined only",
    eq(allowedTargetStatuses(["worker"], "offered"), ["accepted", "declined"]));
  for (const s of ["accepted", "declined", "passed", "failed"] as InterviewStatus[]) {
    check(`worker: no transitions from ${s}`, allowedTargetStatuses(["worker"], s).length === 0);
  }
  // employer: only accepted → passed|failed
  check("employer: accepted → passed/failed only",
    eq(allowedTargetStatuses(["employer"], "accepted"), ["passed", "failed"]));
  for (const s of ["offered", "declined", "passed", "failed"] as InterviewStatus[]) {
    check(`employer: no transitions from ${s}`, allowedTargetStatuses(["employer"], s).length === 0);
  }
  // staff: anything → anything else
  for (const s of INTERVIEW_STATUSES) {
    check(`staff: from ${s} to any other status`,
      eq(allowedTargetStatuses(["staff"], s), INTERVIEW_STATUSES.filter((t) => t !== s)));
  }
  // union of personas
  check("worker+employer union at accepted",
    eq(allowedTargetStatuses(["worker", "employer"], "accepted"), ["passed", "failed"]));

  // validateTransition
  check("no personas → denied", validateTransition([], "offered", "accepted").ok === false);
  check("comment-only save always ok for any persona",
    validateTransition(["worker"], "passed", undefined).ok === true);
  check("same-status save is ok", validateTransition(["employer"], "passed", "passed").ok === true);
  check("worker cannot pass an interview", validateTransition(["worker"], "accepted", "passed").ok === false);
  check("employer cannot accept an offer", validateTransition(["employer"], "offered", "accepted").ok === false);
  check("worker accepts an offer", validateTransition(["worker"], "offered", "accepted").ok === true);
  check("employer fails an accepted interview", validateTransition(["employer"], "accepted", "failed").ok === true);
  check("staff can revert failed → offered", validateTransition(["staff"], "failed", "offered").ok === true);

  // comment slots
  check("staff edits all slots", eq(editableCommentSlots(["staff"]), ["worker", "employer", "staff"]));
  check("worker edits only worker slot", eq(editableCommentSlots(["worker"]), ["worker"]));
  check("employer edits only employer slot", eq(editableCommentSlots(["employer"]), ["employer"]));
  check("worker cannot edit employer slot",
    validateCommentEdits(["worker"], { employer: "x" }).ok === false);
  check("worker cannot edit staff slot",
    validateCommentEdits(["worker"], { staff: "x" }).ok === false);
  check("employer cannot edit worker slot",
    validateCommentEdits(["employer"], { worker: "x" }).ok === false);
  check("staff edits any slot", validateCommentEdits(["staff"], { worker: "a", employer: "b", staff: "c" }).ok === true);
  check("own slot allowed", validateCommentEdits(["worker"], { worker: "hello" }).ok === true);

  // merge semantics: preserves other data keys + other slots; "" clears
  const merged = mergeComments({ note: "keep", comments: { staff: "s1" } }, { worker: "w1" });
  check("merge preserves unrelated data + other slots",
    (merged as any).note === "keep" && eq(readComments(merged), { worker: "w1", staff: "s1" }));
  const cleared = mergeComments(merged, { worker: "" });
  check("empty string clears own slot", eq(readComments(cleared), { staff: "s1" }));

  // employer visibility filter
  check("employer-visible statuses = accepted/passed/failed",
    eq([...EMPLOYER_VISIBLE_STATUSES].sort(), ["accepted", "failed", "passed"]));

  // ---------- DB: row-locked transition path ----------
  const j = await db.execute(sql`SELECT id FROM dispatch_jobs ORDER BY id LIMIT 1`);
  const jobId = (j.rows[0] as any)?.id as string | undefined;
  if (!jobId) {
    console.error("Need at least 1 dispatch job in dev DB");
    process.exit(1);
  }

  let contactId: string | undefined;
  let workerId: string | undefined;
  try {
    const contactRes = await db.execute(sql`
      INSERT INTO contacts (display_name) VALUES (${`[fixture] ${FIXTURE_TAG}`}) RETURNING id
    `);
    contactId = (contactRes.rows[0] as any).id as string;
    const workerRes = await db.execute(sql`
      INSERT INTO workers (contact_id, data) VALUES (${contactId}, ${JSON.stringify({ fixture: FIXTURE_TAG })}::jsonb) RETURNING id
    `);
    workerId = (workerRes.rows[0] as any).id as string;

    // --- tab relevance (jobInterviewsAvailable) ---
    // plugin-enabled branch (stub storage: pure logic, no config fixtures)
    const stubEnabled = {
      pluginConfigs: { search: async () => [{ config: { pluginId: "sitespecific_t631_interview", enabled: true } }] },
      t631Interviews: { getByJob: async () => [] },
    };
    check("available when interview plugin enabled on job type",
      (await jobInterviewsAvailable(stubEnabled, { id: "x", jobTypeId: "jt" })) === true);
    const stubDisabled = {
      pluginConfigs: { search: async () => [{ config: { pluginId: "sitespecific_t631_interview", enabled: false } }] },
      t631Interviews: { getByJob: async () => [] },
    };
    check("unavailable when plugin config exists but disabled (no rows)",
      (await jobInterviewsAvailable(stubDisabled, { id: "x", jobTypeId: "jt" })) === false);

    const jobRow = ((await db.execute(sql`SELECT job_type_id FROM dispatch_jobs WHERE id = ${jobId}`)).rows[0] as any);
    const availBefore = await jobInterviewsAvailable(storage, { id: jobId, jobTypeId: jobRow.job_type_id });

    const created = await storage.t631Interviews.create({
      workerId, jobId, status: "offered", data: { comments: { staff: "seed" } },
    });

    // existing-rows branch against the real DB: creating a row must make the
    // job available even if the plugin isn't enabled for its job type.
    check("available once an interview row exists (data stays reachable)",
      (await jobInterviewsAvailable(storage, { id: jobId, jobTypeId: jobRow.job_type_id })) === true,
      { availBefore });

    // mimic the /transition endpoint: lock, validate, update — atomically
    const result = await runInTransaction(async () => {
      const locked = await storage.t631Interviews.getForUpdate(created.id);
      if (!locked) return { error: true };
      const t = validateTransition(["worker"], locked.status as InterviewStatus, "accepted");
      if (!t.ok) return { error: true };
      const c = validateCommentEdits(["worker"], { worker: "I'll be there" });
      if (!c.ok) return { error: true };
      const updated = await storage.t631Interviews.update(locked.id, {
        status: "accepted",
        data: mergeComments(locked.data, { worker: "I'll be there" }),
      });
      return { updated };
    });
    check("locked transition applied status + own comment, kept staff comment",
      !("error" in result && result.error) &&
      (result as any).updated?.status === "accepted" &&
      eq(readComments((result as any).updated?.data), { worker: "I'll be there", staff: "seed" }),
      result);

    // a stale transition (validated against the OLD status) must now fail
    const after = await storage.t631Interviews.get(created.id);
    const stale = validateTransition(["worker"], after!.status as InterviewStatus, "declined");
    check("stale worker transition (offered→declined) rejected once status moved on",
      stale.ok === false, stale);

    // getForUpdate outside a transaction should still read (falls back to db)
    const plain = await storage.t631Interviews.get(created.id);
    check("row readable after transition", plain?.status === "accepted");
  } finally {
    if (workerId) {
      for (const row of await storage.t631Interviews.getByWorker(workerId)) {
        await storage.t631Interviews.delete(row.id);
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
