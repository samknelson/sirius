import type { Express, Request, Response, NextFunction } from "express";
import { createCommStorage } from "../storage";

type AuthMiddleware = (req: Request, res: Response, next: NextFunction) => void | Promise<any>;
type PermissionMiddleware = (permissionKey: string) => (req: Request, res: Response, next: NextFunction) => void | Promise<any>;
type PolicyMiddleware = (policy: any) => (req: Request, res: Response, next: NextFunction) => void | Promise<any>;

const commStorage = createCommStorage();

export function registerCommRoutes(
  app: Express, 
  requireAuth: AuthMiddleware, 
  requirePermission: PermissionMiddleware,
  requireAccess?: PolicyMiddleware
) {
  
  // GET /api/contacts/:contactId/comm - Get all comm records with SMS details for a contact
  app.get("/api/contacts/:contactId/comm", requireAuth, requirePermission("workers.view"), async (req, res) => {
    try {
      const { contactId } = req.params;
      const records = await commStorage.getCommsByContactWithSms(contactId);
      res.json(records);
    } catch (error) {
      console.error("Failed to fetch comm records:", error);
      res.status(500).json({ message: "Failed to fetch communication records" });
    }
  });

  // GET /api/comm/:id - Get specific comm record with SMS details
  app.get("/api/comm/:id", requireAuth, requirePermission("workers.view"), async (req, res) => {
    try {
      const { id } = req.params;
      const record = await commStorage.getCommWithSms(id);
      
      if (!record) {
        return res.status(404).json({ message: "Communication record not found" });
      }
      
      res.json(record);
    } catch (error) {
      console.error("Failed to fetch comm record:", error);
      res.status(500).json({ message: "Failed to fetch communication record" });
    }
  });
}
