import { storage } from "../storage";
import { logger, storageLogger } from "../logger";
import { getEnvironmentVariable } from "../config/env-registry";
import { clearAccessCache } from "../services/access-policy-evaluator";

/**
 * Guarantee an admin account from environment variables.
 *
 * Deployments where the operator has no console and no database access (e.g.
 * ECS task definitions managed purely through the repo) can set:
 *
 *   LOCAL_AUTH_EMAIL          — the account that must be able to sign in
 *   LOCAL_AUTH_PASSWORD_HASH  — a bcrypt hash of its password (generate with
 *                               `npx tsx scripts/oneoffs/generate-password-hash.ts`)
 *
 * While both are set, EVERY boot reconciles four guarantees:
 *
 *   1. a user with that email exists          (created when missing)
 *   2. that user is active                    (reactivated when disabled)
 *   3. it holds a role granting `admin`       (granted, creating a role if
 *                                              nothing grants it yet)
 *   4. its local credential is this hash      (upserted when different)
 *
 * WHY THIS IS A RECONCILER AND NOT A SEEDER. It used to only attach a hash to
 * a user that already existed, which left no way into a half-initialized
 * database: the interactive first-run screen closes itself as soon as ANY user
 * row exists, so a deployment with a few abandoned rows and no known password
 * had no remaining surface to fix itself from. Stating an end state rather
 * than a precondition is what makes the variables a reliable way back in.
 *
 * This is deliberately a privileged back door. Its protection is that setting
 * the variables requires either deploy-configuration access or the in-app
 * `admin` permission (registered variables are overridable from the admin
 * environment screen) — i.e. it grants nothing that whoever can reach it does
 * not already have. That is thin enough that the compensating rule matters:
 * it must never act silently. Every run that does anything prints a block to
 * the console (the shell-less operator's only diagnostic surface) and writes
 * the same summary through storageLogger, the logger that reaches the in-app
 * log viewer, so a provisioned account is always visible after the fact. The
 * password and its hash are never logged.
 *
 * Refusals are loud and do nothing: a hash that is not bcrypt, the local
 * provider not being enabled, or the email already belonging to a different
 * user. Nothing here can take the boot down — failures are reported and
 * swallowed, and because each guarantee is reconciled independently a partial
 * failure is simply repaired by the next boot.
 *
 * Also called from the bootstrap route right after the first user is created,
 * so an interactively bootstrapped deployment does not need a restart before
 * the configured credential works.
 */

const ADMIN_PERMISSION_KEY = "admin";
const PREFERRED_ADMIN_ROLE_NAME = "admin";
const FALLBACK_ADMIN_ROLE_NAME = "break-glass-admin";

/**
 * A COMPLETE bcrypt hash: variant, a cost in bcrypt's legal range, and the
 * full 53-character salt+digest. Prefix-only matching would accept a value
 * that an env file, a JSON escape or a copy-paste had truncated — which is
 * exactly the shape of mistake this refusal exists to catch, since a
 * truncated hash produces the same "invalid email or password" as a wrong
 * one and is otherwise indistinguishable from it.
 */
const BCRYPT_HASH_PATTERN = /^\$2[aby]\$(0[4-9]|[12]\d|3[01])\$[./A-Za-z0-9]{53}$/;

export type GuaranteeState =
  | "already-correct"
  | "created"
  | "repaired"
  | "not-reached";

export interface LocalAdminReport {
  /** True when both variables were set, i.e. the reconciler actually ran. */
  ran: boolean;
  email: string | null;
  userId: string | null;
  /** Set when a precondition stopped the run. Nothing was written. */
  refusal: { reason: string; fix: string } | null;
  /** Set when an unexpected error interrupted the run. */
  failure: string | null;
  guarantees: {
    account: GuaranteeState;
    active: GuaranteeState;
    admin: GuaranteeState;
    password: GuaranteeState;
  };
  /** Human-readable extras, e.g. which role was granted. */
  notes: string[];
}

function emptyReport(): LocalAdminReport {
  return {
    ran: false,
    email: null,
    userId: null,
    refusal: null,
    failure: null,
    guarantees: {
      account: "not-reached",
      active: "not-reached",
      admin: "not-reached",
      password: "not-reached",
    },
    notes: [],
  };
}

