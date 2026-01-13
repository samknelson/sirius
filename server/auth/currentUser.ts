import type { Request } from "express";
import { storage } from "../storage";
import { logger } from "../logger";

export interface AuthUser {
  id: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  replitUserId?: string | null;
  isActive: boolean;
  isMock?: boolean;
}

export interface AuthContext {
  user: AuthUser | null;
  isMock: boolean;
  claims: {
    sub: string;
    email: string;
    first_name?: string;
    last_name?: string;
  } | null;
}

let mockUserWarningShown = false;

export function isMockAuthEnabled(): boolean {
  return process.env.MOCK_USER === "true";
}

export async function getCurrentUser(req: Request): Promise<AuthContext> {
  if (isMockAuthEnabled()) {
    if (process.env.NODE_ENV === "production" && process.env.ALLOW_MOCK_IN_PROD !== "true") {
      logger.error("MOCK_USER is enabled in production without ALLOW_MOCK_IN_PROD=true. This is a security risk!", {
        source: "auth",
      });
      throw new Error("Mock auth not allowed in production");
    }
    
    if (!mockUserWarningShown) {
      logger.warn("⚠️  MOCK USER MODE ENABLED - Using mock authentication for testing. DO NOT USE IN REAL PRODUCTION!", {
        source: "auth",
      });
      mockUserWarningShown = true;
    }
    
    const mockUser = await getMockUser();
    if (mockUser) {
      return {
        user: { ...mockUser, isMock: true },
        isMock: true,
        claims: {
          sub: mockUser.replitUserId || `mock-${mockUser.id}`,
          email: mockUser.email,
          first_name: mockUser.firstName || undefined,
          last_name: mockUser.lastName || undefined,
        },
      };
    }
  }
  
  const sessionUser = req.user as any;
  if (!sessionUser?.claims?.sub) {
    return { user: null, isMock: false, claims: null };
  }
  
  const dbUser = sessionUser.dbUser || await storage.users.getUserByReplitId(sessionUser.claims.sub);
  
  if (!dbUser) {
    return { user: null, isMock: false, claims: sessionUser.claims };
  }
  
  return {
    user: {
      id: dbUser.id,
      email: dbUser.email,
      firstName: dbUser.firstName,
      lastName: dbUser.lastName,
      replitUserId: dbUser.replitUserId,
      isActive: dbUser.isActive,
    },
    isMock: false,
    claims: sessionUser.claims,
  };
}

async function getMockUser(): Promise<AuthUser | null> {
  const mockUserId = process.env.MOCK_USER_ID;
  const mockUserEmail = process.env.MOCK_USER_EMAIL;
  
  let dbUser = null;
  
  if (mockUserId) {
    dbUser = await storage.users.getUser(mockUserId);
  } else if (mockUserEmail) {
    dbUser = await storage.users.getUserByEmail(mockUserEmail);
  } else {
    const allUsers = await storage.users.getAllUsers();
    if (allUsers.length > 0) {
      dbUser = allUsers[0];
      logger.warn(`Mock auth: No MOCK_USER_ID or MOCK_USER_EMAIL specified, using first user: ${dbUser.email}`, {
        source: "auth",
      });
    }
  }
  
  if (!dbUser) {
    logger.error("Mock auth enabled but no valid user found. Set MOCK_USER_ID or MOCK_USER_EMAIL.", {
      source: "auth",
    });
    return null;
  }
  
  return {
    id: dbUser.id,
    email: dbUser.email,
    firstName: dbUser.firstName,
    lastName: dbUser.lastName,
    replitUserId: dbUser.replitUserId,
    isActive: dbUser.isActive,
  };
}
