import { getClient } from './transaction-context';
import { 
  wsClients,
  wsClientGrants,
  wsClientCredentials,
  wsClientIpRules,
  type WsClient,
  type InsertWsClient,
  type WsClientGrant,
  type WsClientCredential,
  type InsertWsClientCredential,
  type WsClientIpRule,
  type InsertWsClientIpRule,
} from "@shared/schema";
import { eq, and, sql, inArray, notInArray } from "drizzle-orm";
import bcrypt from "bcrypt";
import crypto from "crypto";
import { defineLoggingConfig } from "./middleware/logging";

const SALT_ROUNDS = 12;

export interface WsClientStorage {
  getAll(): Promise<WsClient[]>;
  get(id: string): Promise<WsClient | undefined>;
  create(client: InsertWsClient): Promise<WsClient>;
  update(id: string, client: Partial<InsertWsClient>): Promise<WsClient | undefined>;
  delete(id: string): Promise<boolean>;
}

/**
 * Grants of individual web service configurations to clients. Replaces the
 * one-bundle-per-client assignment: a client holds any number of grants and
 * they are added/revoked without touching credentials.
 */
export interface WsClientGrantStorage {
  /**
   * Every grant held by a client, by configuration id.
   *
   * A grant is a membership, not an event: it is replaced wholesale by
   * `replaceForClient` and the row keeps no creation date of its own, so
   * there is no chronology left to order by. Configuration id is stable and
   * says the same thing on every read.
   */
  getByClient(clientId: string): Promise<WsClientGrant[]>;
  /** Every client granted a given configuration, by client id. */
  getByConfig(configId: string): Promise<WsClientGrant[]>;
  /** True when this exact client/configuration pair is granted. */
  has(clientId: string, configId: string): Promise<boolean>;
  /**
   * Replace a client's entire grant set with `configIds` in one transaction,
   * so a partially applied edit can never leave the client holding a mix of
   * old and new grants.
   */
  replaceForClient(clientId: string, configIds: string[]): Promise<WsClientGrant[]>;
}

export interface CredentialCreateResult {
  credential: WsClientCredential;
  clientKey: string;
  clientSecret: string;
}

export interface WsClientCredentialStorage {
  /** Every credential issued to a client, newest first by its recorded history. */
  getByClient(clientId: string): Promise<WsClientCredential[]>;
  get(id: string): Promise<WsClientCredential | undefined>;
  getByClientKey(clientKey: string): Promise<WsClientCredential | undefined>;
  create(clientId: string, label?: string, expiresAt?: Date): Promise<CredentialCreateResult>;
  deactivate(id: string): Promise<boolean>;
  reactivate(id: string): Promise<boolean>;
  delete(id: string): Promise<boolean>;
  validateSecret(clientKey: string, secret: string): Promise<{ valid: boolean; credential?: WsClientCredential }>;
  recordUsage(id: string): Promise<void>;
}

export interface WsClientIpRuleStorage {
  getByClient(clientId: string): Promise<WsClientIpRule[]>;
  get(id: string): Promise<WsClientIpRule | undefined>;
  create(rule: InsertWsClientIpRule): Promise<WsClientIpRule>;
  update(id: string, rule: Partial<InsertWsClientIpRule>): Promise<WsClientIpRule | undefined>;
  delete(id: string): Promise<boolean>;
  isIpAllowed(clientId: string, ipAddress: string): Promise<boolean>;
}

export function createWsClientStorage(): WsClientStorage {
  return {
    async getAll(): Promise<WsClient[]> {
      const client = getClient();
      return await client
        .select()
        .from(wsClients)
        .orderBy(wsClients.name);
    },

    async get(id: string): Promise<WsClient | undefined> {
      const client = getClient();
      const [result] = await client
        .select()
        .from(wsClients)
        .where(eq(wsClients.id, id));
      return result;
    },

    async create(wsClient: InsertWsClient): Promise<WsClient> {
      const client = getClient();
      const [created] = await client
        .insert(wsClients)
        .values(wsClient)
        .returning();
      return created;
    },

    async update(id: string, wsClient: Partial<InsertWsClient>): Promise<WsClient | undefined> {
      const client = getClient();
      const [updated] = await client
        .update(wsClients)
        .set(wsClient)
        .where(eq(wsClients.id, id))
        .returning();
      return updated;
    },

    async delete(id: string): Promise<boolean> {
      const client = getClient();
      const result = await client
        .delete(wsClients)
        .where(eq(wsClients.id, id));
      return (result.rowCount ?? 0) > 0;
    },
  };
}

