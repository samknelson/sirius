/**
 * Smoke test for the T27 user loader (load-users.ts). Seeds fake staged rows
 * (uids 9990xx, contact/worker nids 999008xx) covering:
 *   - clean linked member (mail == exactly-one contact email of a worker)
 *   - AMBIGUOUS mail (two workers whose contacts share the email, NO user
 *     association) → annotation ambiguous_worker_email, account still
 *     migrates, no link
 *   - association-resolved mail (two workers whose contacts share the email,
 *     but raw_user_contact ties the uid to ONE of them) → linked to the
 *     associated contact's worker, no annotation
 *   - association that cannot settle it (uid tied to ONE contact carrying
 *     TWO worker records) → still ambiguous_worker_email, no link
 *   - mail matching nothing → no_resolvable_worker annotation
 *   - duplicate mails (higher uid rejects duplicate_user_email)
 *   - blocked account (never created)
 *   - role upsert + assignment (custom role, built-ins skipped)
 *   - idempotent re-run (no duplicates, drift-reconciled)
 * Cleanup removes every seeded staged row, id_map entry, and S2 row.
 *
 * Run: npx tsx scripts/oneoffs/s1-t27-users-smoke.ts
 */
import { spawnSync } from "child_process";
import { db, pool as pgPool } from "../../server/storage/db";
import { sql } from "drizzle-orm";
import { storage } from "../../server/storage/database";
import {
  ensureStagingSchema,
  upsertRecords,
  ensureRawUserTables,
  upsertRawUsers,
  upsertRawUsersRoles,
  upsertRawRoles,
  upsertRawUserContacts,
} from "../s1-migration/lib/staging";
import { ensureIdMap, getMappings, putMapping } from "../s1-migration/lib/idmap";

const U = { linked: 999001, ambiguous: 999002, unmatched: 999003, dupA: 999004, dupB: 999005, blocked: 999006, assoc: 999007, assocAmb: 999008 };
const N = {
  c1: 99900801, w1: 99900802, c2: 99900803, w2: 99900804, c3: 99900805, w3: 99900806,
  c4: 99900807, w4: 99900808, c5: 99900809, w5: 99900810, c6: 99900811, w6a: 99900812, w6b: 99900813,
};
const RID_CUSTOM = 999101;
const RID_AUTH = 999102;
const RID_COLLIDE = 999103;
const EMAILS = {
  linked: "t27.smoke.linked@example.test",
  ambiguous: "t27.smoke.ambiguous@example.test",
  unmatched: "t27.smoke.unmatched@example.test",
  dup: "t27.smoke.dup@example.test",
  blocked: "t27.smoke.blocked@example.test",
  assoc: "t27.smoke.assoc@example.test",
  assocAmb: "t27.smoke.assocamb@example.test",
};
const ROLE_NAME = "T27 Smoke Role";

let failures = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log(`  ok: ${name}`);
  else {
    failures++;
    console.error(`  FAIL: ${name}${extra !== undefined ? ` — ${JSON.stringify(extra)}` : ""}`);
  }
}

function runLoader(): { status: number | null; out: string } {
  const res = spawnSync(
    "npx",
    [
      "tsx",
      "scripts/s1-migration/load-users.ts",
      "--allow-rejects",
      // dev synthetic staging carries its own trap rejects; the smoke only
      // asserts on its seeded uids.
      "missing_mail,invalid_mail,duplicate_user_email",
    ],
    { encoding: "utf8", timeout: 600_000 },
  );
  return { status: res.status, out: `${res.stdout}\n${res.stderr}` };
}

