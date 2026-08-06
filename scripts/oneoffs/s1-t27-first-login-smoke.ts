/**
 * Smoke test for T27 first-login linking paths in the Okta provider's
 * checkUserAccess (exported for harnesses) using FABRICATED Okta identities —
 * no real Okta involved.
 * Covers:
 *   1. pre-provisioned identity fast path (auth_identities row created by
 *      the provisioning script, externalId = fabricated Okta sub) → session
 *      lands on the migrated user, workerId metadata intact;
 *   2. no-identity migrated-account path (users.data.migratedWorkerId
 *      preferred over the contact-email heuristic — even when the contact
 *      email would be ambiguous);
 *   3. inactive migrated user is denied;
 *   4. SSN+DOB fallback: verifyWorkerIdentity + verified-worker session
 *      linking still works for accounts the loader could not resolve.
 * Cleanup removes every fabricated row.
 *
 * Run: npx tsx scripts/oneoffs/s1-t27-first-login-smoke.ts
 */
import { db, pool as pgPool } from "../../server/storage/db";
import { sql } from "drizzle-orm";
import { storage } from "../../server/storage/database";
import { checkUserAccess } from "../../server/auth/providers/okta";
import { resolveLinkedWorkerId } from "../../server/auth/worker-link";
import { verifyWorkerIdentity } from "../../server/auth/identity-verification";

let failures = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log(`  ok: ${name}`);
  else {
    failures++;
    console.error(`  FAIL: ${name}${extra !== undefined ? ` — ${JSON.stringify(extra)}` : ""}`);
  }
}

const EMAILS = {
  pre: "t27.login.pre@example.test",
  mig: "t27.login.mig@example.test",
  inactive: "t27.login.inactive@example.test",
  stale: "t27.login.stale@example.test",
  unlinked: "t27.login.unlinked@example.test",
  stalepre: "t27.login.stalepre@example.test",
  legacy: "t27.login.legacy@example.test",
  fallback: "t27.login.fallback@example.test",
  clerkpre: "t27.login.clerkpre@example.test",
  clerkunlinked: "t27.login.clerkunlinked@example.test",
  clerkghost: "t27.login.clerkghost@example.test",
  clerkstalepre: "t27.login.clerkstalepre@example.test",
  clerklegacy: "t27.login.clerklegacy@example.test",
};
const SUBS = {
  pre: "smoke-okta-sub-pre",
  mig: "smoke-okta-sub-mig",
  inactive: "smoke-okta-sub-inactive",
  stale: "smoke-okta-sub-stale",
  unlinked: "smoke-okta-sub-unlinked",
  stalepre: "smoke-okta-sub-stalepre",
  legacy: "smoke-okta-sub-legacy",
  fallback: "smoke-okta-sub-fallback",
  clerkpre: "smoke-clerk-sub-pre",
  clerkunlinked: "smoke-clerk-sub-unlinked",
  clerkghost: "smoke-clerk-sub-ghost",
  clerkstalepre: "smoke-clerk-sub-stalepre",
  clerklegacy: "smoke-clerk-sub-legacy",
};
const SSN = "900-88-7761";
const DOB = "1980-04-05";

const createdUserIds: string[] = [];
const createdWorkerIds: string[] = [];

async function mkWorker(given: string, opts: { email?: string; ssn?: string; birthDate?: string } = {}) {
  const w = await storage.workers.createWorkerWithNameParts({ given, family: "T27Login", displayName: `${given} T27Login` });
  createdWorkerIds.push(w.id);
  if (opts.email) await storage.contacts.updateEmail(w.contactId, opts.email);
  if (opts.birthDate) await db.execute(sql`UPDATE contacts SET birth_date = ${opts.birthDate} WHERE id = ${w.contactId}`);
  if (opts.ssn) await db.execute(sql`UPDATE workers SET ssn = ${opts.ssn.replace(/\D/g, "")} WHERE id = ${w.id}`);
  return w;
}

async function mkUser(email: string, data: Record<string, unknown>, isActive = true) {
  const u = await storage.users.createUser({
    email,
    firstName: "T27",
    lastName: "Login",
    isActive,
    accountStatus: "pending",
    data,
  });
  createdUserIds.push(u.id);
  return u;
}