export function createWsClientGrantStorage(): WsClientGrantStorage {
  return {
    async getByClient(clientId: string): Promise<WsClientGrant[]> {
      const client = getClient();
      return await client
        .select()
        .from(wsClientGrants)
        .where(eq(wsClientGrants.clientId, clientId))
        .orderBy(wsClientGrants.configId);
    },

    async getByConfig(configId: string): Promise<WsClientGrant[]> {
      const client = getClient();
      return await client
        .select()
        .from(wsClientGrants)
        .where(eq(wsClientGrants.configId, configId))
        .orderBy(wsClientGrants.clientId);
    },

    async has(clientId: string, configId: string): Promise<boolean> {
      const client = getClient();
      const [row] = await client
        .select({ id: wsClientGrants.id })
        .from(wsClientGrants)
        .where(and(
          eq(wsClientGrants.clientId, clientId),
          eq(wsClientGrants.configId, configId),
        ));
      return !!row;
    },

    async replaceForClient(clientId: string, configIds: string[]): Promise<WsClientGrant[]> {
      const client = getClient();
      const wanted = Array.from(new Set(configIds.filter((id) => id && id.trim() !== "")));

      // Remove the grants that are no longer wanted, then add the missing
      // ones. Both statements share the caller's transaction, so the client
      // never observes a half-applied grant set.
      if (wanted.length === 0) {
        await client.delete(wsClientGrants).where(eq(wsClientGrants.clientId, clientId));
      } else {
        await client
          .delete(wsClientGrants)
          .where(and(
            eq(wsClientGrants.clientId, clientId),
            // Non-empty list guaranteed by the branch; the empty case above
            // deletes everything instead.
            notInArray(wsClientGrants.configId, wanted),
          ));
        const existing = await client
          .select({ configId: wsClientGrants.configId })
          .from(wsClientGrants)
          .where(and(
            eq(wsClientGrants.clientId, clientId),
            inArray(wsClientGrants.configId, wanted),
          ));
        const have = new Set(existing.map((r) => r.configId));
        const toAdd = wanted.filter((id) => !have.has(id));
        if (toAdd.length > 0) {
          await client
            .insert(wsClientGrants)
            .values(toAdd.map((configId) => ({ clientId, configId })))
            // Two concurrent edits racing on the same pair must not abort the
            // transaction; the named unique constraint decides the winner.
            .onConflictDoNothing({
              target: [wsClientGrants.clientId, wsClientGrants.configId],
            });
        }
      }

      return await client
        .select()
        .from(wsClientGrants)
        .where(eq(wsClientGrants.clientId, clientId))
        .orderBy(wsClientGrants.configId);
    },
  };
}