export function isBcryptHash(value: string): boolean {
  return BCRYPT_HASH_PATTERN.test(value);
}

/**
 * Mirrors how the auth config decides to register the local provider: listed
 * in AUTH_PROVIDER, and not switched off by AUTH_LOCAL_ENABLED=false. Without
 * the provider there is no login form to use the credential with, so writing
 * one would be a lie.
 */
export function isLocalProviderEnabled(): boolean {
  const providers = (getEnvironmentVariable("AUTH_PROVIDER") || "replit")
    .split(",")
    .map((p) => p.trim());
  if (!providers.includes("local")) return false;
  return getEnvironmentVariable("AUTH_LOCAL_ENABLED") !== "false";
}

const RULE = "=".repeat(78);

function describe(state: GuaranteeState, detail?: string): string {
  const base =
    state === "already-correct"
      ? "already correct"
      : state === "created"
        ? "created"
        : state === "repaired"
          ? "repaired"
          : "not reached";
  return detail ? `${base} — ${detail}` : base;
}

export function formatLocalAdminReport(report: LocalAdminReport): string {
  const lines: string[] = [];
  lines.push(RULE);
  lines.push("LOCAL ADMIN ACCOUNT (LOCAL_AUTH_EMAIL / LOCAL_AUTH_PASSWORD_HASH)");
  lines.push(RULE);
  lines.push(`  email:     ${report.email ?? "(unset)"}`);

  if (report.refusal) {
    lines.push("");
    lines.push(`  REFUSED:   ${report.refusal.reason}`);
    lines.push(`  fix:       ${report.refusal.fix}`);
    lines.push("");
    // Every refusal is decided before the first write, so this holds; it is
    // computed rather than asserted so a future refusal added further down
    // cannot quietly turn the sentence into a false claim.
    const wrote = Object.values(report.guarantees).some((g) => g !== "not-reached");
    lines.push(
      wrote
        ? "  Stopped part-way. Guarantees reached before the refusal are listed above."
        : "  Nothing was written. The account was left exactly as it was.",
    );
    if (wrote) {
      lines.push(`  account:   ${describe(report.guarantees.account)}`);
      lines.push(`  active:    ${describe(report.guarantees.active)}`);
      lines.push(`  admin:     ${describe(report.guarantees.admin)}`);
      lines.push(`  password:  ${describe(report.guarantees.password)}`);
    }
    lines.push(RULE);
    return lines.join("\n");
  }

  lines.push(`  account:   ${describe(report.guarantees.account)}`);
  lines.push(`  active:    ${describe(report.guarantees.active)}`);
  lines.push(`  admin:     ${describe(report.guarantees.admin)}`);
  lines.push(`  password:  ${describe(report.guarantees.password)}`);
  for (const note of report.notes) lines.push(`  note:      ${note}`);

  if (report.failure) {
    lines.push("");
    lines.push(`  FAILED:    ${report.failure}`);
    lines.push("  Guarantees marked \"not reached\" will be retried on the next boot.");
  }

  lines.push(RULE);
  return lines.join("\n");
}

function refuse(
  report: LocalAdminReport,
  reason: string,
  fix: string,
): LocalAdminReport {
  report.refusal = { reason, fix };
  return report;
}

/** True when the run changed something (or wanted to and could not). */
function isNoteworthy(report: LocalAdminReport): boolean {
  if (report.refusal || report.failure) return true;
  return Object.values(report.guarantees).some((g) => g !== "already-correct");
}

/**
 * Ensure the user's roles include one that grants the `admin` permission.
 *
 * Administrator status in this codebase is a permission key, never a role
 * name, so the question is what the user's roles GRANT. When nothing does, an
 * existing role that grants it is reused before creating anything; only a
 * database that has no admin-granting role at all gets a new one, built the
 * same way the interactive first-run screen builds it (every registered
 * permission) so the two paths produce interchangeable accounts.
 *
 * The grant is held locally. Provider role reconciliation only revokes roles
 * recorded in the identity's `managedRoleIds`, so a later SAML login cannot
 * strip it.
 */