async function seed() {
  await ensureStagingSchema();
  await ensureIdMap();
  await ensureRawUserTables();

  // staged contacts + workers: c1/w1 unique email; c2/w2 + c3/w3 SHARE the
  // ambiguous email (two resolvable workers → ambiguous).
  const now = Math.floor(Date.now() / 1000);
  const rec = (bundle: string, nid: number, title: string, fields: Record<string, unknown>) => ({
    bundle, nid, vid: nid, title, uid: 1, status: 1, created: now, changed: now, fields,
  });
  await upsertRecords([
    rec("sirius_contact", N.c1, "T27 Linked", { field_sirius_email: { value: EMAILS.linked } }),
    rec("sirius_worker", N.w1, "T27 Linked", { field_sirius_contact: N.c1 }),
    rec("sirius_contact", N.c2, "T27 Amb A", { field_sirius_email: { value: EMAILS.ambiguous } }),
    rec("sirius_worker", N.w2, "T27 Amb A", { field_sirius_contact: N.c2 }),
    rec("sirius_contact", N.c3, "T27 Amb B", { field_sirius_email: { value: EMAILS.ambiguous } }),
    rec("sirius_worker", N.w3, "T27 Amb B", { field_sirius_contact: N.c3 }),
    // association-resolved: c4/c5 SHARE the assoc email, raw_user_contact
    // ties U.assoc to c5 → deterministic link to w5.
    rec("sirius_contact", N.c4, "T27 Assoc A", { field_sirius_email: { value: EMAILS.assoc } }),
    rec("sirius_worker", N.w4, "T27 Assoc A", { field_sirius_contact: N.c4 }),
    rec("sirius_contact", N.c5, "T27 Assoc B", { field_sirius_email: { value: EMAILS.assoc } }),
    rec("sirius_worker", N.w5, "T27 Assoc B", { field_sirius_contact: N.c5 }),
    // association CANNOT settle: one contact c6, TWO worker records → still
    // ambiguous even though U.assocAmb is tied to c6.
    rec("sirius_contact", N.c6, "T27 AssocAmb", { field_sirius_email: { value: EMAILS.assocAmb } }),
    rec("sirius_worker", N.w6a, "T27 AssocAmb A", { field_sirius_contact: N.c6 }),
    rec("sirius_worker", N.w6b, "T27 AssocAmb B", { field_sirius_contact: N.c6 }),
  ]);

  // real S2 workers behind w1/w2/w3 (id_map targets)
  const mk = async (given: string) => {
    const w = await storage.workers.createWorkerWithNameParts({ given, family: "T27Smoke", displayName: `${given} T27Smoke` });
    return w;
  };
  const w1 = await mk("Linked");
  const w2 = await mk("AmbA");
  const w3 = await mk("AmbB");
  const w4 = await mk("AssocA");
  const w5 = await mk("AssocB");
  const w6a = await mk("AssocAmbA");
  const w6b = await mk("AssocAmbB");
  await putMapping("worker", N.w1, w1.id, { stub: false, loader: "t27-smoke" });
  await putMapping("worker", N.w2, w2.id, { stub: false, loader: "t27-smoke" });
  await putMapping("worker", N.w3, w3.id, { stub: false, loader: "t27-smoke" });
  await putMapping("worker", N.w4, w4.id, { stub: false, loader: "t27-smoke" });
  await putMapping("worker", N.w5, w5.id, { stub: false, loader: "t27-smoke" });
  await putMapping("worker", N.w6a, w6a.id, { stub: false, loader: "t27-smoke" });
  await putMapping("worker", N.w6b, w6b.id, { stub: false, loader: "t27-smoke" });

  await upsertRawRoles([
    { rid: RID_CUSTOM, name: ROLE_NAME, weight: 0 },
    { rid: RID_AUTH, name: "authenticated user", weight: 0 },
  ]);
  await upsertRawUsers([
    { uid: U.linked, name: "t27-linked", mail: EMAILS.linked, created: now, access: now, login: now, status: 1, timezone: null, data: null },
    { uid: U.ambiguous, name: "t27-amb", mail: EMAILS.ambiguous, created: now, access: now, login: now, status: 1, timezone: null, data: null },
    { uid: U.unmatched, name: "t27-unmatched", mail: EMAILS.unmatched, created: now, access: now, login: 0, status: 1, timezone: null, data: null },
    { uid: U.dupA, name: "t27-dup-a", mail: EMAILS.dup, created: now, access: now, login: now, status: 1, timezone: null, data: null },
    { uid: U.dupB, name: "t27-dup-b", mail: EMAILS.dup, created: now, access: now, login: now, status: 1, timezone: null, data: null },
    { uid: U.blocked, name: "t27-blocked", mail: EMAILS.blocked, created: now, access: now, login: now, status: 0, timezone: null, data: null },
    { uid: U.assoc, name: "t27-assoc", mail: EMAILS.assoc, created: now, access: now, login: now, status: 1, timezone: null, data: null },
    { uid: U.assocAmb, name: "t27-assocamb", mail: EMAILS.assocAmb, created: now, access: now, login: now, status: 1, timezone: null, data: null },
  ]);
  // S1 user↔contact association (the shared-email ownership signal)
  await upsertRawUserContacts([
    { uid: U.assoc, delta: 0, contactNid: N.c5 },
    { uid: U.assocAmb, delta: 0, contactNid: N.c6 },
  ]);
  await upsertRawUsersRoles([
    { uid: U.linked, rid: RID_CUSTOM },
    { uid: U.linked, rid: RID_AUTH },
    { uid: U.unmatched, rid: RID_CUSTOM },
  ]);
  return { w1, w5 };
}

