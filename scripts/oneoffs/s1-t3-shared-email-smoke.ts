/**
 * Smoke test for the shared-email ownership rules in the T3+T1 contacts
 * loader (load-contacts-workers.ts). Seeds fake staged contacts (nids
 * 99901xxx) plus raw S1 user rows/associations (uids 9992xx) covering:
 *   - byUserAccount: two contacts share an address, raw_user_contact ties an
 *     S1 account with that mail to ONE of them → that contact keeps the
 *     email, the other loads with email=null
 *   - deferredNoOwner: shared address, no owning account → ALL contacts load
 *     with email=null (fund ruling: deferred; reported as the follow-up
 *     worklist)
 *   - rerun repair: a non-owner holding the address in the DB (old
 *     first-wins rule) is cleared and the owner claims it on the next run
 *   - idempotency: a second consecutive run reports zero contact writes
 *   - shared_email_multiple_owners: two owning accounts on one address is
 *     FATAL (exit 1, nothing written) unless allowed via --allow-rejects,
 *     which defers the address (all null)
 * Cleanup removes every seeded staged row, raw user row, association,
 * id_map entry, and S2 contact row.
 *
 * Run: npx tsx scripts/oneoffs/s1-t3-shared-email-smoke.ts
 */
import { spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { db, pool as pgPool } from "../../server/storage/db";
import { sql } from "drizzle-orm";
import { storage } from "../../server/storage/database";
import {
  ensureStagingSchema,
  upsertRecords,
  ensureRawUserTables,
  upsertRawUsers,
  upsertRawUserContacts,
} from "../s1-migration/lib/staging";
import { ensureIdMap, getMappings } from "../s1-migration/lib/idmap";
import {
  getEnvironmentVariable,
  getRawProcessEnv,
  registerEnvironmentVariables,
} from "../../server/config/env-registry";

registerEnvironmentVariables([
  {
    name: "S1_SMOKE_DEBUG",
    description: "Set to 1 for verbose S1 smoke test debug output.",
    secret: false,
    category: "core",
  },
]);

const N = { a1: 99901001, a2: 99901002, b1: 99901003, b2: 99901004, cc1: 99901005, cc2: 99901006 };
const U = { ownerA: 999201, multi1: 999202, multi2: 999203 };
const EMAILS = {
  a: "t3.smoke.shared-a@example.test",
  b: "t3.smoke.shared-b@example.test",
  c: "t3.smoke.shared-c@example.test",
};
// Existing full dev staging carries unrelated reviewed rejects. The smoke
// asserts every seeded contact explicitly, so acknowledging these baseline
// classes cannot mask a regression in the shared-email fixtures.
const BASE_ALLOW_REJECTS = [
  "worker_id_value_collision",
  "duplicate_email",
  "address_incomplete",
  "phone_invalid",
  "contact_no_name",
  "ssn_collision_q36",
  "worker_contact_unresolved",
];

let failures = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log(`  ok: ${name}`);
  else {
    failures++;
    console.error(`  FAIL: ${name}${extra !== undefined ? ` — ${JSON.stringify(extra)}` : ""}`);
  }
}

function runLoader(allowMultiOwners = false): { status: number | null; out: string; report: any } {
  const allowed = [...BASE_ALLOW_REJECTS, ...(allowMultiOwners ? ["shared_email_multiple_owners"] : [])];
  const resultPath = path.join(os.tmpdir(), `s1-shared-email-smoke-${process.pid}-${Math.random().toString(36).slice(2)}.json`);
  const args = [
    "tsx",
    "scripts/s1-migration/load-contacts-workers.ts",
    "--allow-rejects",
    allowed.join(","),
    "--allow-findings",
    "deleted_in_s1",
  ];
  const res = spawnSync("npx", args, {
    encoding: "utf8",
    timeout: 600_000,
    env: { ...getRawProcessEnv(), S1_RESULT_JSON_PATH: resultPath },
  });
  const out = `${res.stdout}\n${res.stderr}`;
  if (getEnvironmentVariable("S1_SMOKE_DEBUG") === "1" && res.status !== 0) {
    console.error(out.split("\n").slice(-80).join("\n"));
  }
  let report: any = null;
  try {
    report = JSON.parse(fs.readFileSync(resultPath, "utf8"));
  } catch {
    /* leave null — checks will fail loudly */
  }
  try {
    fs.unlinkSync(resultPath);
  } catch {}
  return { status: res.status, out, report };
}

