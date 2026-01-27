import type { Express, Request, Response, NextFunction } from "express";
import { storage } from "../storage";
import { requireAccess } from "../services/access-policy-evaluator";
import { storageLogger } from "../logger";
import { getRequestContext } from "../middleware/request-context";
import { resolveDbUser } from "../auth/helpers";

// Type for middleware functions
type AuthMiddleware = (req: Request, res: Response, next: NextFunction) => void | Promise<any>;
type PermissionMiddleware = (permissionKey: string) => (req: Request, res: Response, next: NextFunction) => void | Promise<any>;

/**
 * Helper function to get the effective user (masqueraded or original)
 * and masquerade information from a session
 * 
 * @param session - Express session object
 * @param sessionUser - User object from session that may already have dbUser
 */
export async function getEffectiveUser(session: any, sessionUser?: any) {
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
      
      // Fall back to the original user via resolveDbUser
      dbUser = await resolveDbUser(sessionUser, sessionUser?.claims?.sub);
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
    // Not masquerading - get user via resolveDbUser
    dbUser = await resolveDbUser(sessionUser, sessionUser?.claims?.sub);
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
  app.post("/api/auth/masquerade/start", requireAccess('masquerade'), async (req, res) => {
    try {
      const { userId } = req.body;
      const user = req.user as any;
      const session = req.session as any;
      
      if (!userId) {
        return res.status(400).json({ message: "User ID is required" });
      }
      
      // Get the original user via resolveDbUser
      const originalUser = await resolveDbUser(user, user?.claims?.sub);
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
      
      // Record this masquerade in the user's recent masquerades list
      try {
        const currentData = await storage.users.getUserData(originalUser.id) || {};
        const recentMasquerades = (currentData.recentMasquerades as Array<{
          userId: string;
          email: string;
          firstName: string | null;
          lastName: string | null;
          timestamp: string;
        }>) || [];
        
        // Remove existing entry for this user if present
        const filteredList = recentMasquerades.filter(m => m.userId !== targetUser.id);
        
        // Add new entry at the beginning
        const newEntry = {
          userId: targetUser.id,
          email: targetUser.email,
          firstName: targetUser.firstName,
          lastName: targetUser.lastName,
          timestamp: new Date().toISOString(),
        };
        
        // Keep only the most recent 10
        const updatedList = [newEntry, ...filteredList].slice(0, 10);
        
        await storage.users.updateUserData(originalUser.id, {
          ...currentData,
          recentMasquerades: updatedList,
        });
      } catch (err) {
        console.error("Failed to update recent masquerades:", err);
        // Non-fatal error - continue with masquerade
      }
      
      // Log masquerade start
      const originalName = originalUser.firstName && originalUser.lastName
        ? `${originalUser.firstName} ${originalUser.lastName}`
        : originalUser.email;
      const targetName = targetUser.firstName && targetUser.lastName
        ? `${targetUser.firstName} ${targetUser.lastName}`
        : targetUser.email;
      const logData = {
        originalUserId: originalUser.id,
        originalEmail: originalUser.email,
        originalName,
        targetUserId: targetUser.id,
        targetEmail: targetUser.email,
        targetName,
      };
      setImmediate(() => {
        const context = getRequestContext();
        storageLogger.info("Authentication event: masquerade_start", {
          module: "auth",
          operation: "masquerade_start",
          entity_id: logData.originalUserId,
          description: `${logData.originalName} started masquerading as ${logData.targetName}`,
          user_id: logData.originalUserId,
          user_email: logData.originalEmail,
          ip_address: context?.ipAddress,
          meta: {
            originalUserId: logData.originalUserId,
            originalEmail: logData.originalEmail,
            targetUserId: logData.targetUserId,
            targetEmail: logData.targetEmail,
          },
        });
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
      
      // Capture user info before clearing masquerade session
      let logData: { 
        originalUserId?: string; 
        originalEmail?: string; 
        originalName?: string;
        targetUserId?: string; 
        targetEmail?: string; 
        targetName?: string;
      } | null = null;
      
      try {
        const originalUser = await storage.users.getUser(session.originalUserId);
        const targetUser = await storage.users.getUser(session.masqueradeUserId);
        
        if (originalUser && targetUser) {
          const originalName = originalUser.firstName && originalUser.lastName
            ? `${originalUser.firstName} ${originalUser.lastName}`
            : originalUser.email;
          const targetName = targetUser.firstName && targetUser.lastName
            ? `${targetUser.firstName} ${targetUser.lastName}`
            : targetUser.email;
          logData = {
            originalUserId: originalUser.id,
            originalEmail: originalUser.email,
            originalName,
            targetUserId: targetUser.id,
            targetEmail: targetUser.email,
            targetName,
          };
        }
      } catch (error) {
        console.error("Error capturing masquerade stop user info:", error);
      }
      
      // Clear masquerade session
      delete session.masqueradeUserId;
      delete session.originalUserId;
      
      await new Promise((resolve, reject) => {
        session.save((err: any) => err ? reject(err) : resolve(undefined));
      });
      
      // Log masquerade stop
      if (logData) {
        setImmediate(() => {
          const context = getRequestContext();
          storageLogger.info("Authentication event: masquerade_stop", {
            module: "auth",
            operation: "masquerade_stop",
            entity_id: logData!.originalUserId,
            description: `${logData!.originalName} stopped masquerading as ${logData!.targetName}`,
            user_id: logData!.originalUserId,
            user_email: logData!.originalEmail,
            ip_address: context?.ipAddress,
            meta: {
              originalUserId: logData!.originalUserId,
              originalEmail: logData!.originalEmail,
              targetUserId: logData!.targetUserId,
              targetEmail: logData!.targetEmail,
            },
          });
        });
      }
      
      res.json({ message: "Masquerade stopped successfully" });
    } catch (error) {
      res.status(500).json({ message: "Failed to stop masquerade" });
    }
  });

  // GET /api/auth/masquerade/recent - Get recent masquerade targets
  app.get("/api/auth/masquerade/recent", requireAccess('masquerade'), async (req, res) => {
    try {
      const user = req.user as any;
      
      // Get the user making the request via resolveDbUser
      const currentUser = await resolveDbUser(user, user?.claims?.sub);
      if (!currentUser) {
        return res.status(404).json({ message: "User not found" });
      }
      
      const userData = await storage.users.getUserData(currentUser.id);
      const recentMasquerades = (userData?.recentMasquerades as Array<{
        userId: string;
        email: string;
        firstName: string | null;
        lastName: string | null;
        timestamp: string;
      }>) || [];
      
      res.json({ recentMasquerades });
    } catch (error) {
      console.error("Failed to get recent masquerades:", error);
      res.status(500).json({ message: "Failed to get recent masquerades" });
    }
  });
}
