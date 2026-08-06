/**
 * Central worker-association resolver for signed-in users.
 *
 * The ONLY sanctioned worker links are:
 *   1. auth_identities.metadata.workerId — written when an identity is bound
 *      to a worker (verified SSN+DOB flow, T27 migration pre-link, or
 *      pre-provisioning), and
 *   2. for NON-migrated legacy accounts only, a unique contact-email match
 *      (accounts linked before identity metadata was tracked).
 *
 * Accounts created by the S1 user migration (T27) carry S1 provenance in
 * users.data.s1 and must NEVER be associated with a worker via contact-email
 * fallback: the loader deliberately leaves unresolved/ambiguous accounts
 * unlinked, and email matching could hand them another worker's data. They
 * attach a worker only through the recorded migration link or the verified
 * SSN+DOB flow.
 */
import { storage } from "../storage/database";

/** True when the account was created by the S1 user migration (T27). */
export function isMigratedAccount(
  user: { data?: unknown } | null | undefined
): boolean {
  const data = (user?.data as Record<string, unknown> | null) ?? null;
  const s1 = data?.s1 as Record<string, unknown> | undefined;
  return s1 != null && typeof s1 === "object" && s1.uid != null;
}

/**
 * Reads the migration-recorded worker link off a users row
 * (users.data.migratedWorkerId, written by the T27 S1 user loader).
 */
export function getMigratedWorkerId(
  user: { data?: unknown } | null | undefined
): string | null {
  const data = (user?.data as Record<string, unknown> | null) ?? null;
  const v = data?.migratedWorkerId;
  return typeof v === "string" && v ? v : null;
}

/** Identity metadata written by the migration (pre-provisioning/pre-link). */
export function isMigrationOwnedIdentityMeta(
  meta: Record<string, unknown> | null | undefined
): boolean {
  return meta?.source === "s1-user-migration" || meta?.preProvisioned === true;
}

/**
 * Reconcile a migration-owned identity worker link against the authoritative
 * recorded link on the user row (shared by ALL auth providers). When a
 * loader rerun removed (or changed) the migration-owned link, the stale
 * identity workerId — and the worker role granted from it — must not keep
 * granting access to the former worker. Returns true when a change was made.
 */
export async function reconcileMigrationIdentityLink(
  identity: { id: string; metadata?: unknown },
  user: { id: string; data?: unknown }
): Promise<boolean> {
  const meta = (identity.metadata as Record<string, unknown> | null) ?? {};
  if (!isMigrationOwnedIdentityMeta(meta)) return false;
  const workerId = meta.workerId;
  if (typeof workerId !== "string" || !workerId) return false;
  const recorded = getMigratedWorkerId(user);
  if (recorded === workerId) return false;
  const { workerId: _stale, ...rest } = meta;
  await storage.authIdentities.update(identity.id, {
    metadata: recorded
      ? { ...rest, workerId: recorded }
      : { ...rest, staleWorkerLinkRemovedAt: new Date().toISOString() },
  });
  if (!recorded) {
    const workerRole = await storage.users.getRoleByName("worker");
    if (workerRole) {
      await storage.users.unassignRoleFromUser(user.id, workerRole.id);
    }
  }
  return true;
}

/**
 * Resolve the worker linked to a user for session/menu/dashboard surfaces.
 * - Non-migration identity metadata (verified SSN+DOB flow) is authoritative.
 * - MIGRATION-OWNED identity metadata is trusted ONLY while it matches the
 *   current recorded migration link on the user row: the loader is the
 *   source of truth, and a lifecycle revocation/unlink must take effect on
 *   live sessions immediately, not at the next Okta login.
 * - Contact-email fallback is prohibited for migrated (S1-provenance)
 *   accounts.
 */
export async function resolveLinkedWorkerId(
  user:
    | { id: string; email?: string | null; data?: unknown }
    | null
    | undefined
): Promise<string | null> {
  if (!user) return null;
  const identities = await storage.authIdentities.getByUserId(user.id);
  for (const identity of identities) {
    const meta = (identity.metadata as Record<string, unknown> | null) ?? null;
    const workerId = meta?.workerId;
    if (typeof workerId !== "string" || !workerId) continue;
    if (!isMigrationOwnedIdentityMeta(meta)) return workerId;
    // migration-owned: fail closed unless it matches the recorded link
    if (getMigratedWorkerId(user) === workerId) return workerId;
  }
  if (isMigratedAccount(user)) return null;
  if (!user.email) return null;
  const worker = await storage.workers.getWorkerByContactEmail(user.email);
  return worker?.id ?? null;
}
