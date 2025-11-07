import type { Express, Request, Response, NextFunction } from "express";
import { storage } from "../storage";
import { insertBookmarkSchema } from "@shared/schema";
import { requireAccess } from "../accessControl";
import { policies } from "../policies";

type AuthMiddleware = (req: Request, res: Response, next: NextFunction) => void | Promise<any>;
type PermissionMiddleware = (permissionKey: string) => (req: Request, res: Response, next: NextFunction) => void | Promise<any>;

export function registerBookmarkRoutes(
  app: Express, 
  requireAuth: AuthMiddleware, 
  requirePermission: PermissionMiddleware
) {
  // GET /api/bookmarks - Get all bookmarks for the current user
  app.get("/api/bookmarks", requireAccess(policies.bookmark), async (req, res) => {
    try {
      const user = req.user as any;
      const replitUserId = user.claims.sub;
      const dbUser = await storage.users.getUserByReplitId(replitUserId);
      
      if (!dbUser) {
        return res.status(401).json({ message: "User not found" });
      }

      const bookmarks = await storage.bookmarks.getUserBookmarks(dbUser.id);
      res.json(bookmarks);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch bookmarks" });
    }
  });

  // GET /api/bookmarks/check - Check if a specific entity is bookmarked
  app.get("/api/bookmarks/check", requireAccess(policies.bookmark), async (req, res) => {
    try {
      const { entityType, entityId } = req.query;
      
      if (!entityType || !entityId) {
        return res.status(400).json({ message: "entityType and entityId are required" });
      }

      const user = req.user as any;
      const replitUserId = user.claims.sub;
      const dbUser = await storage.users.getUserByReplitId(replitUserId);
      
      if (!dbUser) {
        return res.status(401).json({ message: "User not found" });
      }

      const bookmark = await storage.bookmarks.findBookmark(dbUser.id, entityType as string, entityId as string);
      res.json({ bookmarked: !!bookmark, bookmark });
    } catch (error) {
      res.status(500).json({ message: "Failed to check bookmark" });
    }
  });

  // POST /api/bookmarks - Create a new bookmark
  app.post("/api/bookmarks", requireAccess(policies.bookmark), async (req, res) => {
    try {
      const user = req.user as any;
      const replitUserId = user.claims.sub;
      const dbUser = await storage.users.getUserByReplitId(replitUserId);
      
      if (!dbUser) {
        return res.status(401).json({ message: "User not found" });
      }

      const { entityType, entityId } = req.body;
      const validatedData = insertBookmarkSchema.parse({
        userId: dbUser.id,
        entityType,
        entityId,
      });

      // Check if bookmark already exists
      const existing = await storage.bookmarks.findBookmark(dbUser.id, entityType, entityId);
      if (existing) {
        return res.status(409).json({ message: "Bookmark already exists" });
      }

      const bookmark = await storage.bookmarks.createBookmark(validatedData);
      res.status(201).json(bookmark);
    } catch (error) {
      if (error instanceof Error && error.name === "ZodError") {
        res.status(400).json({ message: "Invalid bookmark data" });
      } else {
        res.status(500).json({ message: "Failed to create bookmark" });
      }
    }
  });

  // DELETE /api/bookmarks/:id - Delete a bookmark by ID
  app.delete("/api/bookmarks/:id", requireAccess(policies.bookmark), async (req, res) => {
    try {
      const { id } = req.params;
      const user = req.user as any;
      const replitUserId = user.claims.sub;
      const dbUser = await storage.users.getUserByReplitId(replitUserId);
      
      if (!dbUser) {
        return res.status(401).json({ message: "User not found" });
      }

      // Verify the bookmark belongs to the user
      const bookmark = await storage.bookmarks.getBookmark(id);
      if (!bookmark) {
        return res.status(404).json({ message: "Bookmark not found" });
      }

      if (bookmark.userId !== dbUser.id) {
        return res.status(403).json({ message: "Unauthorized to delete this bookmark" });
      }

      const success = await storage.bookmarks.deleteBookmark(id);
      if (!success) {
        return res.status(404).json({ message: "Bookmark not found" });
      }

      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Failed to delete bookmark" });
    }
  });

  // DELETE /api/bookmarks/entity/:entityType/:entityId - Delete a bookmark by entity type and ID
  app.delete("/api/bookmarks/entity/:entityType/:entityId", requireAccess(policies.bookmark), async (req, res) => {
    try {
      const { entityType, entityId } = req.params;
      
      if (!entityType || !entityId) {
        return res.status(400).json({ message: "entityType and entityId are required" });
      }

      const user = req.user as any;
      const replitUserId = user.claims.sub;
      const dbUser = await storage.users.getUserByReplitId(replitUserId);
      
      if (!dbUser) {
        return res.status(401).json({ message: "User not found" });
      }

      const bookmark = await storage.bookmarks.findBookmark(dbUser.id, entityType, entityId);
      if (!bookmark) {
        return res.status(404).json({ message: "Bookmark not found" });
      }

      const success = await storage.bookmarks.deleteBookmark(bookmark.id);
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Failed to delete bookmark" });
    }
  });
}
