import { createNoopValidator } from './utils/validation';
import { eq, and } from "drizzle-orm";
import { getClient } from "./transaction-context";
import type { StorageLoggingConfig } from "./middleware/logging";
import {
  authIdentities,
  type AuthIdentity,
  type InsertAuthIdentity,
  type AuthProviderType,
} from "@shared/schema";

/**
 * Stub validator - add validation logic here when needed
 */
export const validate = createNoopValidator<InsertAuthIdentity, AuthIdentity>();

/** The fields a caller may hand to `update`. */
export type AuthIdentityUpdate = Partial<
  Omit<InsertAuthIdentity, "id" | "userId" | "providerType" | "externalId">
>;

/**
 * What an update did — the row as it now stands, the row as it was, and which
 * of its columns the call actually changed.
 *
 * The change list is what makes the audit trail possible: this row is written
 * on EVERY external sign-in (each provider re-asserts the name and email it
 * knows), so a log entry per call would be a log entry per login. The storage
 * layer is the only place that can tell an assertion that changed something
 * from one that re-asserted what was already there, so it reports it and the
 * logging config stays silent on the latter. Same reason nothing here reports
 * VALUES: `changedFields` names columns, so a token or a hash can be seen to
 * have changed without being written down.
 */
export interface AuthIdentityUpdateResult {
  /** The identity as it now stands. */
  identity: AuthIdentity;
  /** The identity as it was before this call. */
  previous: AuthIdentity;
  /** Columns whose stored value this call actually changed. Never values. */
  changedFields: string[];
}

/** What the local-credential upsert did: which row, and whether it made it. */
export interface AuthIdentityUpsertResult {
  identity: AuthIdentity;
  /** True when there was no local identity yet and this call created one. */
  created: boolean;
}

/** What a delete did, with the owner read out of the deleted row itself. */
export interface AuthIdentityDeleteResult {
  deleted: boolean;
  /** The user the deleted identity belonged to, for log attribution. */
  userId?: string;
}

export interface AuthIdentitiesStorage {
  getByProviderAndExternalId(
    providerType: AuthProviderType,
    externalId: string
  ): Promise<AuthIdentity | undefined>;

  getByUserId(userId: string): Promise<AuthIdentity[]>;

  getByUserIdAndProvider(
    userId: string,
    providerType: AuthProviderType
  ): Promise<AuthIdentity | undefined>;

  create(identity: InsertAuthIdentity): Promise<AuthIdentity>;

  /**
   * Apply what a provider (or a reconciler) asserts about an identity,
   * reporting what actually changed. A call that asserts only what the row
   * already says writes nothing and reports no changed fields.
   *
   * Undefined values are not assertions — a provider that knows no display
   * name leaves the stored one alone, which is what Drizzle's `.set()` has
   * always done with them.
   */
  update(
    id: string,
    data: AuthIdentityUpdate
  ): Promise<AuthIdentityUpdateResult | undefined>;

  /**
   * Stamp the identity as used, on every sign-in. Deliberately unlogged: see
   * `authIdentitiesLoggingConfig`.
   */
  updateLastUsed(id: string): Promise<void>;

  delete(id: string): Promise<AuthIdentityDeleteResult>;

  /**
   * Set (or create) the local-auth credential for a user. Creates the
   * providerType "local" identity if it doesn't exist yet (externalId =
   * lowercased email), otherwise just replaces its password hash.
   * Never logs or returns the hash to callers beyond the row itself.
   */
  upsertLocalPasswordHash(
    userId: string,
    email: string,
    passwordHash: string
  ): Promise<AuthIdentityUpsertResult>;
}

/**
 * Whether a stored value and an asserted one are the same value.
 *
 * Dates compare by instant and jsonb by content with key order ignored: the
 * managed-role reconciler rewrites `metadata` wholesale, so a re-assertion of
 * the same roles must not look like a change simply because the object was
 * rebuilt.
 */
