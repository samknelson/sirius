/**
 * Verifier for the "sitespecific_t631_interview" event-notifier plugin
 * (task: interview status change notifications).
 *
 * Covers:
 *  - storage emits carry the status transition (previousStatus/isDeleted)
 *  - shouldDispatch fires only on transitions INTO the target status
 *  - recipient resolution for worker / employer / staff kinds
 *  - the shipped token templates render per medium (subject, body, links)
 *  - staff-recipient save-time validation (non-staff ids rejected)
 *
 * Run: npx tsx scripts/oneoffs/verify-t631-interview-notifier.ts
 */
import { db } from "../../server/db";
import { sql } from "drizzle-orm";
import { storage } from "../../server/storage";
import {
  eventBus,
  EventType,
  type SitespecificT631InterviewSavedPayload,
} from "../../server/services/event-bus";
import { sitespecificT631InterviewNotifier } from "../../server/plugins/event-notifier/plugins/sitespecific-t631-interview";
import { initializeEventNotifierPluginSystem } from "../../server/plugins/event-notifier";
import { getPluginKind } from "../../server/plugins/_core";

const FIXTURE_TAG = `verify-notifier-${Date.now()}`;
let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, extra?: unknown): void {
  if (ok) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}`, extra !== undefined ? JSON.stringify(extra) : "");
  }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function ctxOf(payload: Partial<SitespecificT631InterviewSavedPayload>) {
  return { event: EventType.SITESPECIFIC_T631_INTERVIEW_SAVED, payload };
}

async function main(): Promise<void> {
  const plugin = sitespecificT631InterviewNotifier;
  const cleanup: Array<() => Promise<void>> = [];

  // ---- fixtures ----
  const mkContact = async (name: string, email?: string): Promise<string> => {
    const r = await db.execute(sql`
      INSERT INTO contacts (display_name, email)
      VALUES (${`[fixture] ${name} ${FIXTURE_TAG}`}, ${email ?? null}) RETURNING id
    `);
    const id = (r.rows[0] as any).id as string;
    cleanup.push(async () => {
      await db.execute(sql`DELETE FROM contacts WHERE id = ${id}`);
    });
    return id;
  };

  const workerContactId = await mkContact("worker", `worker.${FIXTURE_TAG}@example.com`);
  const workerRes = await db.execute(sql`
    INSERT INTO workers (contact_id, data)
    VALUES (${workerContactId}, ${JSON.stringify({ fixture: FIXTURE_TAG })}::jsonb) RETURNING id
  `);
  const workerId = (workerRes.rows[0] as any).id as string;
  cleanup.push(async () => {
    await db.execute(sql`DELETE FROM workers WHERE id = ${workerId}`);
  });

  const employerRes = await db.execute(sql`
    INSERT INTO employers (name) VALUES (${`[fixture] ${FIXTURE_TAG}`}) RETURNING id
  `);
  const employerId = (employerRes.rows[0] as any).id as string;
  cleanup.push(async () => {
    await db.execute(sql`DELETE FROM employers WHERE id = ${employerId}`);
  });

  const jobRes = await db.execute(sql`
    INSERT INTO dispatch_jobs (employer_id, title, status, start_ymd)
    VALUES (${employerId}, ${`[fixture] job ${FIXTURE_TAG}`}, 'draft', '2026-09-01') RETURNING id
  `);
  const jobId = (jobRes.rows[0] as any).id as string;
  cleanup.push(async () => {
    await db.execute(sql`DELETE FROM dispatch_jobs WHERE id = ${jobId}`);
  });

  // Two employer contacts associated with the job, one unassociated.
  const ecA = await mkContact("emp-a", `emp.a.${FIXTURE_TAG}@example.com`);
  const ecB = await mkContact("emp-b"); // no email — still notifiable in-app? no user; email skip
  const ecUnrelated = await mkContact("emp-x", `emp.x.${FIXTURE_TAG}@example.com`);
  for (const cid of [ecA, ecB, ecUnrelated]) {
    await db.execute(sql`
      INSERT INTO employer_contacts (employer_id, contact_id) VALUES (${employerId}, ${cid})
    `);
    cleanup.push(async () => {
      await db.execute(
        sql`DELETE FROM employer_contacts WHERE employer_id = ${employerId} AND contact_id = ${cid}`,
      );
    });
  }
  const assocA = await storage.dispatchJobEmployerContacts.create(jobId, ecA);
  const assocB = await storage.dispatchJobEmployerContacts.create(jobId, ecB);
  cleanup.push(async () => {
    await storage.dispatchJobEmployerContacts.delete(assocA.id).catch(() => {});
    await storage.dispatchJobEmployerContacts.delete(assocB.id).catch(() => {});
  });

  // Staff fixture: user with staff permission + matching contact.
  const staffEmail = `staff.${FIXTURE_TAG}@example.com`;
  const staffContactId = await mkContact("staff", staffEmail);
  const staffUserRes = await db.execute(sql`
    INSERT INTO users (id, email, account_status, is_active, created_at, updated_at)
    VALUES (${`fixture-${FIXTURE_TAG}`}, ${staffEmail}, 'active', true, now(), now()) RETURNING id
  `);
  const staffUserId = (staffUserRes.rows[0] as any).id as string;
  cleanup.push(async () => {
    await db.execute(sql`DELETE FROM user_roles WHERE user_id = ${staffUserId}`);
    await db.execute(sql`DELETE FROM users WHERE id = ${staffUserId}`);
  });
  const staffRole = await db.execute(sql`
    SELECT role_id FROM role_permissions WHERE permission_key = 'staff' LIMIT 1
  `);
  const staffRoleId = (staffRole.rows[0] as any)?.role_id as string | undefined;
  if (staffRoleId) {
    await db.execute(sql`
      INSERT INTO user_roles (user_id, role_id) VALUES (${staffUserId}, ${staffRoleId})
    `);
  }

  // Plain (non-staff) user for validateConfig rejection.
  const plainEmail = `plain.${FIXTURE_TAG}@example.com`;
  const plainUserRes = await db.execute(sql`
    INSERT INTO users (id, email, account_status, is_active, created_at, updated_at)
    VALUES (${`fixture-plain-${FIXTURE_TAG}`}, ${plainEmail}, 'active', true, now(), now()) RETURNING id
  `);
  const plainUserId = (plainUserRes.rows[0] as any).id as string;
  cleanup.push(async () => {
    await db.execute(sql`DELETE FROM users WHERE id = ${plainUserId}`);
  });

  // Capture emitted events for the fixture worker.
  const events: SitespecificT631InterviewSavedPayload[] = [];
  eventBus.on({
    event: EventType.SITESPECIFIC_T631_INTERVIEW_SAVED,
    handler: async (p) => {
      if (p.workerId === workerId) events.push(p);
    },
    name: "verify-t631-interview-notifier",
    description: "verify script listener",
  });

  try {
    console.log("== storage emits carry the transition ==");
    const created = await storage.t631Interviews.create({
      workerId,
      jobId,
      status: "offered",
      data: { note: FIXTURE_TAG },
    });
    cleanup.push(async () => {
      await db.execute(
        sql`DELETE FROM sitespecific_t631_job_interviews WHERE id = ${created.id}`,
      );
    });
    await storage.t631Interviews.update(created.id, { status: "accepted" });
    await storage.t631Interviews.update(created.id, { status: "accepted" }); // same-status re-save
    await storage.t631Interviews.delete(created.id);
    await sleep(400);

    check("4 events captured", events.length === 4, events);
    const [eCreate, eUpdate, eResave, eDelete] = events;
    check(
      "create → status offered, previousStatus null, not deleted",
      eCreate?.status === "offered" && eCreate?.previousStatus === null && eCreate?.isDeleted === false,
      eCreate,
    );
    check(
      "update → previousStatus offered → accepted",
      eUpdate?.status === "accepted" && eUpdate?.previousStatus === "offered",
      eUpdate,
    );
    check(
      "re-save → previousStatus === status",
      eResave?.status === "accepted" && eResave?.previousStatus === "accepted",
      eResave,
    );
    check("delete → isDeleted true", eDelete?.isDeleted === true, eDelete);

    console.log("== shouldDispatch: transitions into target status only ==");
    const cfgAccepted = { targetStatus: "accepted", recipientKind: "worker" };
    check(
      "fires on transition into target",
      (await plugin.shouldDispatch!(ctxOf(eUpdate), cfgAccepted)) === true,
    );
    check(
      "creation at target counts as transition",
      (await plugin.shouldDispatch!(
        ctxOf({ ...eCreate, status: "accepted" }),
        cfgAccepted,
      )) === true,
    );
    check(
      "no fire on same-status re-save",
      (await plugin.shouldDispatch!(ctxOf(eResave), cfgAccepted)) === false,
    );
    check(
      "no fire on delete",
      (await plugin.shouldDispatch!(
        ctxOf({ ...eDelete, status: "accepted", previousStatus: "offered" }),
        cfgAccepted,
      )) === false,
    );
    check(
      "no fire on transition into a different status",
      (await plugin.shouldDispatch!(ctxOf(eUpdate), {
        targetStatus: "declined",
        recipientKind: "worker",
      })) === false,
    );
    check(
      "no fire on legacy payload without previousStatus",
      (await plugin.shouldDispatch!(
        ctxOf({ interviewId: "x", workerId, jobId, status: "accepted" } as any),
        cfgAccepted,
      )) === false,
    );
    check(
      "no fire with missing targetStatus",
      (await plugin.shouldDispatch!(ctxOf(eUpdate), { recipientKind: "worker" })) === false,
    );
    // Employer visibility: employers never see offered/declined interviews,
    // so an employer-targeted config must not fire for those statuses even if
    // such a config exists (e.g. saved before the schema restriction).
    check(
      "no fire to employer for a hidden status (offered)",
      (await plugin.shouldDispatch!(
        ctxOf({ ...eCreate }), // transition into "offered"
        { targetStatus: "offered", recipientKind: "employer" },
      )) === false,
    );
    check(
      "fires to employer for a visible status (accepted)",
      (await plugin.shouldDispatch!(ctxOf(eUpdate), {
        targetStatus: "accepted",
        recipientKind: "employer",
      })) === true,
    );
    check(
      "worker may still be notified of a hidden status (offered)",
      (await plugin.shouldDispatch!(ctxOf(eCreate), {
        targetStatus: "offered",
        recipientKind: "worker",
      })) === true,
    );

    console.log("== recipient resolution ==");
    const basePayload = eUpdate;
    const workerRecipients = await plugin.getRecipients!(ctxOf(basePayload), {
      targetStatus: "accepted",
      recipientKind: "worker",
    });
    check(
      "worker kind → the worker's contact",
      workerRecipients.length === 1 && workerRecipients[0].contactId === workerContactId,
      workerRecipients,
    );

    const employerRecipients = await plugin.getRecipients!(ctxOf(basePayload), {
      targetStatus: "accepted",
      recipientKind: "employer",
    });
    const empIds = employerRecipients.map((r) => r.contactId).sort();
    check(
      "employer kind → exactly the job's associated employer contacts",
      empIds.length === 2 && empIds.includes(ecA) && empIds.includes(ecB) && !empIds.includes(ecUnrelated),
      employerRecipients,
    );

    // Removing an association immediately changes recipients.
    await storage.dispatchJobEmployerContacts.delete(assocB.id);
    const employerRecipients2 = await plugin.getRecipients!(ctxOf(basePayload), {
      targetStatus: "accepted",
      recipientKind: "employer",
    });
    check(
      "employer kind reflects association removal",
      employerRecipients2.length === 1 && employerRecipients2[0].contactId === ecA,
      employerRecipients2,
    );

    const staffRecipients = await plugin.getRecipients!(ctxOf(basePayload), {
      targetStatus: "accepted",
      recipientKind: "staff",
      staffRecipientUserIds: [staffUserId, staffUserId, "nonexistent-user-id"],
    });
    check(
      "staff kind → picked user's contact (unknown ids skipped)",
      staffRecipients.length === 1 &&
        staffRecipients[0].contactId === staffContactId &&
        staffRecipients[0].userId === staffUserId,
      staffRecipients,
    );

    const staffEmpty = await plugin.getRecipients!(ctxOf(basePayload), {
      targetStatus: "accepted",
      recipientKind: "staff",
    });
    check("staff kind with no picks → nobody", staffEmpty.length === 0);

    // Message composition moved to token templates: the plugin no longer
    // composes strings itself, so render its shipped defaults the way the
    // framework does and assert on the rendered output.
    console.log("== message composition (shipped token templates) ==");
    const { renderTokens, createTokenEvalContext, initializeTokenPluginSystem } =
      await import("../../server/plugins/tokens");
    const { loadComponentCache } = await import(
      "../../server/services/component-cache"
    );
    await loadComponentCache();
    initializeTokenPluginSystem();
    // The interview above was deleted by the transition checks; the roots
    // read the live row, so render against a fresh one.
    const live = await storage.t631Interviews.create({
      workerId,
      jobId,
      status: "accepted",
      data: { note: FIXTURE_TAG },
    });
    cleanup.push(async () => {
      await db.execute(
        sql`DELETE FROM sitespecific_t631_job_interviews WHERE id = ${live.id}`,
      );
    });
    const livePayload = {
      ...basePayload,
      interviewId: live.id,
      status: "accepted",
      previousStatus: "offered",
      isDeleted: false,
    };

    const seeds: Array<{ name: string; entity: unknown }> = [];
    for (const root of plugin.tokenTemplates!.roots) {
      const built = await root.build(ctxOf(livePayload));
      check(`token root {{${root.name}}} builds a record`, built !== null);
      if (built) seeds.push({ name: root.name, entity: built });
    }
    const evalCtx = createTokenEvalContext(storage, null, { seeds } as never);
    const renderFor = async (recipientKind: string) => {
      const templates = plugin.tokenTemplates!.defaultTemplates!({
        targetStatus: "accepted",
        recipientKind,
      });
      const out: Record<string, string> = {};
      for (const [channel, fields] of Object.entries(templates)) {
        for (const [field, template] of Object.entries(
          fields as Record<string, string>,
        )) {
          const r = await renderTokens(template, evalCtx);
          check(
            `${recipientKind}: ${channel}.${field} renders every token`,
            r.unknownTokens.length === 0 &&
              r.missingValues.length === 0 &&
              r.emptyValues.length === 0,
            [...r.unknownTokens, ...r.missingValues, ...r.emptyValues],
          );
          out[`${channel}.${field}`] = r.output;
        }
      }
      return out;
    };

    const expectedTitle = `Interview - status change - [fixture] job ${FIXTURE_TAG}`;
    const workerOut = await renderFor("worker");
    check(
      "worker kind: subject names the area, the change and the job",
      workerOut["email.subject"] === expectedTitle &&
        workerOut["inapp.title"] === expectedTitle,
      workerOut,
    );
    check(
      "worker kind: email links absolutely to the worker's interviews tab",
      workerOut["email.bodyHtml"].includes(
        `/workers/${workerId}/dispatch/sitespecific_t631_interviews`,
      ) && workerOut["email.bodyHtml"].includes("https://"),
      workerOut["email.bodyHtml"],
    );
    check(
      "worker kind: body says which status it is now",
      workerOut["inapp.body"].includes("is now accepted"),
      workerOut["inapp.body"],
    );

    const employerOut = await renderFor("employer");
    check(
      "employer kind: same subject",
      employerOut["email.subject"] === expectedTitle &&
        employerOut["inapp.title"] === expectedTitle,
      employerOut,
    );
    check(
      "employer kind: in-app link is relative to the job's interviews page",
      employerOut["inapp.linkUrl"] ===
        `/dispatch/job/${jobId}/sitespecific_t631_interviews`,
      employerOut["inapp.linkUrl"],
    );
    check(
      "employer kind: sms carries the sentence and an absolute link, no subject",
      employerOut["sms.message"].includes("is now accepted") &&
        employerOut["sms.message"].includes("https://") &&
        !("sms.subject" in employerOut),
      employerOut["sms.message"],
    );

    console.log("== save-time staff recipient validation ==");
    initializeEventNotifierPluginSystem();
    const kind = getPluginKind("event-notifier")!;
    const badResult = await kind.validateConfig!(plugin as any, {
      targetStatus: "accepted",
      recipientKind: "staff",
      staffRecipientUserIds: [plainUserId],
      media: ["email"],
    });
    check("non-staff recipient rejected at save time", badResult.valid === false, badResult);
    const goodResult = await kind.validateConfig!(plugin as any, {
      targetStatus: "accepted",
      recipientKind: "staff",
      staffRecipientUserIds: [staffUserId],
      media: ["email"],
    });
    check("staff recipient accepted", goodResult.valid === true, goodResult);
    const badMedia = await kind.validateConfig!(plugin as any, {
      targetStatus: "accepted",
      recipientKind: "worker",
      media: ["postal"],
    });
    check("unsupported medium rejected", badMedia.valid === false, badMedia);
    const badSchema = await kind.validateConfig!(plugin as any, {
      recipientKind: "worker",
      media: ["email"],
    });
    check("missing targetStatus rejected by schema", badSchema.valid === false, badSchema);
    const badEmployerStatus = await kind.validateConfig!(plugin as any, {
      targetStatus: "offered",
      recipientKind: "employer",
      media: ["email"],
    });
    check(
      "employer + hidden status rejected at save time",
      badEmployerStatus.valid === false,
      badEmployerStatus,
    );
    const okEmployerStatus = await kind.validateConfig!(plugin as any, {
      targetStatus: "passed",
      recipientKind: "employer",
      media: ["email"],
    });
    check("employer + visible status accepted", okEmployerStatus.valid === true, okEmployerStatus);
  } finally {
    for (const fn of cleanup.reverse()) {
      try {
        await fn();
      } catch (e) {
        console.error("cleanup failed:", e);
      }
    }
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
