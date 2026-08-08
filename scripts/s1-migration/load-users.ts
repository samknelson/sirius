/**
 * T27 loader — S1 `users`/`users_roles`/`role`/`authmap` → S2 `users`,
 * `roles`, `user_roles` (+ recorded worker pre-link). Closes T27.
 *
 * Ruling (03-transformations T27 + 2026-08 uid→worker addendum):
 *   - Only ACTIVE S1 accounts load (`status = 1`); blocked accounts are
 *     counted (`skippedBlocked`) and never created. uid 0/1 never staged
 *     (and defensively never loaded; historical uid 0/1 mappings are
 *     deactivated + unmapped).
 *   - Lifecycle rerun reconciliation: previously migrated accounts whose S1
 *     account became BLOCKED or was DELETED from staging are deactivated,
 *     their migration-owned worker link and worker role revoked.
 *   - Role name collisions FAIL CLOSED: an S1 role matching a pre-existing
 *     S2 role (not created by this migration, not explicitly approved in
 *     APPROVED_ROLE_BINDINGS) binds to a zero-permission
 *     "<name> (s1-migrated)" review role instead — never inherits existing
 *     S2 permissions.
 *   - `email = lower(mail)`. Accounts with no mail cannot sign in via Okta →
 *     reject `missing_mail` (staff decide manually; expected for legacy
 *     service accounts).
 *   - Duplicate mails across S1 accounts: FIRST uid (ascending) wins, later
 *     uids reject `duplicate_user_email` → reconciliation report.
 *   - Names: worker-linked accounts take the contact's given/family; others
 *     use the mail local-part as firstName (S1 has no name parts).
 *   - Roles: staged `role` names upsert into S2 `roles` BY NAME (created
 *     roles carry zero permissions — conscious manual review step; Okta
 *     group→role mapping is Task #2, out of scope here). D7 built-ins
 *     (anonymous/authenticated user) are never migrated.
 *   - uid→worker: deterministic at LOAD time, not first-login. lower(mail)
 *     must equal the staged contact email (field_sirius_email) of EXACTLY ONE
 *     contact that is referenced by EXACTLY ONE staged worker
 *     (field_sirius_contact) resolvable through id_map 'worker'. The link is
 *     recorded in users.data ({ migratedWorkerId, s1Uid }) so first Okta
 *     sign-in lands on the pre-linked account with no fuzzy matching.
 *     0 matches → annotation `no_resolvable_worker` (staff-only or
 *     reconciliation); >1 → annotation `ambiguous_worker_email`. Annotations
 *     do NOT skip the user row — the account still migrates, only unlinked.
 *   - `pass` / `tfa_*` are never staged, never read, never migrated.
 *   - `authmap` rows are staged for audit but NOT loaded — S2 Okta identities
 *     are created by the pre-provisioning script / first login, keyed by the
 *     Okta user id (`sub`), which S1 cannot know.
 *
 * Reconciliation report (aggregates + uids only, HIPAA-safe): printed under
 * `reconciliation` — unlinked actives, ambiguous, duplicates — for staff
 * review instead of silent guessing.
 *
 * Idempotent via id_map entity "user" (s1_id = uid). Re-runs drift-reconcile
 * email/name/isActive and missing role assignments; operator-granted extra
 * roles are KEPT (counted `s2ExtraRolesKept`).
 *
 * Usage:
 *   npx tsx scripts/s1-migration/load-users.ts [--dry-run] [--allow-rejects r1,r2]
 */
import { storage } from "../../server/storage/database";
import { withNotificationsSuppressed } from "../../server/middleware/request-context";
import {
  ensureStagingSchema,
  recordRun,
  ensureRawUserTables,
  pagedRawUsers,
  loadRawUsersRoles,
  loadRawRoles,
  type RawUserRow,
} from "./lib/staging";
import { ensureIdMap, getMappings, getAllMappings, putMapping, deleteMapping } from "./lib/idmap";
import { RejectLog, loadStaged, strOf, targetNidOf } from "./lib/loader-utils";
import { makeProgressLogger } from "./lib/progress";

const DRY_RUN = process.argv.includes("--dry-run");
const ALLOWED_REJECTS: string[] = (() => {
  const i = process.argv.indexOf("--allow-rejects");
  return i >= 0 ? String(process.argv[i + 1] ?? "").split(",").filter(Boolean) : [];
})();
const LOADER = "t27-users";
const PAGE = 500;

