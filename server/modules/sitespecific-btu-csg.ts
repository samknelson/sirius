import type { Express, Request, Response, NextFunction } from "express";
import { requireAccess } from "../services/access-policy-evaluator";
import { requireComponent } from "./components";
import { storage } from "../storage";
import type { InsertBtuCsgRecord } from "../storage/sitespecific-btu-csg";
import type { InsertBtuEmployerMap } from "../storage/sitespecific-btu-employer-map";
import { insertBtuEmployerMapSchema } from "../../shared/schema/sitespecific/btu/schema";
import { z } from "zod";
import { getEffectiveUser } from "./masquerade";

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
  const btuCsgStorage = storage.btuCsg;
  const componentMiddleware = requireComponent("sitespecific.btu");

  app.get("/api/sitespecific/btu/csg", requireAuth, componentMiddleware, async (req, res) => {
    try {
      const tableExists = await btuCsgStorage.tableExists();
      if (!tableExists) {
        return res.status(503).json({ 
          message: "BTU CSG table does not exist. Please enable the BTU component first." 
        });
      }
      const records = await btuCsgStorage.getAll();
      res.json(records);
    } catch (error) {
      console.error("Failed to fetch BTU CSG records:", error);
      res.status(500).json({ message: "Failed to fetch records" });
    }
  });

  app.get("/api/sitespecific/btu/csg/prefill/current-user", requireAuth, componentMiddleware, async (req, res) => {
    try {
      const prefillData: Record<string, string | null> = {
        firstName: null,
        lastName: null,
        phone: null,
        nonBpsEmail: null,
        school: null,
      };

      const user = (req as any).user;
      const externalId = user?.claims?.sub;
      const session = req.session as any;
      const { dbUser } = await getEffectiveUser(session, externalId, user);
      
      if (!dbUser?.email) {
        return res.json(prefillData);
      }

      const contact = await storage.contacts.getContactByEmail(dbUser.email);
      if (contact) {
        prefillData.firstName = contact.given || null;
        prefillData.lastName = contact.family || null;

        const phoneNumbersList = await storage.contacts.phoneNumbers.getPhoneNumbersByContact(contact.id);
        const primaryPhone = phoneNumbersList.find((p: { isPrimary: boolean | null }) => p.isPrimary) || phoneNumbersList[0];
        if (primaryPhone) {
          prefillData.phone = primaryPhone.phoneNumber;
        }
      }

      const worker = await storage.workers.getWorkerByContactEmail(dbUser.email);
      if (worker && worker.denormHomeEmployerId) {
        const employer = await storage.employers.getEmployer(worker.denormHomeEmployerId);
        if (employer) {
          prefillData.school = employer.name;
        }
      }

      res.json(prefillData);
    } catch (error) {
      console.error("Failed to get prefill data:", error);
      res.status(500).json({ message: "Failed to get prefill data" });
    }
  });

  app.get("/api/sitespecific/btu/csg/:id", requireAuth, componentMiddleware, async (req, res) => {
    try {
      const tableExists = await btuCsgStorage.tableExists();
      if (!tableExists) {
        return res.status(503).json({ 
          message: "BTU CSG table does not exist. Please enable the BTU component first." 
        });
      }
      const record = await btuCsgStorage.get(req.params.id);
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
      const tableExists = await btuCsgStorage.tableExists();
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

      const record = await btuCsgStorage.create(parseResult.data as InsertBtuCsgRecord);
      res.status(201).json(record);
    } catch (error) {
      console.error("Failed to create BTU CSG record:", error);
      res.status(500).json({ message: "Failed to create record" });
    }
  });

  app.patch("/api/sitespecific/btu/csg/:id", requireAuth, componentMiddleware, async (req, res) => {
    try {
      const tableExists = await btuCsgStorage.tableExists();
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

      const record = await btuCsgStorage.update(req.params.id, parseResult.data as Partial<InsertBtuCsgRecord>);
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
      const tableExists = await btuCsgStorage.tableExists();
      if (!tableExists) {
        return res.status(503).json({ 
          message: "BTU CSG table does not exist. Please enable the BTU component first." 
        });
      }
      
      const deleted = await btuCsgStorage.delete(req.params.id);
      if (!deleted) {
        return res.status(404).json({ message: "Record not found" });
      }
      res.json({ message: "Record deleted successfully" });
    } catch (error) {
      console.error("Failed to delete BTU CSG record:", error);
      res.status(500).json({ message: "Failed to delete record" });
    }
  });

  // Employer Map routes
  const employerMapStorage = storage.btuEmployerMap;

  app.get("/api/sitespecific/btu/employer-map", requireAuth, componentMiddleware, async (req, res) => {
    try {
      const tableExists = await employerMapStorage.tableExists();
      if (!tableExists) {
        return res.status(503).json({ 
          message: "Employer map table does not exist. Please enable the BTU component first." 
        });
      }
      
      const filters = {
        search: req.query.search as string | undefined,
        departmentId: req.query.departmentId as string | undefined,
        locationId: req.query.locationId as string | undefined,
        employerName: req.query.employerName as string | undefined,
      };
      
      const records = await employerMapStorage.getAll(filters);
      res.json(records);
    } catch (error: any) {
      if (error?.message === "COMPONENT_TABLE_NOT_FOUND") {
        return res.status(503).json({ 
          message: "Employer map table does not exist. Please enable the BTU component first." 
        });
      }
      console.error("Failed to fetch employer map records:", error);
      res.status(500).json({ message: "Failed to fetch records" });
    }
  });

  app.get("/api/sitespecific/btu/employer-map/filters", requireAuth, componentMiddleware, async (req, res) => {
    try {
      const tableExists = await employerMapStorage.tableExists();
      if (!tableExists) {
        return res.status(503).json({ 
          message: "Employer map table does not exist. Please enable the BTU component first." 
        });
      }
      
      const [departments, locations, employerNames] = await Promise.all([
        employerMapStorage.getUniqueDepartments(),
        employerMapStorage.getUniqueLocations(),
        employerMapStorage.getUniqueEmployerNames(),
      ]);
      
      res.json({ departments, locations, employerNames });
    } catch (error: any) {
      if (error?.message === "COMPONENT_TABLE_NOT_FOUND") {
        return res.status(503).json({ 
          message: "Employer map table does not exist. Please enable the BTU component first." 
        });
      }
      console.error("Failed to fetch employer map filter options:", error);
      res.status(500).json({ message: "Failed to fetch filter options" });
    }
  });

  app.get("/api/sitespecific/btu/employer-map/:id", requireAuth, componentMiddleware, async (req, res) => {
    try {
      const tableExists = await employerMapStorage.tableExists();
      if (!tableExists) {
        return res.status(503).json({ 
          message: "Employer map table does not exist. Please enable the BTU component first." 
        });
      }
      const record = await employerMapStorage.get(req.params.id);
      if (!record) {
        return res.status(404).json({ message: "Record not found" });
      }
      res.json(record);
    } catch (error: any) {
      if (error?.message === "COMPONENT_TABLE_NOT_FOUND") {
        return res.status(503).json({ 
          message: "Employer map table does not exist. Please enable the BTU component first." 
        });
      }
      console.error("Failed to fetch employer map record:", error);
      res.status(500).json({ message: "Failed to fetch record" });
    }
  });

  app.post("/api/sitespecific/btu/employer-map", requireAuth, requirePermission("admin"), componentMiddleware, async (req, res) => {
    try {
      const tableExists = await employerMapStorage.tableExists();
      if (!tableExists) {
        return res.status(503).json({ 
          message: "Employer map table does not exist. Please enable the BTU component first." 
        });
      }
      
      const parseResult = insertBtuEmployerMapSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({ 
          message: "Validation failed", 
          errors: parseResult.error.errors 
        });
      }

      const record = await employerMapStorage.create(parseResult.data as InsertBtuEmployerMap);
      res.status(201).json(record);
    } catch (error: any) {
      if (error?.message === "COMPONENT_TABLE_NOT_FOUND") {
        return res.status(503).json({ 
          message: "Employer map table does not exist. Please enable the BTU component first." 
        });
      }
      console.error("Failed to create employer map record:", error);
      res.status(500).json({ message: "Failed to create record" });
    }
  });

  app.patch("/api/sitespecific/btu/employer-map/:id", requireAuth, requirePermission("admin"), componentMiddleware, async (req, res) => {
    try {
      const tableExists = await employerMapStorage.tableExists();
      if (!tableExists) {
        return res.status(503).json({ 
          message: "Employer map table does not exist. Please enable the BTU component first." 
        });
      }
      
      const parseResult = insertBtuEmployerMapSchema.partial().safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({ 
          message: "Validation failed", 
          errors: parseResult.error.errors 
        });
      }

      const record = await employerMapStorage.update(req.params.id, parseResult.data as Partial<InsertBtuEmployerMap>);
      if (!record) {
        return res.status(404).json({ message: "Record not found" });
      }
      res.json(record);
    } catch (error: any) {
      if (error?.message === "COMPONENT_TABLE_NOT_FOUND") {
        return res.status(503).json({ 
          message: "Employer map table does not exist. Please enable the BTU component first." 
        });
      }
      console.error("Failed to update employer map record:", error);
      res.status(500).json({ message: "Failed to update record" });
    }
  });

  app.delete("/api/sitespecific/btu/employer-map/:id", requireAuth, requirePermission("admin"), componentMiddleware, async (req, res) => {
    try {
      const tableExists = await employerMapStorage.tableExists();
      if (!tableExists) {
        return res.status(503).json({ 
          message: "Employer map table does not exist. Please enable the BTU component first." 
        });
      }
      
      const deleted = await employerMapStorage.delete(req.params.id);
      if (!deleted) {
        return res.status(404).json({ message: "Record not found" });
      }
      res.json({ message: "Record deleted successfully" });
    } catch (error: any) {
      if (error?.message === "COMPONENT_TABLE_NOT_FOUND") {
        return res.status(503).json({ 
          message: "Employer map table does not exist. Please enable the BTU component first." 
        });
      }
      console.error("Failed to delete employer map record:", error);
      res.status(500).json({ message: "Failed to delete record" });
    }
  });
}
