import type { Express, Request, Response, NextFunction } from "express";
import { requireAccess } from "../accessControl";
import { policies } from "../policies";
import { requireComponent } from "./components";
import { createBtuCsgStorage, type InsertBtuCsgRecord } from "../storage/sitespecific-btu-csg";
import { z } from "zod";

type AuthMiddleware = (req: Request, res: Response, next: NextFunction) => void | Promise<any>;
type PermissionMiddleware = (permissionKey: string) => (req: Request, res: Response, next: NextFunction) => void | Promise<any>;

const insertSchema = z.object({
  bpsId: z.string().nullable().optional(),
  firstName: z.string().nullable().optional(),
  lastName: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  nonBpsEmail: z.string().email().nullable().optional().or(z.literal("")),
  school: z.string().nullable().optional(),
  principalHeadmaster: z.string().nullable().optional(),
  role: z.string().nullable().optional(),
  typeOfClass: z.string().nullable().optional(),
  course: z.string().nullable().optional(),
  section: z.string().nullable().optional(),
  numberOfStudents: z.string().nullable().optional(),
  comments: z.string().nullable().optional(),
  status: z.string().optional(),
  adminNotes: z.string().nullable().optional(),
});

export function registerBtuCsgRoutes(
  app: Express,
  requireAuth: AuthMiddleware,
  requirePermission: PermissionMiddleware
) {
  const storage = createBtuCsgStorage();
  const componentMiddleware = requireComponent("sitespecific.btu");

  app.get("/api/sitespecific/btu/csg", requireAuth, componentMiddleware, async (req, res) => {
    try {
      const tableExists = await storage.tableExists();
      if (!tableExists) {
        return res.status(503).json({ 
          message: "BTU CSG table does not exist. Please enable the BTU component first." 
        });
      }
      const records = await storage.getAll();
      res.json(records);
    } catch (error) {
      console.error("Failed to fetch BTU CSG records:", error);
      res.status(500).json({ message: "Failed to fetch records" });
    }
  });

  app.get("/api/sitespecific/btu/csg/:id", requireAuth, componentMiddleware, async (req, res) => {
    try {
      const tableExists = await storage.tableExists();
      if (!tableExists) {
        return res.status(503).json({ 
          message: "BTU CSG table does not exist. Please enable the BTU component first." 
        });
      }
      const record = await storage.get(req.params.id);
      if (!record) {
        return res.status(404).json({ message: "Record not found" });
      }
      res.json(record);
    } catch (error) {
      console.error("Failed to fetch BTU CSG record:", error);
      res.status(500).json({ message: "Failed to fetch record" });
    }
  });

  app.post("/api/sitespecific/btu/csg", requireAuth, componentMiddleware, async (req, res) => {
    try {
      const tableExists = await storage.tableExists();
      if (!tableExists) {
        return res.status(503).json({ 
          message: "BTU CSG table does not exist. Please enable the BTU component first." 
        });
      }
      
      const parseResult = insertSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({ 
          message: "Validation failed", 
          errors: parseResult.error.errors 
        });
      }

      const record = await storage.create(parseResult.data as InsertBtuCsgRecord);
      res.status(201).json(record);
    } catch (error) {
      console.error("Failed to create BTU CSG record:", error);
      res.status(500).json({ message: "Failed to create record" });
    }
  });

  app.patch("/api/sitespecific/btu/csg/:id", requireAuth, componentMiddleware, async (req, res) => {
    try {
      const tableExists = await storage.tableExists();
      if (!tableExists) {
        return res.status(503).json({ 
          message: "BTU CSG table does not exist. Please enable the BTU component first." 
        });
      }
      
      const parseResult = insertSchema.partial().safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({ 
          message: "Validation failed", 
          errors: parseResult.error.errors 
        });
      }

      const record = await storage.update(req.params.id, parseResult.data as Partial<InsertBtuCsgRecord>);
      if (!record) {
        return res.status(404).json({ message: "Record not found" });
      }
      res.json(record);
    } catch (error) {
      console.error("Failed to update BTU CSG record:", error);
      res.status(500).json({ message: "Failed to update record" });
    }
  });

  app.delete("/api/sitespecific/btu/csg/:id", requireAuth, componentMiddleware, async (req, res) => {
    try {
      const tableExists = await storage.tableExists();
      if (!tableExists) {
        return res.status(503).json({ 
          message: "BTU CSG table does not exist. Please enable the BTU component first." 
        });
      }
      
      const deleted = await storage.delete(req.params.id);
      if (!deleted) {
        return res.status(404).json({ message: "Record not found" });
      }
      res.json({ message: "Record deleted successfully" });
    } catch (error) {
      console.error("Failed to delete BTU CSG record:", error);
      res.status(500).json({ message: "Failed to delete record" });
    }
  });
}
