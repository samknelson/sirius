import type { AuthenticatedUser } from "./types";
import type { User } from "@shared/schema";
import { currentSessionOwner } from "./account-authority";
import { logger } from "../logger";

export interface ResolveDbUserOptions {
  requireActive?: boolean;
}

export async function resolveDbUser(
  sessionUser: AuthenticatedUser | undefined,
  externalId?: string,
  options: ResolveDbUserOptions = {}
): Promise<User | null> {
  try {
    // Kept in the signature for existing callers; inactive users are never an
    // authenticated actor, even when an old caller did not request this check.
    const dbUser = await currentSessionOwner(sessionUser);
    if (sessionUser && dbUser) sessionUser.dbUser = dbUser;
    return dbUser;
  } catch (error) {
    logger.error("Failed to resolve database user", { error });
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
