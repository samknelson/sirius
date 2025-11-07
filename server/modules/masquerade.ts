import type { Express, Request, Response, NextFunction } from "express";
import { storage } from "../storage";
import { requireAccess } from "../accessControl";
import { policies } from "../policies";

// Type for middleware functions
type AuthMiddleware = (req: Request, res: Response, next: NextFunction) => void | Promise<any>;
type PermissionMiddleware = (permissionKey: string) => (req: Request, res: Response, next: NextFunction) => void | Promise<any>;

/**
 * Helper function to get the effective user (masqueraded or original)
 * and masquerade information from a session
 */
export async function getEffectiveUser(session: any, replitUserId: string) {
  let dbUser;
  let originalUser = null;
  
  if (session.masqueradeUserId) {
    // Get masqueraded user
    dbUser = await storage.users.getUser(session.masqueradeUserId);
    if (!dbUser) {
      // Clear invalid masquerade session and fall back to original user
      delete session.masqueradeUserId;
      delete session.originalUserId;
      await new Promise((resolve, reject) => {
        session.save((err: any) => err ? reject(err) : resolve(undefined));
      });
      
      // Fall back to the original user
      dbUser = await storage.users.getUserByReplitId(replitUserId);
      if (!dbUser) {
        return { dbUser: null, originalUser: null };
      }
    } else {
      // Get the original user info
      if (session.originalUserId) {
        originalUser = await storage.users.getUser(session.originalUserId);
      }
    }
  } else {
    // Not masquerading - get user by Replit ID
    dbUser = await storage.users.getUserByReplitId(replitUserId);
    if (!dbUser) {
      return { dbUser: null, originalUser: null };
    }
  }
  
  return { dbUser, originalUser };
}

/**
 * Register masquerade-related routes
 */
export function registerMasqueradeRoutes(
  app: Express,
  requireAuth: AuthMiddleware,
  requirePermission: PermissionMiddleware
) {
  // POST /api/auth/masquerade/start - Start masquerading as another user
  app.post("/api/auth/masquerade/start", requireAccess(policies.masquerade), async (req, res) => {
    try {
      const { userId } = req.body;
      const user = req.user as any;
      const replitUserId = user.claims.sub;
      const session = req.session as any;
      
      if (!userId) {
        return res.status(400).json({ message: "User ID is required" });
      }
      
      // Get the original user
      const originalUser = await storage.users.getUserByReplitId(replitUserId);
      if (!originalUser) {
        return res.status(404).json({ message: "Original user not found" });
      }
      
      // Verify the target user exists
      const targetUser = await storage.users.getUser(userId);
      if (!targetUser) {
        return res.status(404).json({ message: "Target user not found" });
      }
      
      // Prevent masquerading if already masquerading
      if (session.masqueradeUserId) {
        return res.status(400).json({ message: "Already masquerading. Stop current masquerade first." });
      }
      
      // Start masquerade session
      session.originalUserId = originalUser.id;
      session.masqueradeUserId = userId;
      
      await new Promise((resolve, reject) => {
        session.save((err: any) => err ? reject(err) : resolve(undefined));
      });
      
      res.json({ 
        message: "Masquerade started successfully",
        masqueradingAs: {
          id: targetUser.id,
          email: targetUser.email,
          firstName: targetUser.firstName,
          lastName: targetUser.lastName,
        }
      });
    } catch (error) {
      res.status(500).json({ message: "Failed to start masquerade" });
    }
  });

  // POST /api/auth/masquerade/stop - Stop masquerading
  app.post("/api/auth/masquerade/stop", requireAuth, async (req, res) => {
    try {
      const session = req.session as any;
      
      if (!session.masqueradeUserId) {
        return res.status(400).json({ message: "Not currently masquerading" });
      }
      
      // Clear masquerade session
      delete session.masqueradeUserId;
      delete session.originalUserId;
      
      await new Promise((resolve, reject) => {
        session.save((err: any) => err ? reject(err) : resolve(undefined));
      });
      
      res.json({ message: "Masquerade stopped successfully" });
    } catch (error) {
      res.status(500).json({ message: "Failed to stop masquerade" });
    }
  });
}
