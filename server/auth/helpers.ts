import type { AuthenticatedUser } from "./types";
import type { AuthProviderType } from "@shared/schema";
import type { User } from "@shared/schema";
import { providerRegistry } from "./index";
import { logger } from "../logger";

const getStorage = () => require("../storage").storage;

export interface ResolveDbUserOptions {
  requireActive?: boolean;
}

export async function resolveDbUser(
  sessionUser: AuthenticatedUser | undefined,
  externalId?: string,
  options: ResolveDbUserOptions = {}
): Promise<User | null> {
  const { requireActive = false } = options;

  if (!sessionUser) {
    return null;
  }

  if (sessionUser.dbUser) {
    if (requireActive && !sessionUser.dbUser.isActive) {
      logger.debug("Cached dbUser is inactive", { userId: sessionUser.dbUser.id });
      return null;
    }
    return sessionUser.dbUser as User;
  }

  const effectiveExternalId = externalId || sessionUser.claims?.sub;
  if (!effectiveExternalId) {
    logger.debug("No external ID available for user lookup");
    return null;
  }

  const providerType: AuthProviderType = sessionUser.providerType || 
    providerRegistry.getDefault()?.type || 
    "replit";

  try {
    const storage = getStorage();
    if (!storage?.authIdentities || !storage?.users) {
      logger.warn("Storage not available for resolveDbUser");
      return null;
    }

    const identity = await storage.authIdentities.getByProviderAndExternalId(
      providerType,
      effectiveExternalId
    );

    if (!identity) {
      logger.debug("No auth identity found", { providerType, externalId: effectiveExternalId });
      return null;
    }

    const dbUser = await storage.users.getUser(identity.userId);
    if (!dbUser) {
      logger.warn("Auth identity found but user missing", { identityId: identity.id });
      return null;
    }

    if (requireActive && !dbUser.isActive) {
      logger.debug("User is inactive", { userId: dbUser.id });
      return null;
    }

    sessionUser.dbUser = dbUser;

    return dbUser;
  } catch (error) {
    logger.error("Failed to resolve database user", { error, providerType });
    return null;
  }
}

export async function getDbUserFromSession(
  sessionUser: any
): Promise<User | null> {
  if (!sessionUser?.claims?.sub) {
    return null;
  }
  return resolveDbUser(sessionUser as AuthenticatedUser, sessionUser.claims.sub);
}