async function cleanup() {
  console.log("cleanup...");
  const uids = Object.values(U);
  const map = await getMappings("user", uids);
  for (const [, m] of map) {
    await db.execute(sql`DELETE FROM user_roles WHERE user_id = ${m.s2Id}`);
    await db.execute(sql`DELETE FROM auth_identities WHERE user_id = ${m.s2Id}`);
    await db.execute(sql`DELETE FROM users WHERE id = ${m.s2Id}`);
  }
  await db.execute(sql`DELETE FROM s1_staging.id_map WHERE entity = 'user' AND s1_id IN (${sql.join(uids.map((n) => sql`${n}`), sql`, `)})`);
  const wMap = await getMappings("worker", [N.w1, N.w2, N.w3, N.w4, N.w5, N.w6a, N.w6b]);
  for (const [, m] of wMap) {
    const w = await storage.workers.getWorker(m.s2Id);
    await db.execute(sql`DELETE FROM workers WHERE id = ${m.s2Id}`);
    if (w?.contactId) await db.execute(sql`DELETE FROM contacts WHERE id = ${w.contactId}`);
  }
  await db.execute(sql`DELETE FROM s1_staging.id_map WHERE entity = 'worker' AND s1_id IN (${N.w1}, ${N.w2}, ${N.w3}, ${N.w4}, ${N.w5}, ${N.w6a}, ${N.w6b})`);
  await db.execute(sql`DELETE FROM s1_staging.records WHERE nid IN (${sql.join(Object.values(N).map((n) => sql`${n}`), sql`, `)})`);
  await db.execute(sql`DELETE FROM s1_staging.raw_users WHERE uid IN (${sql.join(uids.map((n) => sql`${n}`), sql`, `)})`);
  await db.execute(sql`DELETE FROM s1_staging.raw_users_roles WHERE uid IN (${sql.join(uids.map((n) => sql`${n}`), sql`, `)})`);
  await db.execute(sql`DELETE FROM s1_staging.raw_user_contact WHERE uid IN (${sql.join(uids.map((n) => sql`${n}`), sql`, `)})`);
  await db.execute(sql`DELETE FROM s1_staging.raw_roles WHERE rid IN (${RID_CUSTOM}, ${RID_AUTH}, ${RID_COLLIDE})`);
  for (const name of [ROLE_NAME, "T27 Privileged Smoke", "T27 Privileged Smoke (s1-migrated)"]) {
    const role = await storage.users.getRoleByName(name);
    if (role) {
      await db.execute(sql`DELETE FROM user_roles WHERE role_id = ${role.id}`);
      await db.execute(sql`DELETE FROM roles WHERE id = ${role.id}`);
    }
  }
}

