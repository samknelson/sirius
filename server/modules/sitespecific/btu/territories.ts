import type { Express, Request, Response, NextFunction } from "express";
import { requireComponent } from "../../components";
import { storage } from "../../../storage";
import { insertBtuTerritorySchema } from "../../../../shared/schema/sitespecific/btu/schema";

type AuthMiddleware = (req: Request, res: Response, next: NextFunction) => void | Promise<any>;
type PermissionMiddleware = (permissionKey: string) => (req: Request, res: Response, next: NextFunction) => void | Promise<any>;

export function registerBtuTerritoriesRoutes(
  app: Express,
  requireAuth: AuthMiddleware,
  requirePermission: PermissionMiddleware
) {
  const territoriesStorage = storage.btuTerritories;
  const componentMiddleware = requireComponent("sitespecific.btu");

  app.get("/api/sitespecific/btu/territories", requireAuth, componentMiddleware, async (req, res) => {
    try {
      const tableExists = await territoriesStorage.tableExists();
      if (!tableExists) {
        return res.status(503).json({ 
          message: "BTU Territories table does not exist. Please enable the BTU component first." 
        });
      }
      const records = await territoriesStorage.getAll();
      res.json(records);
    } catch (error) {
      console.error("Failed to fetch BTU territories:", error);
      res.status(500).json({ message: "Failed to fetch territories" });
    }
  });

  app.get("/api/sitespecific/btu/territories/:id", requireAuth, componentMiddleware, async (req, res) => {
    try {
      const tableExists = await territoriesStorage.tableExists();
      if (!tableExists) {
        return res.status(503).json({ 
          message: "BTU Territories table does not exist." 
        });
      }
      const record = await territoriesStorage.get(req.params.id);
      if (!record) {
        return res.status(404).json({ message: "Territory not found" });
      }
      res.json(record);
    } catch (error) {
      console.error("Failed to fetch BTU territory:", error);
      res.status(500).json({ message: "Failed to fetch territory" });
    }
  });

  app.post("/api/sitespecific/btu/territories", requireAuth, requirePermission("admin"), componentMiddleware, async (req, res) => {
    try {
      const tableExists = await territoriesStorage.tableExists();
      if (!tableExists) {
        return res.status(503).json({ 
          message: "BTU Territories table does not exist." 
        });
      }
      const parsed = insertBtuTerritorySchema.parse(req.body);
      const record = await territoriesStorage.create(parsed);
      res.status(201).json(record);
    } catch (error: any) {
      if (error.name === "ZodError") {
        return res.status(400).json({ message: "Invalid data", errors: error.errors });
      }
      if (error.code === "23505") {
        return res.status(409).json({ message: "A territory with this Sirius ID already exists" });
      }
      console.error("Failed to create BTU territory:", error);
      res.status(500).json({ message: "Failed to create territory" });
    }
  });

  app.patch("/api/sitespecific/btu/territories/:id", requireAuth, requirePermission("admin"), componentMiddleware, async (req, res) => {
    try {
      const tableExists = await territoriesStorage.tableExists();
      if (!tableExists) {
        return res.status(503).json({ 
          message: "BTU Territories table does not exist." 
        });
      }
      const parsed = insertBtuTerritorySchema.partial().parse(req.body);
      const record = await territoriesStorage.update(req.params.id, parsed);
      if (!record) {
        return res.status(404).json({ message: "Territory not found" });
      }
      res.json(record);
    } catch (error: any) {
      if (error.name === "ZodError") {
        return res.status(400).json({ message: "Invalid data", errors: error.errors });
      }
      if (error.code === "23505") {
        return res.status(409).json({ message: "A territory with this Sirius ID already exists" });
      }
      console.error("Failed to update BTU territory:", error);
      res.status(500).json({ message: "Failed to update territory" });
    }
  });

  app.delete("/api/sitespecific/btu/territories/:id", requireAuth, requirePermission("admin"), componentMiddleware, async (req, res) => {
    try {
      const tableExists = await territoriesStorage.tableExists();
      if (!tableExists) {
        return res.status(503).json({ 
          message: "BTU Territories table does not exist." 
        });
      }
      const success = await territoriesStorage.delete(req.params.id);
      if (!success) {
        return res.status(404).json({ message: "Territory not found" });
      }
      res.json({ success: true });
    } catch (error) {
      console.error("Failed to delete BTU territory:", error);
      res.status(500).json({ message: "Failed to delete territory" });
    }
  });
}