async function cleanup() {
  console.log("cleanup...");
  for (const sub of Object.values(SUBS)) {
    await db.execute(sql`DELETE FROM auth_identities WHERE provider_type IN ('okta', 'clerk') AND external_id = ${sub}`);
  }
  for (const id of createdUserIds) {
    await db.execute(sql`DELETE FROM auth_identities WHERE user_id = ${id}`);
    await db.execute(sql`DELETE FROM user_roles WHERE user_id = ${id}`);
    await db.execute(sql`DELETE FROM users WHERE id = ${id}`);
  }
  // linkWorkerToAuthIdentity may have created users by contact email
  for (const email of Object.values(EMAILS)) {
    const u = await storage.users.getUserByEmail(email);
    if (u) {
      await db.execute(sql`DELETE FROM auth_identities WHERE user_id = ${u.id}`);
      await db.execute(sql`DELETE FROM user_roles WHERE user_id = ${u.id}`);
      await db.execute(sql`DELETE FROM users WHERE id = ${u.id}`);
    }
  }
  for (const id of createdWorkerIds) {
    const w = await storage.workers.getWorker(id);
    await db.execute(sql`DELETE FROM workers WHERE id = ${id}`);
    if (w?.contactId) await db.execute(sql`DELETE FROM contacts WHERE id = ${w.contactId}`);
  }
  if (createdWorkerRole) {
    const role = await storage.users.getRoleByName("worker");
    if (role) {
      await db.execute(sql`DELETE FROM user_roles WHERE role_id = ${role.id}`);
      await db.execute(sql`DELETE FROM roles WHERE id = ${role.id}`);
    }
  }
}

function fakeReq(session: Record<string, unknown> = {}): any {
  return { session: { ...session, save: (cb: (e?: unknown) => void) => cb() } };
}

let createdWorkerRole = false;
async function ensureWorkerRole() {
  const existing = await storage.users.getRoleByName("worker");
  if (!existing) {
    await storage.users.createRole({ name: "worker", description: "T27 smoke (temp)" });
    createdWorkerRole = true;
  }
}