async function ensureAdminRole(
  report: LocalAdminReport,
  userId: string,
): Promise<void> {
  // Both questions — "does a held role grant admin?" and "does any role grant
  // admin?" — are answered from the same query on purpose. Asking per role via
  // getRolePermissions instead would route the answer through the in-memory
  // permission registry, which is empty until the permission system is
  // initialized; a "no" from an unloaded registry would re-grant on every run.
  const heldRoles = await storage.users.getUserRoles(userId);
  const heldIds = new Set(heldRoles.map((r) => r.id));
  const grantingRoles = await storage.users.getRolesWithPermission(
    ADMIN_PERMISSION_KEY,
  );

  if (grantingRoles.some((r) => heldIds.has(r.id))) {
    report.guarantees.admin = "already-correct";
    return;
  }

  let target: (typeof grantingRoles)[number] | null = grantingRoles[0] ?? null;

  if (!target) {
    // Creating a role is only meaningful once the permission registry knows
    // what permissions exist; from an unloaded registry we would create an
    // empty role and call the account an admin. Say so instead.
    const permissionKeys = (await storage.users.getAllPermissions()).map(
      (p) => p.key,
    );
    if (!permissionKeys.includes(ADMIN_PERMISSION_KEY)) {
      throw new Error(
        "no role grants the admin permission and the permission registry is not initialized, so a role cannot be built",
      );
    }

    const allRoles = await storage.users.getAllRoles();
    const existingNames = new Set(allRoles.map((r) => r.name));
    // A role literally named "admin" that does NOT grant the permission is
    // somebody else's role; take the reserved name rather than rewriting it.
    // The fallback name belongs to this mechanism, so topping its permissions
    // up is safe.
    const name = existingNames.has(PREFERRED_ADMIN_ROLE_NAME)
      ? FALLBACK_ADMIN_ROLE_NAME
      : PREFERRED_ADMIN_ROLE_NAME;
    target = allRoles.find((r) => r.name === name) ?? null;
    if (!target) {
      try {
        target = await storage.users.createRole({
          name,
          description: "Administrator role with all permissions",
        });
      } catch (error: any) {
        // Lost a race with another booting task creating the same reserved
        // role name (Task #1350: two services boot against one database).
        // Adopt theirs — it is being built exactly the same way.
        if (error?.code !== "23505") throw error;
        target = (await storage.users.getAllRoles()).find((r) => r.name === name) ?? null;
        if (!target) throw error;
      }
    }

    await storage.users.assignPermissionsToRoleBulk(target.id, permissionKeys);
    report.notes.push(
      `created role "${target.name}" holding every registered permission`,
    );
  }

  if (!heldIds.has(target.id)) {
    await storage.users.assignRoleToUser({ userId, roleId: target.id });
  }
  clearAccessCache();
  report.guarantees.admin = "repaired";
  report.notes.push(`granted role "${target.name}"`);
}

/**
 * Reconcile the account described by LOCAL_AUTH_EMAIL / LOCAL_AUTH_PASSWORD_HASH.
 * Never throws: the boot must not depend on this succeeding.
 */