export function createWsClientCredentialStorage(): WsClientCredentialStorage {
  return {
    async getByClient(clientId: string): Promise<WsClientCredential[]> {
      const client = getClient();
      return await client
        .select()
        .from(wsClientCredentials)
        .where(eq(wsClientCredentials.clientId, clientId))
        // Newest first, from the record's provenance: the credential row no
        // longer keeps its own creation date. A credential whose provenance
        // was never written sorts last rather than pretending to be oldest.
        .orderBy(
          sql`(SELECT m.created_date FROM entity_metadata m WHERE m.entity_id = ${wsClientCredentials.id}) DESC NULLS LAST`,
          wsClientCredentials.clientKey,
        );
    },

    async get(id: string): Promise<WsClientCredential | undefined> {
      const client = getClient();
      const [credential] = await client
        .select()
        .from(wsClientCredentials)
        .where(eq(wsClientCredentials.id, id));
      return credential;
    },

    async getByClientKey(clientKey: string): Promise<WsClientCredential | undefined> {
      const client = getClient();
      const [credential] = await client
        .select()
        .from(wsClientCredentials)
        .where(eq(wsClientCredentials.clientKey, clientKey));
      return credential;
    },

    async create(clientId: string, label?: string, expiresAt?: Date): Promise<CredentialCreateResult> {
      const client = getClient();
      
      const clientKey = crypto.randomBytes(16).toString('hex');
      const clientSecret = crypto.randomBytes(32).toString('hex');
      const secretHash = await bcrypt.hash(clientSecret, SALT_ROUNDS);
      
      const [credential] = await client
        .insert(wsClientCredentials)
        .values({
          clientId,
          clientKey,
          secretHash,
          label,
          expiresAt,
          isActive: true,
        })
        .returning();
      
      return {
        credential,
        clientKey,
        clientSecret,
      };
    },

    async deactivate(id: string): Promise<boolean> {
      const client = getClient();
      const result = await client
        .update(wsClientCredentials)
        .set({ isActive: false })
        .where(eq(wsClientCredentials.id, id));
      return (result.rowCount ?? 0) > 0;
    },

    async reactivate(id: string): Promise<boolean> {
      const client = getClient();
      const result = await client
        .update(wsClientCredentials)
        .set({ isActive: true })
        .where(eq(wsClientCredentials.id, id));
      return (result.rowCount ?? 0) > 0;
    },

    async delete(id: string): Promise<boolean> {
      const client = getClient();
      const result = await client
        .delete(wsClientCredentials)
        .where(eq(wsClientCredentials.id, id));
      return (result.rowCount ?? 0) > 0;
    },

    async validateSecret(clientKey: string, secret: string): Promise<{ valid: boolean; credential?: WsClientCredential }> {
      const client = getClient();
      const [credential] = await client
        .select()
        .from(wsClientCredentials)
        .where(eq(wsClientCredentials.clientKey, clientKey));
      
      if (!credential) {
        return { valid: false };
      }
      
      if (!credential.isActive) {
        return { valid: false };
      }
      
      if (credential.expiresAt && new Date() > credential.expiresAt) {
        return { valid: false };
      }
      
      const isValid = await bcrypt.compare(secret, credential.secretHash);
      return { valid: isValid, credential: isValid ? credential : undefined };
    },

    async recordUsage(id: string): Promise<void> {
      const client = getClient();
      await client
        .update(wsClientCredentials)
        .set({ lastUsedAt: new Date() })
        .where(eq(wsClientCredentials.id, id));
    },
  };
}

export function createWsClientIpRuleStorage(): WsClientIpRuleStorage {
  return {
    async getByClient(clientId: string): Promise<WsClientIpRule[]> {
      const client = getClient();
      return await client
        .select()
        .from(wsClientIpRules)
        .where(eq(wsClientIpRules.clientId, clientId))
        .orderBy(wsClientIpRules.ipAddress);
    },

    async get(id: string): Promise<WsClientIpRule | undefined> {
      const client = getClient();
      const [rule] = await client
        .select()
        .from(wsClientIpRules)
        .where(eq(wsClientIpRules.id, id));
      return rule;
    },

    async create(rule: InsertWsClientIpRule): Promise<WsClientIpRule> {
      const client = getClient();
      const [created] = await client
        .insert(wsClientIpRules)
        .values(rule)
        .returning();
      return created;
    },

    async update(id: string, rule: Partial<InsertWsClientIpRule>): Promise<WsClientIpRule | undefined> {
      const client = getClient();
      const [updated] = await client
        .update(wsClientIpRules)
        .set(rule)
        .where(eq(wsClientIpRules.id, id))
        .returning();
      return updated;
    },

    async delete(id: string): Promise<boolean> {
      const client = getClient();
      const result = await client
        .delete(wsClientIpRules)
        .where(eq(wsClientIpRules.id, id));
      return (result.rowCount ?? 0) > 0;
    },

    async isIpAllowed(clientId: string, ipAddress: string): Promise<boolean> {
      const client = getClient();
      const [rule] = await client
        .select()
        .from(wsClientIpRules)
        .where(and(
          eq(wsClientIpRules.clientId, clientId),
          eq(wsClientIpRules.ipAddress, ipAddress),
          eq(wsClientIpRules.isActive, true)
        ));
      return !!rule;
    },
  };
}