function sameValue(stored: unknown, asserted: unknown): boolean {
  if (stored === asserted) return true;
  if (stored === null || stored === undefined) {
    return asserted === null || asserted === undefined;
  }
  if (asserted === null || asserted === undefined) return false;
  if (stored instanceof Date || asserted instanceof Date) {
    const a = stored instanceof Date ? stored.getTime() : NaN;
    const b = asserted instanceof Date ? asserted.getTime() : NaN;
    return a === b;
  }
  if (typeof stored === "object" && typeof asserted === "object") {
    return canonicalJson(stored) === canonicalJson(asserted);
  }
  return false;
}

/** JSON with object keys in a fixed order, so two equal objects render alike. */
function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, raw) => {
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      return Object.fromEntries(
        Object.entries(raw as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)),
      );
    }
    return raw;
  });
}

/** The asserted fields whose stored value differs, ignoring non-assertions. */
function changedFieldsOf(existing: AuthIdentity, data: AuthIdentityUpdate): string[] {
  const stored = existing as unknown as Record<string, unknown>;
  return Object.entries(data)
    .filter(([field, value]) => value !== undefined && !sameValue(stored[field], value))
    .map(([field]) => field);
}

export function createAuthIdentitiesStorage(): AuthIdentitiesStorage {
  return {
    async getByProviderAndExternalId(
      providerType: AuthProviderType,
      externalId: string
    ): Promise<AuthIdentity | undefined> {
      const client = getClient();
      return client.query.authIdentities.findFirst({
        where: and(
          eq(authIdentities.providerType, providerType),
          eq(authIdentities.externalId, externalId)
        ),
      });
    },

    async getByUserId(userId: string): Promise<AuthIdentity[]> {
      const client = getClient();
      return client.query.authIdentities.findMany({
        where: eq(authIdentities.userId, userId),
      });
    },

    async getByUserIdAndProvider(
      userId: string,
      providerType: AuthProviderType
    ): Promise<AuthIdentity | undefined> {
      const client = getClient();
      return client.query.authIdentities.findFirst({
        where: and(
          eq(authIdentities.userId, userId),
          eq(authIdentities.providerType, providerType)
        ),
      });
    },

    async create(identity: InsertAuthIdentity): Promise<AuthIdentity> {
      validate.validateOrThrow(identity);
      const client = getClient();
      const [created] = await client
        .insert(authIdentities)
        .values(identity)
        .returning();
      return created;
    },

    async update(
      id: string,
      data: AuthIdentityUpdate
    ): Promise<AuthIdentityUpdateResult | undefined> {
      validate.validateOrThrow(data);
      const client = getClient();
      const existing = await client.query.authIdentities.findFirst({
        where: eq(authIdentities.id, id),
      });
      if (!existing) return undefined;

      const changedFields = changedFieldsOf(existing, data);
      if (changedFields.length === 0) {
        return { identity: existing, previous: existing, changedFields };
      }

      const [updated] = await client
        .update(authIdentities)
        .set(data)
        .where(eq(authIdentities.id, id))
        .returning();
      if (!updated) return undefined;
      return { identity: updated, previous: existing, changedFields };
    },

    async updateLastUsed(id: string): Promise<void> {
      const client = getClient();
      await client
        .update(authIdentities)
        .set({ lastUsedAt: new Date() })
        .where(eq(authIdentities.id, id));
    },

    async delete(id: string): Promise<AuthIdentityDeleteResult> {
      const client = getClient();
      const [deleted] = await client
        .delete(authIdentities)
        .where(eq(authIdentities.id, id))
        .returning({ id: authIdentities.id, userId: authIdentities.userId });
      return deleted ? { deleted: true, userId: deleted.userId } : { deleted: false };
    },

    async upsertLocalPasswordHash(
      userId: string,
      email: string,
      passwordHash: string
    ): Promise<AuthIdentityUpsertResult> {
      const client = getClient();
      const externalId = email.trim().toLowerCase();
      const existing = await client.query.authIdentities.findFirst({
        where: and(
          eq(authIdentities.userId, userId),
          eq(authIdentities.providerType, "local")
        ),
      });

      if (existing) {
        // Also realign externalId/email so the login ID always matches the
        // user's current (lowercased) email even if it changed since the
        // identity was first created.
        const [updated] = await client
          .update(authIdentities)
          .set({
            passwordHash,
            externalId,
            email: externalId,
          })
          .where(eq(authIdentities.id, existing.id))
          .returning();
        return { identity: updated, created: false };
      }

      const [created] = await client
        .insert(authIdentities)
        .values({
          userId,
          providerType: "local",
          externalId,
          email: externalId,
          passwordHash,
        })
        .returning();
      return { identity: created, created: true };
    },
  };
}

