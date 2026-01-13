import type { Express, RequestHandler } from "express";
import { setupReplitAuth, isAuthenticated as replitIsAuthenticated, getSession as replitGetSession } from "./replit";
import { isMockAuthEnabled, getCurrentUser } from "./currentUser";

export type AuthProvider = "replit" | "mock";

export function getAuthProvider(): AuthProvider {
  if (isMockAuthEnabled()) {
    return "mock";
  }
  return "replit";
}

export async function setupAuth(app: Express): Promise<void> {
  await setupReplitAuth(app);
}

export const isAuthenticated: RequestHandler = async (req, res, next) => {
  if (isMockAuthEnabled()) {
    try {
      const authContext = await getCurrentUser(req);
      if (authContext.user && authContext.user.isActive) {
        (req as any).user = {
          claims: authContext.claims,
          dbUser: authContext.user,
        };
        (req as any).authContext = authContext;
        return next();
      }
      return res.status(401).json({ message: "Mock user not found or inactive" });
    } catch (error) {
      return res.status(500).json({ message: "Mock auth error" });
    }
  }
  
  return replitIsAuthenticated(req, res, next);
};

export function getSession() {
  return replitGetSession();
}

export { getCurrentUser } from "./currentUser";
