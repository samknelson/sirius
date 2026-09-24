import { storage } from "../storage";
import { runInTransaction } from "../storage/transaction-context";
import { storageLogger, logger } from "../logger";
import { clearAccessCache } from "../services/access-policy-evaluator";
import {
  getAuthSettings,
  getProvisioningMode,
  type ProvisionableProvider,
  type SamlRoleMapping,
} from "./auth-settings";
import type { User, AuthIdentity } from "@shared/schema";

interface ProvisionInfo {
  externalId: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  displayName?: string | null;
  profileImageUrl?: string | null;
}

/**
 * Auto-provision a local account for a first-time external login, when the
 * provider's provisioning mode is "create". Returns null when provisioning
 * is off (mode "reject", the default) — callers then keep today's behavior.
 *
 * Creates an active user (email/name from the provider), links the auth
 * identity, and writes an audit entry into the new user's log history.
 */
export async function maybeProvisionUser(
  provider: ProvisionableProvider,
  info: ProvisionInfo,
): Promise<{ user: User; identity: AuthIdentity } | null> {
  const settings = await getAuthSettings(storage);
  if (getProvisioningMode(settings, provider) !== "create") return null;

  // Create user + identity atomically; a parallel first login racing us hits
  // a unique violation and rolls back cleanly instead of leaving an orphan
  // user without an identity.
  let created: { user: User; identity: AuthIdentity };
  try {
    created = await runInTransaction(async () => {
      const user = await storage.users.createUser({
        email: info.email,
        firstName: info.firstName ?? undefined,
        lastName: info.lastName ?? undefined,
        profileImageUrl: info.profileImageUrl ?? undefined,
        accountStatus: "linked",
        isActive: true,
      });

      const identity = await storage.authIdentities.create({
        userId: user.id,
        providerType: provider,
        externalId: info.externalId,
        email: info.email,
        displayName: info.displayName ?? undefined,
        profileImageUrl: info.profileImageUrl ?? undefined,
      });

      return { user, identity };
    });
  } catch (error: any) {
    if (error?.code !== "23505") throw error;
    // Lost the race. If the winner linked this exact provider identity,
    // continue with it; otherwise refuse (fresh transaction, per tx-race rule).
    const identity = await storage.authIdentities.getByProviderAndExternalId(
      provider,
      info.externalId,
    );
    if (!identity) return null;
    const user = await storage.users.getUser(identity.userId);
    if (!user || !user.isActive) return null;
    logger.info("Provisioning race resolved to existing identity", {
      provider,
      userId: user.id,
    });
    return { user, identity };
  }
  const { user, identity } = created;

  logger.info("Auto-provisioned user from external login", {
    provider,
    userId: user.id,
    email: info.email,
  });

  setImmediate(() => {
    storageLogger.info("Authentication event: user auto-provisioned", {
      module: "auth",
      operation: "provision",
      entityType: "user",
      entity_id: user.id,
      host_entity_id: user.id,
      details: {
        provider,
        email: info.email,
        externalId: info.externalId,
      },
    });
  });

  return { user, identity };
}

interface IdentityMetadata {
  managedRoleIds?: string[];
  [key: string]: unknown;
}

function attributeMatches(
  attributes: Record<string, unknown>,
  mapping: SamlRoleMapping,
): boolean {
  const raw = attributes[mapping.attribute];
  if (raw === undefined || raw === null || raw === "") return false;
  const values = (Array.isArray(raw) ? raw : [raw]).map((v) => String(v));
  if (mapping.value === null) return values.some((v) => v !== "");
  return values.includes(mapping.value);
}

