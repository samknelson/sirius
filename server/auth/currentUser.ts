import type { Request } from "express";
import { storage } from "../storage";
import { logger } from "../logger";

export interface AuthUser {
  id: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  isActive: boolean;
}

export interface AuthContext {
  user: AuthUser | null;
  providerType: string | null;
  claims: {
    sub: string;
    email: string;
    first_name?: string;
    last_name?: string;
  } | null;
}

export async function getCurrentUser(req: Request): Promise<AuthContext> {
  const sessionUser = req.user as any;
  if (!sessionUser?.claims?.sub) {
    return { user: null, providerType: null, claims: null };
  }
  
  const externalId = sessionUser.claims.sub;
  const providerType = sessionUser.providerType || "replit";
  
  let dbUser = sessionUser.dbUser;
  
  if (!dbUser) {
    try {
      const identity = await storage.authIdentities.getByProviderAndExternalId(providerType, externalId);
      if (identity) {
        dbUser = await storage.users.getUser(identity.userId);
      }
    } catch (error) {
      logger.error("Failed to look up user via auth_identity", { error, providerType, externalId });
    }
  }
  
  if (!dbUser) {
    return { user: null, providerType, claims: sessionUser.claims };
  }
  
  return {
    user: {
      id: dbUser.id,
      email: dbUser.email,
      firstName: dbUser.firstName,
      lastName: dbUser.lastName,
      isActive: dbUser.isActive,
    },
    providerType,
    claims: sessionUser.claims,
  };
}