export async function ensureLocalAdminAccount(): Promise<LocalAdminReport> {
  const report = emptyReport();

  const email = getEnvironmentVariable("LOCAL_AUTH_EMAIL")?.trim().toLowerCase();
  const passwordHash = getEnvironmentVariable("LOCAL_AUTH_PASSWORD_HASH")?.trim();

  // Unconfigured is the normal case: stay completely silent.
  if (!email || !passwordHash) return report;

  report.ran = true;
  report.email = email;

  if (!isLocalProviderEnabled()) {
    refuse(
      report,
      "the local auth provider is not enabled, so there would be no login form to use this credential with",
      'add "local" to AUTH_PROVIDER (and leave AUTH_LOCAL_ENABLED unset or true), then restart',
    );
    return publish(report);
  }

  if (!isBcryptHash(passwordHash)) {
    refuse(
      report,
      "LOCAL_AUTH_PASSWORD_HASH is not a complete bcrypt hash ($2a$/$2b$/$2y$, a two-digit cost, then 53 more characters — 60 in total)",
      "regenerate it with scripts/oneoffs/generate-password-hash.ts, and check that nothing truncated it or expanded its $ characters (single-quote it in shells and JSON)",
    );
    return publish(report);
  }

  try {
    // PREFLIGHT. Every refusal has to be decided before the first write, or
    // "nothing was written" is a lie and — worse — a run that ends up refusing
    // could still have created and escalated an account along the way.
    const existingUser = await storage.users.getUserByEmail(email);
    const identityForEmail =
      await storage.authIdentities.getByProviderAndExternalId("local", email);
    if (identityForEmail && identityForEmail.userId !== existingUser?.id) {
      refuse(
        report,
        // PII triage: the operator configured the seed email; keep it out of logs.
        "a local credential for the configured LOCAL_AUTH_EMAIL already belongs to a different user",
        "point LOCAL_AUTH_EMAIL at an address that is not already claimed, or have an admin resolve the duplicate account",
      );
      return publish(report);
    }

    // 1. The account exists.
    let user = existingUser;
    if (!user) {
      try {
        user = await storage.users.createUser({
          email,
          accountStatus: "pending",
          isActive: true,
        });
        report.guarantees.account = "created";
      } catch (error: any) {
        // Lost a race with another boot or a concurrent signup.
        if (error?.code !== "23505") throw error;
        user = await storage.users.getUserByEmail(email);
        if (!user) throw error;
        report.guarantees.account = "already-correct";
      }
    } else {
      report.guarantees.account = "already-correct";
    }
    report.userId = user.id;

    // 2. The account is active. This is the only flag local login gates on.
    if (user.isActive) {
      report.guarantees.active = "already-correct";
    } else {
      await storage.users.updateUser(user.id, { isActive: true });
      report.guarantees.active = "repaired";
    }

    // 3. The account can administer.
    await ensureAdminRole(report, user.id);

    // 4. The account signs in with this password.
    const ownIdentity = await storage.authIdentities.getByUserIdAndProvider(
      user.id,
      "local",
    );
    if (
      ownIdentity &&
      ownIdentity.passwordHash === passwordHash &&
      ownIdentity.externalId === email
    ) {
      report.guarantees.password = "already-correct";
    } else {
      await storage.authIdentities.upsertLocalPasswordHash(
        user.id,
        email,
        passwordHash,
      );
      report.guarantees.password = ownIdentity ? "repaired" : "created";
    }
  } catch (error) {
    report.failure = error instanceof Error ? error.message : String(error);
  }

  return publish(report);
}

/**
 * Emit the report to both surfaces an operator can reach: the console (the
 * deploy log, the only thing visible without an account) and storageLogger,
 * which is the logger that lands in the in-app log viewer. A boot that changed
 * nothing stays quiet apart from a single debug line, so the block in the log
 * always means something actually happened.
 */
function publish(report: LocalAdminReport): LocalAdminReport {
  if (!isNoteworthy(report)) {
    // PII triage: userId identifies the account; email stays out of logs.
    logger.debug("Local admin account already satisfies every guarantee", {
      source: "local-admin-account",
      userId: report.userId,
    });
    return report;
  }

  console.log("\n" + formatLocalAdminReport(report) + "\n");

  const summary = report.refusal
    ? `Local admin account REFUSED: ${report.refusal.reason}`
    : report.failure
      ? "Local admin account reconciliation failed"
      : "Local admin account provisioned from environment variables";

  if (report.refusal || report.failure) {
    logger.error(summary, { source: "local-admin-account", userId: report.userId });
  } else {
    logger.warn(summary, { source: "local-admin-account", userId: report.userId });
  }

  // Best-effort audit trail. The database is the one thing that might be
  // broken here, so a logging failure must not mask the report above.
  try {
    storageLogger.info(summary, {
      module: "auth",
      operation: "local_admin_account",
      entityType: "user",
      entity_id: report.userId ?? undefined,
      host_entity_id: report.userId ?? undefined,
      details: {
        // The audit row keeps the address: a refusal has no userId yet, and
        // the operator reading the in-app log needs to know WHICH configured
        // address was refused. Console output above logs the id only.
        email: report.email,
        guarantees: report.guarantees,
        notes: report.notes,
        refusal: report.refusal,
        failure: report.failure,
      },
    });
  } catch {
    // Already reported to the console; nothing further to do.
  }

  return report;
}