async function main() {
  const { w1, w5 } = await seed();

  console.log("run 0: --dry-run leaves S2 untouched");
  const preUsers = await db.execute(sql`SELECT count(*)::int AS n FROM users`);
  const preRoles = await db.execute(sql`SELECT count(*)::int AS n FROM roles`);
  const r0 = spawnSync(
    "npx",
    ["tsx", "scripts/s1-migration/load-users.ts", "--dry-run", "--allow-rejects", "missing_mail,invalid_mail,duplicate_user_email"],
    { encoding: "utf8", timeout: 600_000 },
  );
  check("dry-run exits 0", r0.status === 0, r0.status);
  const postUsers = await db.execute(sql`SELECT count(*)::int AS n FROM users`);
  const postRoles = await db.execute(sql`SELECT count(*)::int AS n FROM roles`);
  check("dry-run creates no users", (preUsers as any).rows[0].n === (postUsers as any).rows[0].n);
  check("dry-run creates no roles", (preRoles as any).rows[0].n === (postRoles as any).rows[0].n);
  check("dry-run creates no id_map entries", !(await getMappings("user", Object.values(U))).size);

  console.log("run 1: load-users");
  const r1 = runLoader();
  check("loader exits 0", r1.status === 0, r1.status);

  const map = await getMappings("user", Object.values(U));
  check("linked user mapped", map.has(U.linked));
  check("ambiguous user mapped (account migrates)", map.has(U.ambiguous));
  check("unmatched user mapped", map.has(U.unmatched));
  check("dupA mapped", map.has(U.dupA));
  check("dupB NOT mapped (duplicate_user_email)", !map.has(U.dupB));
  check("blocked NOT mapped", !map.has(U.blocked));

  const linked = map.get(U.linked) ? await storage.users.getUser(map.get(U.linked)!.s2Id) : null;
  const linkedData = (linked?.data as Record<string, unknown> | null) ?? {};
  check("linked user has migratedWorkerId", linkedData.migratedWorkerId === w1.id, linkedData);
  check("linked user isActive", linked?.isActive === true);
  check("linked user accountStatus pending", linked?.accountStatus === "pending", linked?.accountStatus);

  const amb = map.get(U.ambiguous) ? await storage.users.getUser(map.get(U.ambiguous)!.s2Id) : null;
  check("ambiguous user has NO worker link", !((amb?.data as any)?.migratedWorkerId), amb?.data);

  // association-based disambiguation (shared-email ownership signal)
  const assocU = map.get(U.assoc) ? await storage.users.getUser(map.get(U.assoc)!.s2Id) : null;
  check(
    "shared-email user links to the ASSOCIATED contact's worker (w5)",
    ((assocU?.data as any)?.migratedWorkerId) === w5.id,
    assocU?.data,
  );
  const assocAmbU = map.get(U.assocAmb) ? await storage.users.getUser(map.get(U.assocAmb)!.s2Id) : null;
  check(
    "one-contact-two-workers stays ambiguous (association cannot settle it)",
    !!assocAmbU && !((assocAmbU?.data as any)?.migratedWorkerId),
    assocAmbU?.data,
  );

  const role = await storage.users.getRoleByName(ROLE_NAME);
  check("custom role upserted", !!role);
  check("built-in role not migrated", !(await storage.users.getRoleByName("authenticated user")));
  if (linked && role) {
    const roles = await storage.users.getUserRoles(linked.id);
    check("linked user has custom role", roles.some((r) => r.id === role.id));
    check("linked user has worker role", roles.some((r) => r.name === "worker"));
  }

  console.log("run 2: idempotent re-run");
  const before = await db.execute(sql`SELECT count(*)::int AS n FROM users`);
  const r2 = runLoader();
  check("re-run exits 0", r2.status === 0, r2.status);
  const after = await db.execute(sql`SELECT count(*)::int AS n FROM users`);
  check(
    "re-run creates no new users",
    Number((before as any).rows[0].n) === Number((after as any).rows[0].n),
    { before: (before as any).rows[0].n, after: (after as any).rows[0].n },
  );

  console.log("run 3: stale-link reconciliation (linked → unresolved)");
  // Simulate an S1 correction: the linked user's contact email changes, so
  // the deterministic resolution no longer matches the user's mail. The
  // rerun must REMOVE the migration-owned worker link (stale link = access
  // to the wrong worker) — INCLUDING the migration-owned identity metadata,
  // so live sessions lose the association immediately.
  const linkedS2Id = map.get(U.linked)!.s2Id;
  await storage.authIdentities.create({
    userId: linkedS2Id,
    providerType: "okta",
    externalId: "t27-smoke-sub-linked",
    email: EMAILS.linked,
    metadata: { workerId: w1.id, preProvisioned: true, source: "s1-user-migration" },
  });
  const now3 = Math.floor(Date.now() / 1000);
  await upsertRecords([
    {
      bundle: "sirius_contact", nid: N.c1, vid: N.c1, title: "T27 Linked", uid: 1,
      status: 1, created: now3, changed: now3,
      fields: { field_sirius_email: { value: "t27.smoke.changed@example.test" } },
    },
  ]);
  const r3 = runLoader();
  check("stale-link re-run exits 0", r3.status === 0, r3.status);
  const linked3 = map.get(U.linked) ? await storage.users.getUser(map.get(U.linked)!.s2Id) : null;
  const linked3Data = (linked3?.data as Record<string, unknown> | null) ?? {};
  check("stale migratedWorkerId removed", linked3Data.migratedWorkerId === undefined, linked3Data);
  check("stale workerLinkSource removed", linked3Data.workerLinkSource === undefined, linked3Data);
  check("s1 provenance kept after link removal", (linked3Data.s1 as any)?.uid === U.linked, linked3Data);
  // first-login contract: the recorded-link helper must no longer expose the
  // former worker, so sign-in cannot use it.
  const { getMigratedWorkerId } = await import("../../server/auth/providers/okta");
  check(
    "getMigratedWorkerId no longer returns former worker",
    linked3 ? getMigratedWorkerId(linked3) === null : false,
  );
  // the loader must have cleared the migration-owned identity metadata…
  const identity3 = await storage.authIdentities.getByProviderAndExternalId("okta", "t27-smoke-sub-linked");
  check("identity metadata workerId cleared by loader", !!identity3 && (identity3.metadata as any)?.workerId === undefined, identity3?.metadata);
  // …and the session resolver must return null IMMEDIATELY (no login needed)
  const { resolveLinkedWorkerId } = await import("../../server/auth/worker-link");
  check(
    "resolveLinkedWorkerId null right after loader unlink",
    linked3 ? (await resolveLinkedWorkerId(linked3)) === null : false,
  );

  console.log("run 4: blocked-after-migration lifecycle (deactivate + revoke)");
  // The linked user (migrated in run 1, worker role granted) is now BLOCKED
  // in S1. The rerun must deactivate the S2 account and remove the worker
  // role so the Okta sign-in path denies it.
  await db.execute(sql`UPDATE s1_staging.raw_users SET status = 0 WHERE uid = ${U.linked}`);
  const r4 = runLoader();
  check("blocked-lifecycle re-run exits 0", r4.status === 0, r4.status);
  const linked4 = map.get(U.linked) ? await storage.users.getUser(map.get(U.linked)!.s2Id) : null;
  check("blocked user deactivated", linked4?.isActive === false, linked4?.isActive);
  const linked4Data = (linked4?.data as Record<string, unknown> | null) ?? {};
  check("blocked user has no migration-owned link", linked4Data.migratedWorkerId === undefined, linked4Data);
  if (linked4) {
    const roles4 = await storage.users.getUserRoles(linked4.id);
    check("blocked user's worker role removed", !roles4.some((r) => r.name === "worker"), roles4.map((r) => r.name));
    const { resolveLinkedWorkerId } = await import("../../server/auth/worker-link");
    check("resolveLinkedWorkerId null after lifecycle revocation", (await resolveLinkedWorkerId(linked4)) === null);
  }

  console.log("run 5: deleted-in-S1 sweep + reserved uid 1 never migrates");
  // dupA disappears from staging entirely (deleted in S1) → deactivated.
  // dupB (same email, never migrated) goes too, else it would claim dupA's
  // email and reject email_owned_by_other_s1_user.
  // A uid=1 row (Drupal superuser) sneaks into staging → never migrated.
  await db.execute(sql`DELETE FROM s1_staging.raw_users WHERE uid IN (${U.dupA}, ${U.dupB})`);
  const now5 = Math.floor(Date.now() / 1000);
  const hadUid1 = Number(((await db.execute(sql`SELECT count(*)::int AS n FROM s1_staging.raw_users WHERE uid = 1`)) as any).rows[0].n) > 0;
  if (!hadUid1) {
    await db.execute(sql`
      INSERT INTO s1_staging.raw_users (uid, name, mail, created, access, login, status, timezone, data)
      VALUES (1, 'admin', 't27.smoke.superuser@example.test', ${now5}, ${now5}, ${now5}, 1, NULL, NULL)
    `);
  }
  const r5 = runLoader();
  check("lifecycle re-run exits 0", r5.status === 0, r5.status);
  const dupA5 = map.get(U.dupA) ? await storage.users.getUser(map.get(U.dupA)!.s2Id) : null;
  check("deleted-in-S1 user deactivated", dupA5?.isActive === false, dupA5?.isActive);
  check("uid 1 never mapped", !(await getMappings("user", [1])).size);
  check("uid 1 user row never created", !(await storage.users.getUserByEmail("t27.smoke.superuser@example.test")));
  if (!hadUid1) await db.execute(sql`DELETE FROM s1_staging.raw_users WHERE uid = 1`);

  console.log("run 6: role name collision fails closed");
  // An S1 role named like a PRE-EXISTING S2 role (not migration-created)
  // must NOT bind to it — a zero-permission review role is used instead.
  const privileged = await storage.users.createRole({
    name: "T27 Privileged Smoke",
    description: "pre-existing S2 role with permissions (smoke)",
  });
  await db.execute(sql`
    INSERT INTO s1_staging.raw_roles (rid, name, weight) VALUES (${RID_COLLIDE}, 'T27 Privileged Smoke', 0)
    ON CONFLICT (rid) DO UPDATE SET name = EXCLUDED.name
  `);
  await db.execute(sql`
    INSERT INTO s1_staging.raw_users_roles (uid, rid) VALUES (${U.unmatched}, ${RID_COLLIDE})
    ON CONFLICT DO NOTHING
  `);
  const r6 = runLoader();
  check("collision re-run exits 0", r6.status === 0, r6.status);
  const reviewRole = await storage.users.getRoleByName("T27 Privileged Smoke (s1-migrated)");
  check("review role created for collision", !!reviewRole);
  const unmatched6 = map.get(U.unmatched) ? await storage.users.getUser(map.get(U.unmatched)!.s2Id) : null;
  if (unmatched6) {
    const roles6 = await storage.users.getUserRoles(unmatched6.id);
    check("user got the review role, NOT the privileged role", roles6.some((r) => r.id === reviewRole?.id) && !roles6.some((r) => r.id === privileged.id), roles6.map((r) => r.name));
  }

  await cleanup();
  console.log(failures === 0 ? "\nT27 SMOKE PASS" : `\nT27 SMOKE FAIL (${failures})`);
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