/**
 * Reconcile provider-managed roles for a user on login.
 *
 * - Grants roles whose mapping matches the presented attributes.
 * - Revokes roles this provider previously granted that no longer match.
 * - Never touches locally assigned roles: a role the user already held
 *   before we granted it is never recorded as provider-managed.
 *
 * Provenance lives in the auth identity's metadata (`managedRoleIds`), so
 * no schema change is needed and revocation is scoped to this identity.
 *
 * Known limitation: if a role is already provider-managed and an admin later
 * ALSO assigns the same role locally, the single user_roles row can't
 * represent both grants — a later non-matching login revokes it. Re-granting
 * locally after that sticks (the role is no longer listed as managed).
 */
export async function reconcileMappedRoles(
  provider: ProvisionableProvider,
  user: User,
  identity: AuthIdentity,
  attributes: Record<string, unknown>,
): Promise<void> {
  const settings = await getAuthSettings(storage);
  const mappings = provider === "saml" ? settings.samlRoleMappings : [];

  const metadata: IdentityMetadata =
    identity.metadata && typeof identity.metadata === "object"
      ? { ...(identity.metadata as IdentityMetadata) }
      : {};
  const previousManaged = Array.isArray(metadata.managedRoleIds)
    ? metadata.managedRoleIds.filter((id): id is string => typeof id === "string")
    : [];

  // Nothing to do: no mappings configured and nothing previously managed.
  if (mappings.length === 0 && previousManaged.length === 0) return;

  const matchedRoleIds = new Set<string>();
  for (const mapping of mappings) {
    if (attributeMatches(attributes, mapping)) matchedRoleIds.add(mapping.roleId);
  }

  const allRoles = await storage.users.getAllRoles();
  const knownRoleIds = new Set(allRoles.map((r) => r.id));
  const currentRoles = await storage.users.getUserRoles(user.id);
  const heldRoleIds = new Set(currentRoles.map((r) => r.id));

  const nextManaged = new Set<string>();
  const granted: string[] = [];
  const revoked: string[] = [];

  for (const roleId of matchedRoleIds) {
    if (!knownRoleIds.has(roleId)) {
      logger.warn("Auth role mapping references unknown role; skipping", {
        provider,
        roleId,
      });
      continue;
    }
    if (heldRoleIds.has(roleId)) {
      // Already held. Keep managing it only if WE granted it previously;
      // never claim ownership of a locally assigned role.
      if (previousManaged.includes(roleId)) nextManaged.add(roleId);
      continue;
    }
    try {
      await storage.users.assignRoleToUser({ userId: user.id, roleId });
    } catch (error: any) {
      // Concurrent login already granted it; treat as held-and-managed.
      if (error?.code !== "23505") throw error;
    }
    nextManaged.add(roleId);
    granted.push(roleId);
  }

  for (const roleId of previousManaged) {
    if (matchedRoleIds.has(roleId)) continue;
    // Previously granted by this provider, no longer matching: revoke.
    if (heldRoleIds.has(roleId)) {
      await storage.users.unassignRoleFromUser(user.id, roleId);
      revoked.push(roleId);
    }
  }

  const nextManagedList = Array.from(nextManaged).sort();
  const changedManaged =
    nextManagedList.length !== previousManaged.length ||
    nextManagedList.some((id) => !previousManaged.includes(id));

  if (changedManaged) {
    await storage.authIdentities.update(identity.id, {
      metadata: { ...metadata, managedRoleIds: nextManagedList },
    });
  }

  if (granted.length > 0 || revoked.length > 0) {
    clearAccessCache();
    const roleName = (id: string) => allRoles.find((r) => r.id === id)?.name ?? id;
    setImmediate(() => {
      storageLogger.info("Authentication event: provider role reconciliation", {
        module: "auth",
        operation: "role_reconcile",
        entityType: "user",
        entity_id: user.id,
        host_entity_id: user.id,
        details: {
          provider,
          granted: granted.map((id) => ({ roleId: id, role: roleName(id) })),
          revoked: revoked.map((id) => ({ roleId: id, role: roleName(id) })),
          managedBy: `provider:${provider}`,
        },
      });
    });
  }
}
