import type { Express, Request, Response, NextFunction } from "express";
import { requireComponent } from "./components";
import { storage } from "../storage";
import { 
  insertBtuSchoolTypeSchema, 
  insertBtuRegionSchema, 
  insertBtuSchoolAttributesSchema 
} from "../../shared/schema/sitespecific/btu/schema";

type AuthMiddleware = (req: Request, res: Response, next: NextFunction) => void | Promise<any>;
type PermissionMiddleware = (permissionKey: string) => (req: Request, res: Response, next: NextFunction) => void | Promise<any>;

export function registerBtuSchoolRoutes(
  app: Express,
  requireAuth: AuthMiddleware,
  requirePermission: PermissionMiddleware
) {
  const schoolTypesStorage = storage.btuSchoolTypes;
  const regionsStorage = storage.btuRegions;
  const schoolAttributesStorage = storage.btuSchoolAttributes;
  const componentMiddleware = requireComponent("sitespecific.btu");

  // ==================== School Types Routes ====================

  app.get("/api/sitespecific/btu/school-types", requireAuth, componentMiddleware, async (req, res) => {
    try {
      const tableExists = await schoolTypesStorage.tableExists();
      if (!tableExists) {
        return res.status(503).json({ 
          message: "BTU School Types table does not exist. Please enable the BTU component first." 
        });
      }
      const records = await schoolTypesStorage.getAll();
      res.json(records);
    } catch (error) {
      console.error("Failed to fetch BTU school types:", error);
      res.status(500).json({ message: "Failed to fetch school types" });
    }
  });

  app.get("/api/sitespecific/btu/school-types/:id", requireAuth, componentMiddleware, async (req, res) => {
    try {
      const tableExists = await schoolTypesStorage.tableExists();
      if (!tableExists) {
        return res.status(503).json({ message: "BTU School Types table does not exist." });
      }
      const record = await schoolTypesStorage.get(req.params.id);
      if (!record) {
        return res.status(404).json({ message: "School type not found" });
      }
      res.json(record);
    } catch (error) {
      console.error("Failed to fetch BTU school type:", error);
      res.status(500).json({ message: "Failed to fetch school type" });
    }
  });

  app.post("/api/sitespecific/btu/school-types", requireAuth, requirePermission("admin"), componentMiddleware, async (req, res) => {
    try {
      const tableExists = await schoolTypesStorage.tableExists();
      if (!tableExists) {
        return res.status(503).json({ message: "BTU School Types table does not exist." });
      }
      const parsed = insertBtuSchoolTypeSchema.parse(req.body);
      const record = await schoolTypesStorage.create(parsed);
      res.status(201).json(record);
    } catch (error: any) {
      if (error.name === "ZodError") {
        return res.status(400).json({ message: "Invalid data", errors: error.errors });
      }
      if (error.code === "23505") {
        return res.status(409).json({ message: "A school type with this Sirius ID already exists" });
      }
      console.error("Failed to create BTU school type:", error);
      res.status(500).json({ message: "Failed to create school type" });
    }
  });

  app.patch("/api/sitespecific/btu/school-types/:id", requireAuth, requirePermission("admin"), componentMiddleware, async (req, res) => {
    try {
      const tableExists = await schoolTypesStorage.tableExists();
      if (!tableExists) {
        return res.status(503).json({ message: "BTU School Types table does not exist." });
      }
      const parsed = insertBtuSchoolTypeSchema.partial().parse(req.body);
      const record = await schoolTypesStorage.update(req.params.id, parsed);
      if (!record) {
        return res.status(404).json({ message: "School type not found" });
      }
      res.json(record);
    } catch (error: any) {
      if (error.name === "ZodError") {
        return res.status(400).json({ message: "Invalid data", errors: error.errors });
      }
      if (error.code === "23505") {
        return res.status(409).json({ message: "A school type with this Sirius ID already exists" });
      }
      console.error("Failed to update BTU school type:", error);
      res.status(500).json({ message: "Failed to update school type" });
    }
  });

  app.delete("/api/sitespecific/btu/school-types/:id", requireAuth, requirePermission("admin"), componentMiddleware, async (req, res) => {
    try {
      const tableExists = await schoolTypesStorage.tableExists();
      if (!tableExists) {
        return res.status(503).json({ message: "BTU School Types table does not exist." });
      }
      const deleted = await schoolTypesStorage.delete(req.params.id);
      if (!deleted) {
        return res.status(404).json({ message: "School type not found" });
      }
      res.status(204).send();
    } catch (error) {
      console.error("Failed to delete BTU school type:", error);
      res.status(500).json({ message: "Failed to delete school type" });
    }
  });

  // ==================== Regions Routes ====================

  app.get("/api/sitespecific/btu/regions", requireAuth, componentMiddleware, async (req, res) => {
    try {
      const tableExists = await regionsStorage.tableExists();
      if (!tableExists) {
        return res.status(503).json({ 
          message: "BTU Regions table does not exist. Please enable the BTU component first." 
        });
      }
      const records = await regionsStorage.getAll();
      res.json(records);
    } catch (error) {
      console.error("Failed to fetch BTU regions:", error);
      res.status(500).json({ message: "Failed to fetch regions" });
    }
  });

  app.get("/api/sitespecific/btu/regions/:id", requireAuth, componentMiddleware, async (req, res) => {
    try {
      const tableExists = await regionsStorage.tableExists();
      if (!tableExists) {
        return res.status(503).json({ message: "BTU Regions table does not exist." });
      }
      const record = await regionsStorage.get(req.params.id);
      if (!record) {
        return res.status(404).json({ message: "Region not found" });
      }
      res.json(record);
    } catch (error) {
      console.error("Failed to fetch BTU region:", error);
      res.status(500).json({ message: "Failed to fetch region" });
    }
  });

  app.post("/api/sitespecific/btu/regions", requireAuth, requirePermission("admin"), componentMiddleware, async (req, res) => {
    try {
      const tableExists = await regionsStorage.tableExists();
      if (!tableExists) {
        return res.status(503).json({ message: "BTU Regions table does not exist." });
      }
      const parsed = insertBtuRegionSchema.parse(req.body);
      const record = await regionsStorage.create(parsed);
      res.status(201).json(record);
    } catch (error: any) {
      if (error.name === "ZodError") {
        return res.status(400).json({ message: "Invalid data", errors: error.errors });
      }
      if (error.code === "23505") {
        return res.status(409).json({ message: "A region with this Sirius ID already exists" });
      }
      console.error("Failed to create BTU region:", error);
      res.status(500).json({ message: "Failed to create region" });
    }
  });

  app.patch("/api/sitespecific/btu/regions/:id", requireAuth, requirePermission("admin"), componentMiddleware, async (req, res) => {
    try {
      const tableExists = await regionsStorage.tableExists();
      if (!tableExists) {
        return res.status(503).json({ message: "BTU Regions table does not exist." });
      }
      const parsed = insertBtuRegionSchema.partial().parse(req.body);
      const record = await regionsStorage.update(req.params.id, parsed);
      if (!record) {
        return res.status(404).json({ message: "Region not found" });
      }
      res.json(record);
    } catch (error: any) {
      if (error.name === "ZodError") {
        return res.status(400).json({ message: "Invalid data", errors: error.errors });
      }
      if (error.code === "23505") {
        return res.status(409).json({ message: "A region with this Sirius ID already exists" });
      }
      console.error("Failed to update BTU region:", error);
      res.status(500).json({ message: "Failed to update region" });
    }
  });

  app.delete("/api/sitespecific/btu/regions/:id", requireAuth, requirePermission("admin"), componentMiddleware, async (req, res) => {
    try {
      const tableExists = await regionsStorage.tableExists();
      if (!tableExists) {
        return res.status(503).json({ message: "BTU Regions table does not exist." });
      }
      const deleted = await regionsStorage.delete(req.params.id);
      if (!deleted) {
        return res.status(404).json({ message: "Region not found" });
      }
      res.status(204).send();
    } catch (error) {
      console.error("Failed to delete BTU region:", error);
      res.status(500).json({ message: "Failed to delete region" });
    }
  });

  // ==================== School Attributes Routes ====================

  app.get("/api/sitespecific/btu/school-attributes", requireAuth, componentMiddleware, async (req, res) => {
    try {
      const tableExists = await schoolAttributesStorage.tableExists();
      if (!tableExists) {
        return res.status(503).json({ 
          message: "BTU School Attributes table does not exist. Please enable the BTU component first." 
        });
      }
      const records = await schoolAttributesStorage.getAll();
      res.json(records);
    } catch (error) {
      console.error("Failed to fetch BTU school attributes:", error);
      res.status(500).json({ message: "Failed to fetch school attributes" });
    }
  });

  app.get("/api/sitespecific/btu/school-attributes/:id", requireAuth, componentMiddleware, async (req, res) => {
    try {
      const tableExists = await schoolAttributesStorage.tableExists();
      if (!tableExists) {
        return res.status(503).json({ message: "BTU School Attributes table does not exist." });
      }
      const record = await schoolAttributesStorage.get(req.params.id);
      if (!record) {
        return res.status(404).json({ message: "School attributes not found" });
      }
      res.json(record);
    } catch (error) {
      console.error("Failed to fetch BTU school attributes:", error);
      res.status(500).json({ message: "Failed to fetch school attributes" });
    }
  });

  app.get("/api/sitespecific/btu/school-attributes/employer/:employerId", requireAuth, componentMiddleware, async (req, res) => {
    try {
      const tableExists = await schoolAttributesStorage.tableExists();
      if (!tableExists) {
        return res.status(503).json({ message: "BTU School Attributes table does not exist." });
      }
      const record = await schoolAttributesStorage.getByEmployerId(req.params.employerId);
      res.json(record || null);
    } catch (error) {
      console.error("Failed to fetch BTU school attributes by employer:", error);
      res.status(500).json({ message: "Failed to fetch school attributes" });
    }
  });

  app.post("/api/sitespecific/btu/school-attributes", requireAuth, requirePermission("admin"), componentMiddleware, async (req, res) => {
    try {
      const tableExists = await schoolAttributesStorage.tableExists();
      if (!tableExists) {
        return res.status(503).json({ message: "BTU School Attributes table does not exist." });
      }
      const parsed = insertBtuSchoolAttributesSchema.parse(req.body);
      const record = await schoolAttributesStorage.create(parsed);
      res.status(201).json(record);
    } catch (error: any) {
      if (error.name === "ZodError") {
        return res.status(400).json({ message: "Invalid data", errors: error.errors });
      }
      if (error.code === "23505") {
        return res.status(409).json({ message: "School attributes already exist for this employer" });
      }
      console.error("Failed to create BTU school attributes:", error);
      res.status(500).json({ message: "Failed to create school attributes" });
    }
  });

  app.patch("/api/sitespecific/btu/school-attributes/:id", requireAuth, requirePermission("admin"), componentMiddleware, async (req, res) => {
    try {
      const tableExists = await schoolAttributesStorage.tableExists();
      if (!tableExists) {
        return res.status(503).json({ message: "BTU School Attributes table does not exist." });
      }
      const parsed = insertBtuSchoolAttributesSchema.partial().parse(req.body);
      const record = await schoolAttributesStorage.update(req.params.id, parsed);
      if (!record) {
        return res.status(404).json({ message: "School attributes not found" });
      }
      res.json(record);
    } catch (error: any) {
      if (error.name === "ZodError") {
        return res.status(400).json({ message: "Invalid data", errors: error.errors });
      }
      console.error("Failed to update BTU school attributes:", error);
      res.status(500).json({ message: "Failed to update school attributes" });
    }
  });

  app.delete("/api/sitespecific/btu/school-attributes/:id", requireAuth, requirePermission("admin"), componentMiddleware, async (req, res) => {
    try {
      const tableExists = await schoolAttributesStorage.tableExists();
      if (!tableExists) {
        return res.status(503).json({ message: "BTU School Attributes table does not exist." });
      }
      const deleted = await schoolAttributesStorage.delete(req.params.id);
      if (!deleted) {
        return res.status(404).json({ message: "School attributes not found" });
      }
      res.status(204).send();
    } catch (error) {
      console.error("Failed to delete BTU school attributes:", error);
      res.status(500).json({ message: "Failed to delete school attributes" });
    }
  });
}