/**
 * ---------------------------------------------------------------------------
 * Storage logging for the four web-service configuration tables
 * ---------------------------------------------------------------------------
 *
 * These tables hold who may call this installation from the outside, so the
 * question people actually ask of this screen is "who let them in?". Logging
 * answers it twice: as an entry in the admin log viewer, and — through the
 * same middleware — as the record's provenance, which is now the only place a
 * client, credential or IP rule's creation date lives.
 *
 * Two of these tables carry credential material, and the middleware persists
 * the arguments and the before/after state of every logged call. So the
 * credential hooks below project rather than pass through: an audit entry may
 * name a credential and say whether a secret was set, and may never carry the
 * secret, the hash, or the whole client key. `validateSecret` and
 * `recordUsage` are deliberately absent — the first takes a caller's raw
 * secret as an argument and neither is a configuration change.
 */

/** A credential as an audit entry is allowed to describe it. */
interface RedactedCredential {
  id: string;
  clientId: string;
  /** The leading fragment of the client key — enough to recognise, not to use. */
  clientKeyPrefix: string;
  label: string | null;
  isActive: boolean;
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  /** Whether a secret is stored, never anything derived from it. */
  hasSecret: boolean;
}

function redactCredential(row: WsClientCredential | undefined): RedactedCredential | undefined {
  if (!row) return undefined;
  return {
    id: row.id,
    clientId: row.clientId,
    clientKeyPrefix: row.clientKey.slice(0, 8),
    label: row.label ?? null,
    isActive: row.isActive,
    expiresAt: row.expiresAt ?? null,
    lastUsedAt: row.lastUsedAt ?? null,
    hasSecret: !!row.secretHash,
  };
}

interface CredentialBeforeState {
  credential?: RedactedCredential;
}

const credentialBefore = async (args: any[], storage: WsClientCredentialStorage) => ({
  credential: redactCredential(await storage.get(args[0])),
});

const credentialLabel = (before: CredentialBeforeState | undefined) => {
  const record = before?.credential;
  if (!record) return 'credential';
  return record.label
    ? `credential "${record.label}" (${record.clientKeyPrefix}…)`
    : `credential ${record.clientKeyPrefix}…`;
};

/**
 * A web-service client row carries a name, a description, a status and the
 * IP-allowlist switch — no credential material of any kind, which all lives
 * one table over. So this config logs the row as it is; there is nothing here
 * to project away, and a redacted copy would only imply otherwise.
 */
export const wsClientLoggingConfig = defineLoggingConfig<WsClientStorage>({
  module: 'wsClients',
  table: 'ws_clients',
  state: { key: 'client' },
  methods: {
    create: { describe: { label: 'web service client', name: 'name' } },
    update: { describe: { label: 'web service client', name: 'name' } },
    delete: { describe: { label: 'web service client', name: 'name' } },
  },
});

/**
 * Grants are replaced as a set, in one call, inside the caller's transaction.
 * That is the grain the log entry takes: it names the client whose access
 * changed and says which configurations were granted and revoked.
 *
 * `metadataEntityId` therefore answers `undefined` — the call mutated any
 * number of grant rows and none of them is "the record this happened to", so
 * no per-grant provenance is written. What does get stamped is the client:
 * `hostTable` makes this a sub-record touch on `ws_clients`, so the client's
 * own history shows that its access was changed, when, and by whom.
 */
