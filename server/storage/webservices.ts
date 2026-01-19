import { getClient } from './transaction-context';
import { 
  wsBundles,
  wsClients,
  wsClientCredentials,
  wsClientIpRules,
  type WsBundle, 
  type InsertWsBundle,
  type WsClient,
  type InsertWsClient,
  type WsClientCredential,
  type InsertWsClientCredential,
  type WsClientIpRule,
  type InsertWsClientIpRule,
} from "@shared/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import bcrypt from "bcrypt";
import crypto from "crypto";

const SALT_ROUNDS = 12;

export interface WsBundleStorage {
  getAll(): Promise<WsBundle[]>;
  get(id: string): Promise<WsBundle | undefined>;
  getByCode(code: string): Promise<WsBundle | undefined>;
  create(bundle: InsertWsBundle): Promise<WsBundle>;
  update(id: string, bundle: Partial<InsertWsBundle>): Promise<WsBundle | undefined>;
  delete(id: string): Promise<boolean>;
}

export interface WsClientWithBundle extends WsClient {
  bundle?: WsBundle | null;
}

export interface WsClientStorage {
  getAll(): Promise<WsClientWithBundle[]>;
  get(id: string): Promise<WsClientWithBundle | undefined>;
  getByBundle(bundleId: string): Promise<WsClient[]>;
  create(client: InsertWsClient): Promise<WsClient>;
  update(id: string, client: Partial<InsertWsClient>): Promise<WsClient | undefined>;
  delete(id: string): Promise<boolean>;
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

export function createWsBundleStorage(): WsBundleStorage {
  return {
    async getAll(): Promise<WsBundle[]> {
      const client = getClient();
      return await client
        .select()
        .from(wsBundles)
        .orderBy(wsBundles.name);
    },

    async get(id: string): Promise<WsBundle | undefined> {
      const client = getClient();
      const [bundle] = await client
        .select()
        .from(wsBundles)
        .where(eq(wsBundles.id, id));
      return bundle;
    },

    async getByCode(code: string): Promise<WsBundle | undefined> {
      const client = getClient();
      const [bundle] = await client
        .select()
        .from(wsBundles)
        .where(eq(wsBundles.code, code));
      return bundle;
    },

    async create(bundle: InsertWsBundle): Promise<WsBundle> {
      const client = getClient();
      const [created] = await client
        .insert(wsBundles)
        .values(bundle)
        .returning();
      return created;
    },

    async update(id: string, bundle: Partial<InsertWsBundle>): Promise<WsBundle | undefined> {
      const client = getClient();
      const [updated] = await client
        .update(wsBundles)
        .set({ ...bundle, updatedAt: new Date() })
        .where(eq(wsBundles.id, id))
        .returning();
      return updated;
    },

    async delete(id: string): Promise<boolean> {
      const client = getClient();
      const result = await client
        .delete(wsBundles)
        .where(eq(wsBundles.id, id));
      return (result.rowCount ?? 0) > 0;
    },
  };
}

export function createWsClientStorage(): WsClientStorage {
  return {
    async getAll(): Promise<WsClientWithBundle[]> {
      const client = getClient();
      const results = await client
        .select({
          client: wsClients,
          bundle: wsBundles,
        })
        .from(wsClients)
        .leftJoin(wsBundles, eq(wsClients.bundleId, wsBundles.id))
        .orderBy(wsClients.name);
      
      return results.map(r => ({
        ...r.client,
        bundle: r.bundle,
      }));
    },

    async get(id: string): Promise<WsClientWithBundle | undefined> {
      const client = getClient();
      const [result] = await client
        .select({
          client: wsClients,
          bundle: wsBundles,
        })
        .from(wsClients)
        .leftJoin(wsBundles, eq(wsClients.bundleId, wsBundles.id))
        .where(eq(wsClients.id, id));
      
      if (!result) return undefined;
      return {
        ...result.client,
        bundle: result.bundle,
      };
    },

    async getByBundle(bundleId: string): Promise<WsClient[]> {
      const client = getClient();
      return await client
        .select()
        .from(wsClients)
        .where(eq(wsClients.bundleId, bundleId))
        .orderBy(wsClients.name);
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
