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
import { eq, and, desc, inArray, notInArray } from "drizzle-orm";
import bcrypt from "bcrypt";
import { generateRandomToken } from "../utils/random-token";

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
  /** Every grant held by a client, oldest first. */
  getByClient(clientId: string): Promise<WsClientGrant[]>;
  /** Every client granted a given configuration. */
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
        .set({ ...wsClient, updatedAt: new Date() })
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
        .orderBy(wsClientGrants.createdAt);
    },

    async getByConfig(configId: string): Promise<WsClientGrant[]> {
      const client = getClient();
      return await client
        .select()
        .from(wsClientGrants)
        .where(eq(wsClientGrants.configId, configId))
        .orderBy(wsClientGrants.createdAt);
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
        .orderBy(wsClientGrants.createdAt);
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
        .orderBy(desc(wsClientCredentials.createdAt));
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
      
      const clientKey = generateRandomToken(16);
      const clientSecret = generateRandomToken(32);
      // Hash the freshly generated random secret (nothing hard-coded here);
      // explicit genSalt keeps the cost factor obvious.
      const salt = await bcrypt.genSalt(SALT_ROUNDS);
      const secretHash = await bcrypt.hash(clientSecret, salt);
      
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