async function contactEmailByNid(nid: number): Promise<string | null | undefined> {
  const m = (await getMappings("contact", [nid])).get(nid);
  if (!m) return undefined; // not loaded
  const row = await storage.contacts.getContact(m.s2Id);
  return row ? (row.email ?? null) : undefined;
}

const now = Math.floor(Date.now() / 1000);
const rec = (nid: number, title: string, email: string) => ({
  bundle: "sirius_contact",
  nid,
  vid: nid,
  title,
  uid: 1,
  status: 1,
  created: now,
  changed: now,
  fields: { field_sirius_email: { value: email } },
});

async function seedPhase1() {
  await ensureStagingSchema();
  await ensureIdMap();
  await ensureRawUserTables();
  await upsertRecords([
    rec(N.a1, "T3 Shared A1", `  ${EMAILS.a.toUpperCase()}  `),
    rec(N.a2, "T3 Shared A2", EMAILS.a),
    rec(N.b1, "T3 Shared B1", EMAILS.b),
    rec(N.b2, "T3 Shared B2", EMAILS.b),
  ]);
  await upsertRawUsers([
    { uid: U.ownerA, name: "t3-owner-a", mail: ` ${EMAILS.a.toUpperCase()} `, created: now, access: now, login: now, status: 1, timezone: null, data: null },
  ]);
  await upsertRawUserContacts([{ uid: U.ownerA, delta: 0, contactNid: N.a2 }]);
}

async function seedPhase2() {
  await upsertRecords([rec(N.cc1, "T3 Multi C1", EMAILS.c), rec(N.cc2, "T3 Multi C2", EMAILS.c)]);
  await upsertRawUsers([
    { uid: U.multi1, name: "t3-multi-1", mail: EMAILS.c, created: now, access: now, login: now, status: 1, timezone: null, data: null },
    { uid: U.multi2, name: "t3-multi-2", mail: EMAILS.c, created: now, access: now, login: now, status: 1, timezone: null, data: null },
  ]);
  await upsertRawUserContacts([
    { uid: U.multi1, delta: 0, contactNid: N.cc1 },
    { uid: U.multi2, delta: 0, contactNid: N.cc2 },
  ]);
}

async function cleanup() {
  console.log("cleanup...");
  const nids = Object.values(N);
  const uids = Object.values(U);
  const cMap = await getMappings("contact", nids);
  for (const [, m] of cMap) {
    await db.execute(sql`DELETE FROM contact_phone WHERE contact_id = ${m.s2Id}`);
    await db.execute(sql`DELETE FROM contact_postal WHERE contact_id = ${m.s2Id}`);
    await db.execute(sql`DELETE FROM contacts WHERE id = ${m.s2Id}`);
  }
  await db.execute(sql`DELETE FROM s1_staging.id_map WHERE entity = 'contact' AND s1_id IN (${sql.join(nids.map((n) => sql`${n}`), sql`, `)})`);
  await db.execute(sql`DELETE FROM s1_staging.records WHERE nid IN (${sql.join(nids.map((n) => sql`${n}`), sql`, `)})`);
  await db.execute(sql`DELETE FROM s1_staging.raw_users WHERE uid IN (${sql.join(uids.map((n) => sql`${n}`), sql`, `)})`);
  await db.execute(sql`DELETE FROM s1_staging.raw_user_contact WHERE uid IN (${sql.join(uids.map((n) => sql`${n}`), sql`, `)})`);
}