/**
 * What a log entry is allowed to say about an identity.
 *
 * The row holds three things that must never be written down anywhere: the
 * local password hash, the provider's refresh token, and whatever the provider
 * put in `metadata` (managed role ids today, anything tomorrow — it is the
 * provider's shape, not ours). Each is reported as its presence, and metadata
 * additionally by its key names, so an entry can say "this login replaced the
 * refresh token" or "the managed roles changed" without carrying the secret.
 *
 * Everything else is an identifier already written in plain sight elsewhere in
 * the log: who the identity belongs to, which provider, the provider's id for
 * the person, and the name and email that provider asserts.
 */
function describeIdentity(row: AuthIdentity | undefined) {
  if (!row) return undefined;
  return {
    id: row.id,
    userId: row.userId,
    providerType: row.providerType,
    externalId: row.externalId,
    email: row.email,
    displayName: row.displayName,
    profileImageUrl: row.profileImageUrl,
    hasPasswordHash: row.passwordHash != null,
    hasRefreshToken: row.refreshToken != null,
    metadataKeys: metadataKeysOf(row.metadata),
    lastUsedAt: row.lastUsedAt,
  };
}

/** The same treatment for a payload on its way in, which has no row yet. */
function describeIdentityInput(input: Record<string, unknown> | undefined) {
  if (!input || typeof input !== "object") return input;
  const { passwordHash, refreshToken, metadata, ...rest } = input;
  return {
    ...rest,
    ...(passwordHash !== undefined ? { hasPasswordHash: passwordHash != null } : {}),
    ...(refreshToken !== undefined ? { hasRefreshToken: refreshToken != null } : {}),
    ...(metadata !== undefined ? { metadataKeys: metadataKeysOf(metadata) } : {}),
  };
}

/** Key names only — never a value the provider put in `metadata`. */
function metadataKeysOf(metadata: unknown): string[] {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return [];
  return Object.keys(metadata as Record<string, unknown>).sort();
}

/** How an identity is named in a log line: provider and the person's id there. */
function identityLabel(row: { providerType?: string; externalId?: string } | undefined): string {
  if (!row) return "sign-in identity";
  return `${row.providerType ?? "unknown"} identity ${row.externalId ?? "(no external id)"}`;
}

/**
 * Storage logging for `auth_identities`.
 *
 * Two things shape this config, and both come from the same fact: this table
 * is written on the sign-in path.
 *
 *  - **Nothing sensitive may reach the log.** Every method projects its
 *    arguments and its result through the redactions above; no method lets a
 *    raw row or a raw payload through, so a column added to the table later
 *    cannot leak by default.
 *  - **A login that changes nothing records nothing.** `updateLastUsed` runs
 *    on every sign-in and touches only the last-used stamp, which is an
 *    operational fact about the row and not a change TO it; it is left
 *    unlogged on purpose. `update` runs on every sign-in too, re-asserting
 *    the provider's name and email, and is logged only when the assertion
 *    actually changed the row.
 *
 * The identity is a subrecord of its user: entries are attributed to the user
 * (`hostTable`) so a person's linked sign-ins show up in their record history,
 * and the identity's own provenance is kept under its own id.
 */