export const wsClientGrantLoggingConfig = defineLoggingConfig<WsClientGrantStorage>({
  module: 'wsClientGrants',
  table: 'ws_client_grants',
  hostTable: 'ws_clients',
  methods: {
    replaceForClient: {
      getEntityId: (args) => args[0],
      getHostEntityId: (args) => args[0],
      metadataEntityId: () => undefined,
      before: async (args: any[], storage: WsClientGrantStorage) => ({
        configIds: (await storage.getByClient(args[0])).map((g) => g.configId).sort(),
      }),
      after: async (_args: any[], result: WsClientGrant[] | undefined) => ({
        configIds: (result ?? []).map((g) => g.configId).sort(),
      }),
      getDescription: async (_args, result: WsClientGrant[] | undefined, beforeState: any) => {
        const had: string[] = beforeState?.configIds ?? [];
        const now = (result ?? []).map((g) => g.configId);
        const granted = now.filter((id) => !had.includes(id));
        const revoked = had.filter((id) => !now.includes(id));
        const parts: string[] = [];
        if (granted.length > 0) parts.push(`granted ${granted.join(', ')}`);
        if (revoked.length > 0) parts.push(`revoked ${revoked.join(', ')}`);
        return parts.length > 0
          ? `Changed web service access: ${parts.join('; ')}`
          : 'Saved web service access (no change)';
      },
    },
  },
});

export const wsClientCredentialLoggingConfig = defineLoggingConfig<WsClientCredentialStorage>({
  module: 'wsClientCredentials',
  table: 'ws_client_credentials',
  hostTable: 'ws_clients',
  methods: {
    create: {
      // The minted key and secret are the RESULT, so this is the projection
      // that matters: the raw result carries both in the clear.
      after: async (_args: any[], result: CredentialCreateResult | undefined) => ({
        credential: redactCredential(result?.credential),
      }),
      getEntityId: (_args, result: CredentialCreateResult | undefined) => result?.credential?.id,
      getHostEntityId: (args) => args[0],
      getDescription: async (args, result: CredentialCreateResult | undefined) => {
        const label = args[1] ? `"${args[1]}"` : 'credential';
        const prefix = result?.credential ? ` (${result.credential.clientKey.slice(0, 8)}…)` : '';
        return `Issued web service ${label}${prefix}`;
      },
    },
    deactivate: {
      before: credentialBefore,
      after: async (_args: any[], result: boolean | undefined) => ({ changed: result === true }),
      getEntityId: (args) => args[0],
      getHostEntityId: (_args, _result, beforeState: CredentialBeforeState | undefined) =>
        beforeState?.credential?.clientId,
      getDescription: async (_args, _result, beforeState) =>
        `Deactivated web service ${credentialLabel(beforeState)}`,
    },
    reactivate: {
      before: credentialBefore,
      after: async (_args: any[], result: boolean | undefined) => ({ changed: result === true }),
      getEntityId: (args) => args[0],
      getHostEntityId: (_args, _result, beforeState: CredentialBeforeState | undefined) =>
        beforeState?.credential?.clientId,
      getDescription: async (_args, _result, beforeState) =>
        `Reactivated web service ${credentialLabel(beforeState)}`,
    },
    delete: {
      before: credentialBefore,
      getEntityId: (args) => args[0],
      getHostEntityId: (_args, _result, beforeState: CredentialBeforeState | undefined) =>
        beforeState?.credential?.clientId,
      getDescription: async (_args, _result, beforeState) =>
        `Deleted web service ${credentialLabel(beforeState)}`,
    },
  },
});

export const wsClientIpRuleLoggingConfig = defineLoggingConfig<WsClientIpRuleStorage>({
  module: 'wsClientIpRules',
  table: 'ws_client_ip_rules',
  hostTable: 'ws_clients',
  hostEntityIdField: 'clientId',
  state: { key: 'rule' },
  methods: {
    create: { describe: { label: 'web service IP rule', name: 'ipAddress' } },
    update: { describe: { label: 'web service IP rule', name: 'ipAddress' } },
    delete: { describe: { label: 'web service IP rule', name: 'ipAddress' } },
  },
});