async function main() {
  await seedPhase1();

  console.log("run 1: ownership resolution on fresh load");
  const r1 = runLoader();
  check("loader exits 0", r1.status === 0, r1.status);
  check("report has sharedEmails section", !!r1.report?.detail?.sharedEmails, r1.report?.detail?.sharedEmails);
  const se1 = r1.report?.detail?.sharedEmails ?? {};
  check("byUserAccount address counted", se1.byUserAccount >= 1, se1);
  check("deferredNoOwner address counted", se1.deferredNoOwner >= 1, se1);
  check("owner contact (a2) keeps the email", (await contactEmailByNid(N.a2)) === EMAILS.a);
  check("non-owner contact (a1) loads email=null", (await contactEmailByNid(N.a1)) === null);
  check("deferred contacts (b1) load email=null", (await contactEmailByNid(N.b1)) === null);
  check("deferred contacts (b2) load email=null", (await contactEmailByNid(N.b2)) === null);
  const entries1: any[] = se1.entries ?? [];
  const aEntry = entries1.find((e) => e.rule === "byUserAccount" && e.winnerNid === N.a2);
  check("report entry names the winner (a2) with ownerUid", !!aEntry && aEntry.ownerUid === U.ownerA, aEntry);
  const bEntry = entries1.find((e) => e.rule === "deferredNoOwner" && (e.memberNids ?? []).includes(N.b1));
  check("report entry lists the deferred worklist address", !!bEntry && bEntry.winnerNid === null, bEntry);
  check("no email address appears in the report", !JSON.stringify(r1.report ?? {}).includes("example.test"));

  console.log("run 2: second consecutive run is zero-write");
  const r2 = runLoader();
  check("re-run exits 0", r2.status === 0, r2.status);
  check("re-run cleared nothing", (r2.report?.detail?.sharedEmails?.clearedOnRerun ?? 0) === 0, r2.report?.detail?.sharedEmails);
  check("owner contact (a2) still keeps the email", (await contactEmailByNid(N.a2)) === EMAILS.a);
  check(
    "re-run leaves every seeded non-owner/deferred contact null",
    (await contactEmailByNid(N.a1)) === null &&
      (await contactEmailByNid(N.b1)) === null &&
      (await contactEmailByNid(N.b2)) === null,
  );

  console.log("run 3: rerun repair — old first-wins assignment moves to the owner");
  {
    const m = await getMappings("contact", [N.a1, N.a2]);
    const a1Id = m.get(N.a1)!.s2Id;
    const a2Id = m.get(N.a2)!.s2Id;
    // simulate the pre-ruling state: first-wins put the address on a1
    await db.execute(sql`UPDATE contacts SET email = NULL WHERE id = ${a2Id}`);
    await db.execute(sql`UPDATE contacts SET email = ${` ${EMAILS.a.toUpperCase()} `} WHERE id = ${a1Id}`);
  }
  const r3 = runLoader();
  check("repair run exits 0", r3.status === 0, r3.status);
  check("repair run cleared the stale holder", (r3.report?.detail?.sharedEmails?.clearedOnRerun ?? 0) >= 1, r3.report?.detail?.sharedEmails);
  check("owner contact (a2) reclaimed the email", (await contactEmailByNid(N.a2)) === EMAILS.a);
  check("non-owner contact (a1) cleared", (await contactEmailByNid(N.a1)) === null);

  console.log("run 4: >1 owning account is FATAL before any write");
  await seedPhase2();
  const r4 = runLoader();
  check("loader exits 1", r4.status === 1, r4.status);
  check("FATAL message names the reject class", r4.out.includes("shared_email_multiple_owners"));
  check("nothing written for the multi-owner contacts", (await contactEmailByNid(N.cc1)) === undefined && (await contactEmailByNid(N.cc2)) === undefined);

  console.log("run 5: --allow-rejects defers the multi-owner address");
  const r5 = runLoader(true);
  check("allowed run exits 0", r5.status === 0, r5.status);
  check(
    "reject class counted",
    (r5.report?.rejectGate?.counts?.shared_email_multiple_owners ?? 0) >= 1,
    r5.report?.rejectGate?.counts,
  );
  check("multi-owner contacts load email=null", (await contactEmailByNid(N.cc1)) === null && (await contactEmailByNid(N.cc2)) === null);
  const cEntry = (r5.report?.detail?.sharedEmails?.entries ?? []).find((e: any) => e.rule === "deferredMultipleOwners");
  check("report entry shows deferredMultipleOwners", !!cEntry && cEntry.winnerNid === null, cEntry);

  await cleanup();
  console.log(failures === 0 ? "\nT3 SHARED-EMAIL SMOKE PASS" : `\nT3 SHARED-EMAIL SMOKE FAIL (${failures})`);
  await pgPool.end();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error(err);
  try {
    await cleanup();
  } catch (e) {
    console.error("cleanup failed", e);
  }
  await pgPool.end();
  process.exit(1);
});