async function main() {
  await ensureWorkerRole();
  // ---- 1. pre-provisioned identity fast path ----
  console.log("1: pre-provisioned identity fast path");
  {
    const worker = await mkWorker("Pre", { email: EMAILS.pre });
    const user = await mkUser(EMAILS.pre, { s1: { uid: 991 }, migratedWorkerId: worker.id });
    await storage.authIdentities.create({
      userId: user.id,
      providerType: "okta",
      externalId: SUBS.pre,
      email: EMAILS.pre,
      metadata: { workerId: worker.id, preProvisioned: true, source: "s1-user-migration" },
    });
    const res = await checkUserAccess({ sub: SUBS.pre, email: EMAILS.pre, given_name: "Pre", family_name: "T27Login" }, fakeReq());
    check("allowed", res.allowed === true);
    check("lands on the migrated user", res.user?.id === user.id, res.user?.id);
    const identity = await storage.authIdentities.getByProviderAndExternalId("okta", SUBS.pre);
    check("workerId metadata intact", (identity?.metadata as any)?.workerId === worker.id);
    check("no duplicate user created", (await storage.users.getUserByEmail(EMAILS.pre))?.id === user.id);
  }

  // ---- 2. no-identity migrated path beats email heuristics ----
  console.log("2: migrated-account path (no identity yet)");
  {
    // the RECORDED link points at worker A; the IdP email matches worker B's
    // contact — the migrated path must prefer the recorded link over the
    // email heuristic. (S2 contacts enforce unique emails, so true ambiguity
    // cannot exist post-migration; mismatch is the interesting case.)
    const workerA = await mkWorker("Mig", { email: "t27.login.mig.other@example.test" });
    const workerB = await mkWorker("MigTwin", { email: EMAILS.mig });
    void workerB;
    const user = await mkUser(EMAILS.mig, { s1: { uid: 992 }, migratedWorkerId: workerA.id });
    const res = await checkUserAccess({ sub: SUBS.mig, email: EMAILS.mig, given_name: "Mig", family_name: "T27Login" }, fakeReq());
    check("allowed", res.allowed === true);
    check("lands on the migrated user", res.user?.id === user.id, res.user?.id);
    const identity = await storage.authIdentities.getByProviderAndExternalId("okta", SUBS.mig);
    check("identity carries the RECORDED workerId (not the email match)", (identity?.metadata as any)?.workerId === workerA.id, identity?.metadata);
    const roles = await storage.users.getUserRoles(user.id);
    check("worker role assigned", roles.some((r) => r.name === "worker"), roles.map((r) => r.name));
  }

  // ---- 3. inactive migrated user denied ----
  console.log("3: inactive migrated user denied");
  {
    const worker = await mkWorker("Inact", { email: EMAILS.inactive });
    await mkUser(EMAILS.inactive, { s1: { uid: 993 }, migratedWorkerId: worker.id }, false);
    const res = await checkUserAccess({ sub: SUBS.inactive, email: EMAILS.inactive }, fakeReq());
    check("denied", res.allowed === false, res);
    const identity = await storage.authIdentities.getByProviderAndExternalId("okta", SUBS.inactive);
    check("no identity created", !identity);
  }

  // ---- 3b. recorded link with MISSING worker → fail-closed deny ----
  console.log("3b: stale recorded worker link denies (fail-closed)");
  {
    // recorded migratedWorkerId points at a deleted worker while the email
    // matches a DIFFERENT live worker — must deny, never fall through to the
    // email heuristic.
    const ghost = await mkWorker("Ghost", {});
    const live = await mkWorker("Stale", { email: EMAILS.stale });
    void live;
    const user = await mkUser(EMAILS.stale, { s1: { uid: 994 }, migratedWorkerId: ghost.id, workerLinkSource: "s1-user-migration" });
    await db.execute(sql`DELETE FROM workers WHERE id = ${ghost.id}`);
    const res = await checkUserAccess({ sub: SUBS.stale, email: EMAILS.stale, given_name: "Stale", family_name: "T27Login" }, fakeReq());
    check("denied (fail-closed)", res.allowed === false, res);
    const identity = await storage.authIdentities.getByProviderAndExternalId("okta", SUBS.stale);
    check("no identity created for stale link", !identity, identity?.metadata);
    const rolesNow = await storage.users.getUserRoles(user.id);
    check("no worker role granted via email heuristic", !rolesNow.some((r) => r.name === "worker"), rolesNow.map((r) => r.name));
  }

  // ---- 3c. migrated UNLINKED account: no email-heuristic worker linking ----
  console.log("3c: migrated unlinked account never email-links a worker");
  {
    // account has S1 provenance but NO recorded link (loader reconciliation:
    // unresolved/ambiguous) while the IdP email matches a live worker's
    // contact — login must land on the pre-created user WITHOUT any worker
    // association or worker role.
    const bystander = await mkWorker("Unlinked", { email: EMAILS.unlinked });
    void bystander;
    const user = await mkUser(EMAILS.unlinked, { s1: { uid: 995 } });
    const res = await checkUserAccess({ sub: SUBS.unlinked, email: EMAILS.unlinked, given_name: "Unlinked", family_name: "T27Login" }, fakeReq());
    check("allowed (account itself links)", res.allowed === true, res);
    check("lands on the migrated user", res.user?.id === user.id, res.user?.id);
    const identity = await storage.authIdentities.getByProviderAndExternalId("okta", SUBS.unlinked);
    check("identity created without workerId", !!identity && !(identity.metadata as any)?.workerId, identity?.metadata);
    const rolesNow = await storage.users.getUserRoles(user.id);
    check("no worker role via email heuristic", !rolesNow.some((r) => r.name === "worker"), rolesNow.map((r) => r.name));
    // the session resolver used by /api/auth/user, the menu, and dashboards
    // must ALSO refuse the email fallback for this migrated account.
    const fresh = await storage.users.getUser(user.id);
    check(
      "resolveLinkedWorkerId returns null for migrated unlinked account",
      (await resolveLinkedWorkerId(fresh)) === null,
    );
  }

  // ---- 3d. pre-provisioned identity reconciles removed migration link ----
  console.log("3d: stale pre-provisioned identity link is reconciled");
  {
    // identity metadata carries a migration-owned workerId, but a loader
    // rerun REMOVED the user's migration link — the fast path must strip
    // the stale workerId + worker role instead of trusting it.
    const former = await mkWorker("StalePre", { email: EMAILS.stalepre });
    const user = await mkUser(EMAILS.stalepre, { s1: { uid: 996 } }); // link already removed
    await storage.authIdentities.create({
      userId: user.id,
      providerType: "okta",
      externalId: SUBS.stalepre,
      email: EMAILS.stalepre,
      metadata: { workerId: former.id, preProvisioned: true, source: "s1-user-migration" },
    });
    const workerRole = await storage.users.getRoleByName("worker");
    if (workerRole) await storage.users.assignRoleToUser({ userId: user.id, roleId: workerRole.id });
    const res = await checkUserAccess({ sub: SUBS.stalepre, email: EMAILS.stalepre, given_name: "StalePre", family_name: "T27Login" }, fakeReq());
    check("login allowed (account access kept)", res.allowed === true, res);
    check("lands on the migrated user", res.user?.id === user.id, res.user?.id);
    const identity = await storage.authIdentities.getByProviderAndExternalId("okta", SUBS.stalepre);
    check("stale workerId stripped from identity", !!identity && !(identity.metadata as any)?.workerId, identity?.metadata);
    const rolesNow = await storage.users.getUserRoles(user.id);
    check("worker role removed with the stale link", !rolesNow.some((r) => r.name === "worker"), rolesNow.map((r) => r.name));
    // post-reconciliation, the session resolver must not re-associate the
    // account with any worker (identity stripped + migrated ⇒ no email fallback).
    const fresh = await storage.users.getUser(user.id);
    check(
      "resolveLinkedWorkerId returns null after reconciliation",
      (await resolveLinkedWorkerId(fresh)) === null,
    );
  }

  // ---- 3e. session resolver: legacy vs migrated + identity preference ----
  console.log("3e: resolveLinkedWorkerId (the /api/auth/user resolver)");
  {
    // legacy NON-migrated account (no s1 provenance) keeps the email fallback…
    const legacyWorker = await mkWorker("Legacy", { email: EMAILS.legacy });
    const legacyUser = await mkUser(EMAILS.legacy, {});
    check(
      "legacy account still email-falls-back",
      (await resolveLinkedWorkerId(legacyUser)) === legacyWorker.id,
    );
    // …and identity metadata always wins over email for everyone.
    const otherWorker = await mkWorker("LegacyId", {});
    await storage.authIdentities.create({
      userId: legacyUser.id,
      providerType: "okta",
      externalId: SUBS.legacy,
      email: EMAILS.legacy,
      metadata: { workerId: otherWorker.id },
    });
    check(
      "identity metadata preferred over email match",
      (await resolveLinkedWorkerId(legacyUser)) === otherWorker.id,
    );
  }

  // ---- 3f. Clerk provider parity (same fail-closed policy) ----
  console.log("3f: Clerk provider — migrated accounts never email-discover");
  const { resolveClerkUser } = await import("../../server/auth/providers/clerk");
  {
    // migrated + recorded link: links to the RECORDED worker even though the
    // login email matches a DIFFERENT worker's contact email.
    const recorded = await mkWorker("ClerkPre", {});
    const bystander = await mkWorker("ClerkBystander", { email: EMAILS.clerkpre });
    const user = await mkUser(EMAILS.clerkpre, { s1: { uid: 997 }, migratedWorkerId: recorded.id, workerLinkSource: "s1-user-migration" });
    const res = await resolveClerkUser(SUBS.clerkpre, { email: EMAILS.clerkpre, firstName: "ClerkPre", lastName: "T27Login" });
    check("clerk: migrated pre-linked login allowed", res.allowed === true, res);
    check("clerk: lands on the migrated user", res.user?.id === user.id, res.user?.id);
    const identity = await storage.authIdentities.getByProviderAndExternalId("clerk", SUBS.clerkpre);
    check("clerk: identity carries RECORDED worker, not email match", (identity?.metadata as any)?.workerId === recorded.id && (identity?.metadata as any)?.workerId !== bystander.id, identity?.metadata);
    check("clerk: identity tagged migration-owned", (identity?.metadata as any)?.source === "s1-user-migration", identity?.metadata);
  }
  {
    // migrated UNLINKED: email matches a bystander worker → must NOT link.
    const bystander = await mkWorker("ClerkUnlinked", { email: EMAILS.clerkunlinked });
    const user = await mkUser(EMAILS.clerkunlinked, { s1: { uid: 998 } });
    const res = await resolveClerkUser(SUBS.clerkunlinked, { email: EMAILS.clerkunlinked, firstName: "ClerkUnlinked", lastName: "T27Login" });
    check("clerk: migrated unlinked login allowed", res.allowed === true, res);
    const identity = await storage.authIdentities.getByProviderAndExternalId("clerk", SUBS.clerkunlinked);
    check("clerk: identity created WITHOUT workerId", !!identity && !(identity.metadata as any)?.workerId, identity?.metadata);
    const fresh = await storage.users.getUser(user.id);
    check("clerk: resolver returns null (no bystander leak)", (await resolveLinkedWorkerId(fresh)) === null && !!bystander.id);
  }
  {
    // migrated + recorded link pointing at a DELETED worker → fail closed.
    const ghost = await mkWorker("ClerkGhost", {});
    await db.execute(sql`DELETE FROM workers WHERE id = ${ghost.id}`);
    await db.execute(sql`DELETE FROM contacts WHERE id = ${ghost.contactId}`);
    await mkUser(EMAILS.clerkghost, { s1: { uid: 999 }, migratedWorkerId: ghost.id, workerLinkSource: "s1-user-migration" });
    const res = await resolveClerkUser(SUBS.clerkghost, { email: EMAILS.clerkghost, firstName: "ClerkGhost", lastName: "T27Login" });
    check("clerk: missing recorded worker DENIES login", res.allowed === false, res);
    check("clerk: no identity created on deny", !(await storage.authIdentities.getByProviderAndExternalId("clerk", SUBS.clerkghost)));
  }
  {
    // existing migration-owned clerk identity whose link the loader removed →
    // login reconciles: workerId stripped, worker role removed.
    const former = await mkWorker("ClerkStalePre", { email: EMAILS.clerkstalepre });
    const user = await mkUser(EMAILS.clerkstalepre, { s1: { uid: 1000 } }); // link already removed
    await storage.authIdentities.create({
      userId: user.id,
      providerType: "clerk",
      externalId: SUBS.clerkstalepre,
      email: EMAILS.clerkstalepre,
      metadata: { workerId: former.id, preProvisioned: true, source: "s1-user-migration" },
    });
    const workerRole = await storage.users.getRoleByName("worker");
    if (workerRole) await storage.users.assignRoleToUser({ userId: user.id, roleId: workerRole.id });
    const res = await resolveClerkUser(SUBS.clerkstalepre, { email: EMAILS.clerkstalepre, firstName: "ClerkStalePre", lastName: "T27Login" });
    check("clerk: stale-identity login allowed (account kept)", res.allowed === true, res);
    const identity = await storage.authIdentities.getByProviderAndExternalId("clerk", SUBS.clerkstalepre);
    check("clerk: stale workerId stripped from identity", !!identity && !(identity.metadata as any)?.workerId, identity?.metadata);
    const rolesNow = await storage.users.getUserRoles(user.id);
    check("clerk: worker role removed with the stale link", !rolesNow.some((r) => r.name === "worker"), rolesNow.map((r) => r.name));
    const fresh = await storage.users.getUser(user.id);
    check("clerk: resolver null after reconciliation", (await resolveLinkedWorkerId(fresh)) === null);
  }
  {
    // legacy NON-migrated account keeps the email-discovery behavior.
    const worker = await mkWorker("ClerkLegacy", { email: EMAILS.clerklegacy });
    const user = await mkUser(EMAILS.clerklegacy, {});
    const res = await resolveClerkUser(SUBS.clerklegacy, { email: EMAILS.clerklegacy, firstName: "ClerkLegacy", lastName: "T27Login" });
    check("clerk: legacy login allowed", res.allowed === true, res);
    const identity = await storage.authIdentities.getByProviderAndExternalId("clerk", SUBS.clerklegacy);
    check("clerk: legacy identity email-links worker", (identity?.metadata as any)?.workerId === worker.id, identity?.metadata);
    check("clerk: legacy identity NOT migration-tagged", (identity?.metadata as any)?.source === undefined && !!user.id, identity?.metadata);
  }

  // ---- 4. SSN+DOB fallback (unresolved account) ----
  console.log("4: SSN+DOB fallback still works");
  {
    const worker = await mkWorker("Fallback", { email: EMAILS.fallback, ssn: SSN, birthDate: DOB });
    const verified = await verifyWorkerIdentity({
      firstName: "Fallback",
      lastName: "T27Login",
      ssn: SSN,
      dateOfBirth: DOB,
    });
    check("identity verification verifies", verified.status === "verified", verified.status);
    if (verified.status === "verified") {
      check("verification finds the worker", verified.workerId === worker.id);
      const req = fakeReq({ verifiedWorker: { workerId: verified.workerId, contactId: verified.contactId, verifiedAt: Date.now() } });
      const res = await checkUserAccess({ sub: SUBS.fallback, email: EMAILS.fallback, given_name: "Fallback", family_name: "T27Login" }, req);
      check("fallback login allowed", res.allowed === true, res);
      const identity = await storage.authIdentities.getByProviderAndExternalId("okta", SUBS.fallback);
      check("fallback identity tagged with workerId", (identity?.metadata as any)?.workerId === worker.id, identity?.metadata);
    }
  }

  await cleanup();
  console.log(failures === 0 ? "\nT27 FIRST-LOGIN SMOKE PASS" : `\nT27 FIRST-LOGIN SMOKE FAIL (${failures})`);
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