export const authIdentitiesLoggingConfig: StorageLoggingConfig<AuthIdentitiesStorage> = {
  module: "authIdentities",
  table: "auth_identities",
  hostTable: "users",
  methods: {
    create: {
      enabled: true,
      logArgs: (args) => [describeIdentityInput(args[0])],
      getEntityId: (_args, result) => (result as AuthIdentity | undefined)?.id,
      getHostEntityId: (args, result) =>
        (result as AuthIdentity | undefined)?.userId ?? args[0]?.userId,
      after: async (_args, result) => describeIdentity(result as AuthIdentity | undefined),
      getDescription: async (args, result) =>
        `Linked ${identityLabel((result as AuthIdentity | undefined) ?? args[0])}`,
    },

    update: {
      enabled: true,
      // A re-assertion of what the row already says is not a change, and this
      // runs on every external sign-in. Storage reports which columns moved.
      shouldLog: (_args, result) =>
        ((result as AuthIdentityUpdateResult | undefined)?.changedFields.length ?? 0) > 0,
      logArgs: (args) => [args[0], describeIdentityInput(args[1])],
      getEntityId: (args) => args[0],
      getHostEntityId: (_args, result) =>
        (result as AuthIdentityUpdateResult | undefined)?.identity.userId,
      // Both states ride in the after payload: the before hook runs before the
      // call and has no way to read the row (this module has no get-by-id),
      // whereas the update itself already read it to decide what changed.
      after: async (_args, result) => {
        const outcome = result as AuthIdentityUpdateResult | undefined;
        return {
          identity: describeIdentity(outcome?.identity),
          previous: describeIdentity(outcome?.previous),
          changedFields: outcome?.changedFields ?? [],
        };
      },
      getDescription: async (_args, result) => {
        const outcome = result as AuthIdentityUpdateResult | undefined;
        const fields = outcome?.changedFields.join(", ") ?? "";
        return `Updated ${identityLabel(outcome?.identity)}${fields ? ` (${fields})` : ""}`;
      },
    },

    // updateLastUsed is absent on purpose: it stamps last_used_at on every
    // sign-in and nothing else, so logging it would put a row in the log for
    // every login and move the identity's modified stamp for a change that
    // was never made to the identity.

    delete: {
      enabled: true,
      shouldLog: (_args, result) =>
        (result as AuthIdentityDeleteResult | undefined)?.deleted === true,
      getEntityId: (args) => args[0],
      getHostEntityId: (_args, result) =>
        (result as AuthIdentityDeleteResult | undefined)?.userId,
      getDescription: async (args) => `Removed sign-in identity ${args[0]}`,
    },

    upsertLocalPasswordHash: {
      enabled: true,
      // The name says neither create nor update and the call can be either,
      // so the classification is stated rather than inferred. It is recorded
      // as a modification: on the far more common replace-the-password path
      // that is exactly what happened, and on the create path the framework
      // still fills in a created date at that moment — it just does not claim
      // to know who made the row, which is the honest answer for a method
      // that is also the boot-time break-glass reconciler's write.
      metadataMode: "modified",
      logArgs: (args) => [args[0], args[1], "[password hash redacted]"],
      getEntityId: (_args, result) =>
        (result as AuthIdentityUpsertResult | undefined)?.identity.id,
      getHostEntityId: (args) => args[0],
      after: async (_args, result) =>
        describeIdentity((result as AuthIdentityUpsertResult | undefined)?.identity),
      getDescription: async (_args, result) => {
        const outcome = result as AuthIdentityUpsertResult | undefined;
        return outcome?.created
          ? `Created local sign-in credential for ${outcome.identity.externalId}`
          : `Set local sign-in password for ${outcome?.identity.externalId ?? "identity"}`;
      },
    },
  },
};
