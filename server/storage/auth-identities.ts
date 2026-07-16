import { createNoopValidator } from './utils/validation';
import { eq, and } from "drizzle-orm";
import { getClient } from "./transaction-context";
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

  update(
    id: string,
    data: Partial<Omit<InsertAuthIdentity, "id" | "userId" | "providerType" | "externalId">>
  ): Promise<AuthIdentity | undefined>;

  updateLastUsed(id: string): Promise<void>;

  delete(id: string): Promise<boolean>;

  deleteByUserIdAndProvider(
    userId: string,
    providerType: AuthProviderType
  ): Promise<boolean>;

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
  ): Promise<AuthIdentity>;
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
      data: Partial<Omit<InsertAuthIdentity, "id" | "userId" | "providerType" | "externalId">>
    ): Promise<AuthIdentity | undefined> {
      validate.validateOrThrow(data);
      const client = getClient();
      const [updated] = await client
        .update(authIdentities)
        .set({
          ...data,
          updatedAt: new Date(),
        })
        .where(eq(authIdentities.id, id))
        .returning();
      return updated;
    },

    async updateLastUsed(id: string): Promise<void> {
      const client = getClient();
      await client
        .update(authIdentities)
        .set({
          lastUsedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(authIdentities.id, id));
    },

    async delete(id: string): Promise<boolean> {
      const client = getClient();
      const result = await client
        .delete(authIdentities)
        .where(eq(authIdentities.id, id))
        .returning({ id: authIdentities.id });
      return result.length > 0;
    },

    async deleteByUserIdAndProvider(
      userId: string,
      providerType: AuthProviderType
    ): Promise<boolean> {
      const client = getClient();
      const result = await client
        .delete(authIdentities)
        .where(
          and(
            eq(authIdentities.userId, userId),
            eq(authIdentities.providerType, providerType)
          )
        )
        .returning({ id: authIdentities.id });
      return result.length > 0;
    },

    async upsertLocalPasswordHash(
      userId: string,
      email: string,
      passwordHash: string
    ): Promise<AuthIdentity> {
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
            updatedAt: new Date(),
          })
          .where(eq(authIdentities.id, existing.id))
          .returning();
        return updated;
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
      return created;
    },
  };
}