/** Row-skipping reasons — the verify pass skips exactly these. */
const FATAL_REASONS = [
  "missing_mail",
  "invalid_mail",
  "duplicate_user_email",
  "email_owned_by_other_s1_user",
  "user_create_failed",
  "user_update_failed",
  "role_assign_failed",
] as const;

/** Non-skipping annotations (account migrates, link doesn't). */
const ANNOTATIONS = ["no_resolvable_worker", "ambiguous_worker_email"] as const;

/** D7 built-in roles that must never become S2 roles. */
const D7_BUILTIN_ROLES = new Set(["anonymous user", "authenticated user"]);

/**
 * Explicitly APPROVED bindings of S1 role names to pre-existing S2 roles
 * (lower-cased names). Empty by design: an S1 role whose name collides with
 * a pre-existing S2 role must NEVER silently inherit its permissions —
 * privileged names like "administrator" would escalate. Colliding roles get
 * a zero-permission review role named "<name> (s1-migrated)" instead; add a
 * name here only after an explicit staff ruling (Okta group→role mapping is
 * Task #2).
 */
const APPROVED_ROLE_BINDINGS = new Set<string>([]);

/** Marker that identifies roles CREATED by this migration (safe to rebind). */
const T27_ROLE_MARKER = "(T27)";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function main() {
  const startedAt = new Date();
  await ensureStagingSchema();
  await ensureIdMap();
  await ensureRawUserTables();

  const report: Record<string, unknown> = { loader: LOADER, dryRun: DRY_RUN, allowedRejects: ALLOWED_REJECTS };
  const rejects = new RejectLog();

  // ---- worker resolution index: lower(contact email) → contact nids →
  // worker nids → id_map worker s2 ids -------------------------------------
  // Heartbeat from process start — the staged contact/worker loads and bulk
  // crosswalks below are minutes on the real target; liveness ticks until the
  // user total is known.
  const progress = makeProgressLogger(LOADER, 0, { verb: "users" });
  progress.phase("pre-scan");

  const contacts = await loadStaged("sirius_contact");
  const workers = await loadStaged("sirius_worker");
  const contactNidsByEmail = new Map<string, number[]>();
  for (const c of contacts) {
    const email = strOf(c.fields, "field_sirius_email");
    if (!email) continue;
    const key = email.toLowerCase();
    const list = contactNidsByEmail.get(key) ?? [];
    list.push(c.nid);
    contactNidsByEmail.set(key, list);
  }
  const workerNidsByContactNid = new Map<number, number[]>();
  for (const w of workers) {
    const cnid = targetNidOf(w.fields, "field_sirius_contact");
    if (cnid == null) continue;
    const list = workerNidsByContactNid.get(cnid) ?? [];
    list.push(w.nid);
    workerNidsByContactNid.set(cnid, list);
  }
  const workerMap = await getMappings("worker", workers.map((w) => w.nid));
  const contactMap = await getMappings("contact", contacts.map((c) => c.nid));

  /** Resolve mail → exactly-one S2 worker id, or a classification. */
  function resolveWorker(mailLower: string):
    | { kind: "linked"; workerNid: number; workerS2Id: string; contactNid: number }
    | { kind: "none" }
    | { kind: "ambiguous"; candidates: number[] } {
    const cnids = contactNidsByEmail.get(mailLower) ?? [];
    const workerCandidates: Array<{ workerNid: number; contactNid: number }> = [];
    for (const cnid of cnids) {
      for (const wnid of workerNidsByContactNid.get(cnid) ?? []) {
        workerCandidates.push({ workerNid: wnid, contactNid: cnid });
      }
    }
    if (workerCandidates.length === 0) return { kind: "none" };
    if (workerCandidates.length > 1)
      return { kind: "ambiguous", candidates: workerCandidates.map((c) => c.workerNid) };
    const only = workerCandidates[0];
    const mapped = workerMap.get(only.workerNid);
    if (!mapped || mapped.stub) return { kind: "none" };
    return { kind: "linked", workerNid: only.workerNid, workerS2Id: mapped.s2Id, contactNid: only.contactNid };
  }

  // ---- roles ---------------------------------------------------------------
  const rawRoles = await loadRawRoles();
  const usersRoles = await loadRawUsersRoles();
  const ridsByUid = new Map<number, number[]>();
  for (const ur of usersRoles) {
    const list = ridsByUid.get(ur.uid) ?? [];
    list.push(ur.rid);
    ridsByUid.set(ur.uid, list);
  }
  /** rid → S2 role id (built-ins map to null). */
  const roleIdByRid = new Map<number, string | null>();
  const roleStats = { upserted: 0, reused: 0, builtinsSkipped: 0, collisions: 0 };
  const roleCollisions: Array<{ rid: number; s1Name: string; reviewRole: string }> = [];
  /** Create (or reuse) a zero-permission migration role. */
  async function upsertMigrationRole(rid: number, name: string, weight: number, note: string): Promise<string> {
    const existing = await storage.users.getRoleByName(name);
    if (existing) return existing.id;
    if (DRY_RUN) return `dry-run-role-${rid}`;
    const created = await withNotificationsSuppressed(() =>
      storage.users.createRole({
        name,
        description: `Migrated from S1 role rid=${rid} ${T27_ROLE_MARKER}${note} — permissions require manual review`,
        sequence: 100 + weight,
      }),
    );
    return created.id;
  }
  for (const r of rawRoles) {
    const name = (r.name ?? "").trim();
    if (!name || D7_BUILTIN_ROLES.has(name.toLowerCase())) {
      roleIdByRid.set(r.rid, null);
      roleStats.builtinsSkipped++;
      continue;
    }
    const existing = await storage.users.getRoleByName(name);
    if (existing) {
      // FAIL CLOSED on name collisions: only roles this migration created
      // (T27 marker) or explicitly approved bindings may reuse an existing
      // S2 role. Anything else (e.g. a pre-existing privileged
      // "administrator") gets a zero-permission review role instead.
      const migrationCreated = (existing.description ?? "").includes(T27_ROLE_MARKER);
      if (migrationCreated || APPROVED_ROLE_BINDINGS.has(name.toLowerCase())) {
        roleIdByRid.set(r.rid, existing.id);
        roleStats.reused++;
      } else {
        const reviewName = `${name} (s1-migrated)`;
        roleIdByRid.set(r.rid, await upsertMigrationRole(r.rid, reviewName, r.weight ?? 0, ", name collided with a pre-existing S2 role"));
        roleStats.collisions++;
        roleCollisions.push({ rid: r.rid, s1Name: name, reviewRole: reviewName });
      }
      continue;
    }
    roleIdByRid.set(r.rid, await upsertMigrationRole(r.rid, name, r.weight ?? 0, ""));
    roleStats.upserted++;
  }
  report.roles = { staged: rawRoles.length, ...roleStats, collisionDetails: roleCollisions };

  // ---- users ---------------------------------------------------------------
  const stats = {
    staged: 0,
    skippedBlocked: 0,
    skippedReservedUid: 0,
    reservedUidRemediated: 0,
    created: 0,
    matched: 0,
    updated: 0,
    workerLinked: 0,
    workerLinksRemoved: 0,
    deactivatedBlocked: 0,
    deactivatedDeleted: 0,
    roleAssignments: 0,
    s2ExtraRolesKept: 0,
  };
  const reconciliation = {
    noResolvableWorker: [] as number[],
    ambiguousWorkerEmail: [] as Array<{ uid: number; workerNids: number[] }>,
    duplicateEmails: [] as Array<{ uid: number; firstUid: number }>,
    blockedSkipped: [] as number[],
  };
  const seenEmailByUid = new Map<string, number>(); // lower(mail) → first uid this run
  /** uid → expected shape for verify. */
  const expected = new Map<
    number,
    { email: string; isActive: boolean; roleIds: string[]; workerS2Id: string | null }
  >();

  const activeStaged: RawUserRow[] = [];
  const blockedStaged: RawUserRow[] = [];
  for await (const page of pagedRawUsers(PAGE)) {
    for (const u of page) {
      stats.staged++;
      // Defense in depth: staging already excludes uid 0/1, but the Drupal
      // superuser must never be migrated even if staged data predates that.
      if (u.uid <= 1) {
        stats.skippedReservedUid++;
        continue;
      }
      if (u.status !== 1) {
        stats.skippedBlocked++;
        reconciliation.blockedSkipped.push(u.uid);
        blockedStaged.push(u);
        continue;
      }
      activeStaged.push(u);
    }
  }

  const idMap = await getMappings("user", activeStaged.map((u) => u.uid));

  progress.setTotal(activeStaged.length);
  progress.phase(null);
  for (const u of activeStaged) {
    progress.add(1);
    const mailRaw = (u.mail ?? "").trim();
    if (!mailRaw) {
      rejects.add("missing_mail", { uid: u.uid }, u.uid);
      continue;
    }
    if (!EMAIL_RE.test(mailRaw)) {
      rejects.add("invalid_mail", { uid: u.uid }, u.uid);
      continue;
    }
    const email = mailRaw.toLowerCase();
    const firstUid = seenEmailByUid.get(email);
    if (firstUid != null && firstUid !== u.uid) {
      rejects.add("duplicate_user_email", { uid: u.uid, firstUid }, u.uid);
      reconciliation.duplicateEmails.push({ uid: u.uid, firstUid });
      continue;
    }
    seenEmailByUid.set(email, u.uid);

    // worker resolution (annotation-only outcomes)
    const resolution = resolveWorker(email);
    let workerS2Id: string | null = null;
    let contactNid: number | null = null;
    if (resolution.kind === "linked") {
      workerS2Id = resolution.workerS2Id;
      contactNid = resolution.contactNid;
    } else if (resolution.kind === "ambiguous") {
      rejects.add("ambiguous_worker_email", { uid: u.uid, workerNids: resolution.candidates }, u.uid);
      reconciliation.ambiguousWorkerEmail.push({ uid: u.uid, workerNids: resolution.candidates });
    } else {
      rejects.add("no_resolvable_worker", { uid: u.uid }, u.uid);
      reconciliation.noResolvableWorker.push(u.uid);
    }

    // names: contact name for linked workers, else mail local-part
    let firstName = email.split("@")[0];
    let lastName = "";
    if (workerS2Id && contactNid != null) {
      const contactS2 = contactMap.get(contactNid);
      if (contactS2 && !DRY_RUN) {
        const contact = await storage.contacts.getContact(contactS2.s2Id);
        if (contact) {
          firstName = contact.given || firstName;
          lastName = contact.family || "";
        }
      }
    }

    const roleIds = [...new Set((ridsByUid.get(u.uid) ?? []).map((rid) => roleIdByRid.get(rid)).filter(
      (id): id is string => typeof id === "string",
    ))];
    // linked workers get the worker role like every self-registered worker;
    // created if absent (rehearsal empty bootstrap has no seed roles).
    // Dry-run must not write: use a placeholder id for reporting only.
    if (workerS2Id) {
      if (DRY_RUN) {
        const existing = await storage.users.getRoleByName("worker");
        const id = existing?.id ?? "dry-run:worker-role";
        if (!roleIds.includes(id)) roleIds.push(id);
      } else {
        let workerRole = await storage.users.getRoleByName("worker");
        if (!workerRole) {
          workerRole = await storage.users.createRole({
            name: "worker",
            description: "Worker self-service role (created by S1 user migration)",
          });
        }
        if (!roleIds.includes(workerRole.id)) roleIds.push(workerRole.id);
      }
    }

    const lastLogin = u.login && u.login > 0 ? new Date(u.login * 1000) : undefined;
    const userData: Record<string, unknown> = {
      s1: { uid: u.uid, name: u.name ?? null, created: u.created ?? null },
      ...(workerS2Id ? { migratedWorkerId: workerS2Id, workerLinkSource: "s1-user-migration" } : {}),
    };

    const mapped = idMap.get(u.uid);
    try {
      if (mapped) {
        stats.matched++;
        if (!DRY_RUN) {
          const existing = await storage.users.getUser(mapped.s2Id);
          if (existing) {
            const prevData = (existing.data as Record<string, unknown> | null) ?? {};
            // Reconcile migration-owned link fields on EVERY rerun: a link that
            // no longer resolves (removed mapping, newly ambiguous email) must
            // be REMOVED, or a stale migratedWorkerId keeps granting access to
            // the wrong worker. Manually attached links (different
            // workerLinkSource) are never touched.
            const migrationOwnedLink = prevData.workerLinkSource === "s1-user-migration";
            const staleLink =
              workerS2Id == null && migrationOwnedLink && prevData.migratedWorkerId != null;
            const needsUpdate =
              existing.email.toLowerCase() !== email ||
              existing.isActive !== true ||
              staleLink ||
              (workerS2Id != null && prevData.migratedWorkerId !== workerS2Id);
            if (needsUpdate) {
              await withNotificationsSuppressed(async () => {
                await storage.users.updateUser(mapped.s2Id, { email, isActive: true });
                const nextData: Record<string, unknown> = { ...prevData, ...userData };
                if (staleLink) {
                  delete nextData.migratedWorkerId;
                  delete nextData.workerLinkSource;
                  stats.workerLinksRemoved++;
                }
                await storage.users.updateUserData(mapped.s2Id, nextData);
                if (staleLink) await clearMigrationIdentityLinks(mapped.s2Id);
              });
              stats.updated++;
            }
            await ensureRoles(mapped.s2Id, roleIds, u.uid);
          }
        }
        if (workerS2Id) stats.workerLinked++;
        expected.set(u.uid, { email, isActive: true, roleIds, workerS2Id });
        continue;
      }

      if (DRY_RUN) {
        stats.created++;
        if (workerS2Id) stats.workerLinked++;
        continue;
      }

      // email may already be taken (admin-created account, or crash-repair):
      // adopt only if it's not owned by another migrated uid.
      const clash = await storage.users.getUserByEmail(email);
      let s2Id: string;
      if (clash) {
        const clashData = (clash.data as Record<string, unknown> | null) ?? {};
        const clashUid = (clashData.s1 as Record<string, unknown> | undefined)?.uid;
        if (typeof clashUid === "number" && clashUid !== u.uid) {
          rejects.add("email_owned_by_other_s1_user", { uid: u.uid, otherUid: clashUid }, u.uid);
          continue;
        }
        // adopt (pre-existing admin account or prior crash) — enrich in place
        await withNotificationsSuppressed(async () => {
          await storage.users.updateUser(clash.id, {
            email,
            firstName: clash.firstName || firstName,
            lastName: clash.lastName || lastName,
            isActive: true,
            ...(lastLogin && !clash.lastLogin ? { lastLogin } : {}),
          });
          await storage.users.updateUserData(clash.id, { ...clashData, ...userData });
        });
        s2Id = clash.id;
      } else {
        const created = await withNotificationsSuppressed(() =>
          storage.users.createUser({
            email,
            firstName,
            lastName,
            isActive: true,
            accountStatus: "pending", // becomes "linked" at first Okta sign-in
            ...(lastLogin ? { lastLogin } : {}),
            data: userData,
          }),
        );
        s2Id = created.id;
      }
      const winner = await putMapping("user", u.uid, s2Id, { stub: false, loader: LOADER });
      if (winner !== s2Id) {
        console.error(`RACE: user uid ${u.uid} already mapped to ${winner}; row ${s2Id} may be an orphan`);
      }
      await ensureRoles(s2Id, roleIds, u.uid);
      stats.created++;
      if (workerS2Id) stats.workerLinked++;
      expected.set(u.uid, { email, isActive: true, roleIds, workerS2Id });
    } catch (err) {
      rejects.add(mapped ? "user_update_failed" : "user_create_failed", { uid: u.uid, code: "storage_error" }, u.uid);
      void err;
    }
  }

  /**
   * Clear workerId from MIGRATION-OWNED auth identity metadata (written by
   * pre-provisioning/first-login pre-link). Must run whenever the loader
   * removes a migration-owned user link, or live sessions keep resolving
   * the former worker until the next Okta login.
   */
  async function clearMigrationIdentityLinks(userId: string): Promise<void> {
    const identities = await storage.authIdentities.getByUserId(userId);
    for (const identity of identities) {
      const meta = (identity.metadata as Record<string, unknown> | null) ?? {};
      const migrationOwned = meta.source === "s1-user-migration" || meta.preProvisioned === true;
      if (!migrationOwned || meta.workerId == null) continue;
      const next = { ...meta };
      delete next.workerId;
      next.staleWorkerLinkRemovedAt = new Date().toISOString();
      await storage.authIdentities.update(identity.id, { metadata: next });
    }
  }

  async function ensureRoles(userId: string, roleIds: string[], uid: number): Promise<void> {
    try {
      const current = await storage.users.getUserRoles(userId);
      const currentIds = new Set(current.map((r) => r.id));
      for (const roleId of roleIds) {
        if (currentIds.has(roleId)) continue;
        await withNotificationsSuppressed(() => storage.users.assignRoleToUser({ userId, roleId }));
        stats.roleAssignments++;
      }
      stats.s2ExtraRolesKept += [...currentIds].filter((id) => !roleIds.includes(id)).length;
    } catch {
      rejects.add("role_assign_failed", { uid, code: "storage_error" }, uid);
    }
  }

  // ---- lifecycle reconciliation: previously migrated accounts whose S1
  // account is now BLOCKED (status != 1) or DELETED (gone from staging) must
  // stop granting access: deactivate, remove the migration-owned worker link
  // and the worker role. Never touches accounts this migration didn't map.
  const stagedUids = new Set<number>();
  for (const u of activeStaged) stagedUids.add(u.uid);
  for (const u of blockedStaged) stagedUids.add(u.uid);
  const allUserMappings = await getAllMappings("user");
  // Reserved Drupal uids (0 anonymous, 1 superuser) must never be mapped —
  // remediate any historical mapping: deactivate the S2 row + drop the map.
  let reservedUidRemediated = 0;
  for (const uid of [0, 1]) {
    const m = allUserMappings.get(uid);
    if (!m) continue;
    if (!DRY_RUN) {
      const row = await storage.users.getUser(m.s2Id);
      if (row?.isActive) {
        await withNotificationsSuppressed(() => storage.users.updateUser(m.s2Id, { isActive: false }));
      }
      await deleteMapping("user", uid);
    }
    allUserMappings.delete(uid);
    reservedUidRemediated++;
    console.error(`LIFECYCLE: reserved Drupal uid ${uid} was mapped — deactivated + unmapped`);
  }
  stats.reservedUidRemediated = reservedUidRemediated;
  const toRevoke: Array<{ uid: number; s2Id: string; why: "blocked" | "deleted" }> = [];
  for (const u of blockedStaged) {
    const m = allUserMappings.get(u.uid);
    if (m && !m.stub) toRevoke.push({ uid: u.uid, s2Id: m.s2Id, why: "blocked" });
  }
  for (const [uid, m] of allUserMappings) {
    if (!m.stub && !stagedUids.has(uid)) toRevoke.push({ uid, s2Id: m.s2Id, why: "deleted" });
  }
  for (const r of toRevoke) {
    try {
      const row = DRY_RUN ? null : await storage.users.getUser(r.s2Id);
      if (DRY_RUN) {
        // report-only: dry-run must not read-modify-write
        continue;
      }
      if (!row) continue;
      const prevData = (row.data as Record<string, unknown> | null) ?? {};
      const migrationOwnedLink =
        prevData.workerLinkSource === "s1-user-migration" && prevData.migratedWorkerId != null;
      if (!row.isActive && !migrationOwnedLink) continue; // already reconciled
      await withNotificationsSuppressed(async () => {
        if (row.isActive) await storage.users.updateUser(r.s2Id, { isActive: false });
        if (migrationOwnedLink) {
          const nextData = { ...prevData };
          delete nextData.migratedWorkerId;
          delete nextData.workerLinkSource;
          await storage.users.updateUserData(r.s2Id, nextData);
          stats.workerLinksRemoved++;
        }
        await clearMigrationIdentityLinks(r.s2Id);
        const workerRole = await storage.users.getRoleByName("worker");
        if (workerRole) await storage.users.unassignRoleFromUser(r.s2Id, workerRole.id);
      });
      if (r.why === "blocked") stats.deactivatedBlocked++;
      else stats.deactivatedDeleted++;
    } catch {
      rejects.add("user_update_failed", { uid: r.uid, code: "storage_error" }, r.uid);
    }
  }

  report.users = stats;
  report.reconciliation = {
    noResolvableWorker: { count: reconciliation.noResolvableWorker.length, uids: reconciliation.noResolvableWorker.slice(0, 50) },
    ambiguousWorkerEmail: { count: reconciliation.ambiguousWorkerEmail.length, samples: reconciliation.ambiguousWorkerEmail.slice(0, 50) },
    duplicateEmails: { count: reconciliation.duplicateEmails.length, samples: reconciliation.duplicateEmails.slice(0, 50) },
    blockedSkipped: { count: reconciliation.blockedSkipped.length, uids: reconciliation.blockedSkipped.slice(0, 50) },
    lifecycleRevoked: {
      count: toRevoke.length,
      samples: toRevoke.slice(0, 50).map((r) => ({ uid: r.uid, why: r.why })),
    },
  };

  // ---------------- verify pass ----------------
  progress.phase("verify", activeStaged.length);
  let verifyFailures = 0;
  if (!DRY_RUN) {
    // uid 0/1 must never be mapped/migrated (Drupal anonymous + superuser)
    const reserved = await getMappings("user", [0, 1]);
    for (const uid of reserved.keys()) {
      console.error(`VERIFY: reserved Drupal uid ${uid} has an id_map entry — superuser/anonymous must never migrate`);
      verifyFailures++;
    }
    // blocked/deleted accounts that were previously migrated must be inactive
    // with no migration-owned worker link
    for (const r of toRevoke) {
      const row = await storage.users.getUser(r.s2Id);
      if (!row) continue;
      const data = (row.data as Record<string, unknown> | null) ?? {};
      if (row.isActive) {
        console.error(`VERIFY: ${r.why} S1 uid ${r.uid} still maps to an ACTIVE S2 user`);
        verifyFailures++;
      }
      if (data.workerLinkSource === "s1-user-migration" && data.migratedWorkerId != null) {
        console.error(`VERIFY: ${r.why} S1 uid ${r.uid} retains a migration-owned worker link`);
        verifyFailures++;
      }
    }
    const vMap = await getMappings("user", activeStaged.map((u) => u.uid));
    for (const u of activeStaged) {
      progress.add(1);
      if (rejects.hasAnyIn(u.uid, FATAL_REASONS)) continue;
      const m = vMap.get(u.uid);
      if (!m) {
        console.error(`VERIFY: user uid ${u.uid} has no id_map entry`);
        verifyFailures++;
        continue;
      }
      const row = await storage.users.getUser(m.s2Id);
      if (!row) {
        console.error(`VERIFY: user uid ${u.uid} maps to missing users row ${m.s2Id}`);
        verifyFailures++;
        continue;
      }
      const exp = expected.get(u.uid);
      if (!exp) continue;
      if (row.email.toLowerCase() !== exp.email || row.isActive !== exp.isActive) {
        console.error(`VERIFY: user uid ${u.uid} email/active drift`);
        verifyFailures++;
        continue;
      }
      {
        const data = (row.data as Record<string, unknown> | null) ?? {};
        if (exp.workerS2Id) {
          if (data.migratedWorkerId !== exp.workerS2Id) {
            console.error(`VERIFY: user uid ${u.uid} missing/mismatched migratedWorkerId`);
            verifyFailures++;
            continue;
          }
        } else if (
          data.workerLinkSource === "s1-user-migration" &&
          data.migratedWorkerId != null
        ) {
          // unresolved/ambiguous accounts must NOT retain a migration-owned link
          console.error(`VERIFY: user uid ${u.uid} retains stale migration-owned worker link`);
          verifyFailures++;
          continue;
        }
      }
      const rolesNow = await storage.users.getUserRoles(m.s2Id);
      const roleIdsNow = new Set(rolesNow.map((r) => r.id));
      for (const roleId of exp.roleIds) {
        if (!roleIdsNow.has(roleId)) {
          console.error(`VERIFY: user uid ${u.uid} missing role assignment`);
          verifyFailures++;
          break;
        }
      }
    }
  }

  report.rejects = rejects.counts;
  report.rejectSamples = rejects.samples;
  progress.stop();
  report.verifyFailures = verifyFailures;
  report.annotations = ANNOTATIONS;

  const disallowed = rejects.disallowedReasons([...ALLOWED_REJECTS, ...ANNOTATIONS]);
  console.log(JSON.stringify(report, null, 2));
  if (!DRY_RUN) await recordRun(startedAt, { loader: LOADER, allowedRejects: ALLOWED_REJECTS }, report);

  if (verifyFailures > 0) process.exit(1);
  if (disallowed.length > 0) {
    console.error(
      `FAIL: reject reason(s) not allowed for this run: ${disallowed.map((d) => `${d.reason}=${d.count}`).join(", ")}. ` +
        `Annotations (no_resolvable_worker, ambiguous_worker_email) are always allowed; every FATAL class must be consciously allowed via --allow-rejects.`,
    );
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
