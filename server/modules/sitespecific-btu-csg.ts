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
      const replitUserId = user?.claims?.sub;
      const session = req.session as any;
      const { dbUser } = await getEffectiveUser(session, replitUserId);
      
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

  app.get("/api/sitespecific/btu/employer-map/system-employers", requireAuth, componentMiddleware, async (req, res) => {
    try {
      const employers = await storage.employers.getAllEmployers();
      const employerNames = employers.map(e => e.name);
      res.json({ employerNames });
    } catch (error: any) {
      console.error("Failed to fetch system employers:", error);
      res.status(500).json({ message: "Failed to fetch system employers" });
    }
  });

  // Get employer suggestions based on location mappings
  // Analyzes existing confirmed mappings to suggest employers for locations
  app.get("/api/sitespecific/btu/employer-map/suggestions", requireAuth, componentMiddleware, async (req, res) => {
    try {
      const tableExists = await employerMapStorage.tableExists();
      if (!tableExists) {
        return res.status(503).json({ 
          message: "Employer map table does not exist. Please enable the BTU component first." 
        });
      }
      
      // Get all mapping records
      const allRecords = await employerMapStorage.getAll();
      
      // Get all system employers for validation
      const employers = await storage.employers.getAllEmployers();
      const systemEmployerNames = new Set(employers.map(e => e.name));
      
      // Build location → employer mapping from confirmed records (where employer exists)
      const locationToEmployers: Map<string, Map<string, number>> = new Map();
      
      for (const record of allRecords) {
        // Only learn from records where the employer actually exists in the system
        if (record.locationId && record.employerName && systemEmployerNames.has(record.employerName)) {
          if (!locationToEmployers.has(record.locationId)) {
            locationToEmployers.set(record.locationId, new Map());
          }
          const employerCounts = locationToEmployers.get(record.locationId)!;
          employerCounts.set(record.employerName, (employerCounts.get(record.employerName) || 0) + 1);
        }
      }
      
      // Also try matching by location title (normalized)
      const locationTitleToEmployers: Map<string, Map<string, number>> = new Map();
      
      for (const record of allRecords) {
        if (record.locationTitle && record.employerName && systemEmployerNames.has(record.employerName)) {
          const normalizedTitle = record.locationTitle.toLowerCase().trim();
          if (!locationTitleToEmployers.has(normalizedTitle)) {
            locationTitleToEmployers.set(normalizedTitle, new Map());
          }
          const employerCounts = locationTitleToEmployers.get(normalizedTitle)!;
          employerCounts.set(record.employerName, (employerCounts.get(record.employerName) || 0) + 1);
        }
      }
      
      // Build suggestions for each unique location
      const suggestions: Record<string, { primary: string | null; alternates: string[] }> = {};
      
      // Get unique locationIds from all records
      const uniqueLocationIds = Array.from(new Set(allRecords.map(r => r.locationId).filter(Boolean) as string[]));
      
      for (const locationId of uniqueLocationIds) {
        const employerCounts = locationToEmployers.get(locationId);
        if (employerCounts && employerCounts.size > 0) {
          // Sort by count descending
          const sorted = Array.from(employerCounts.entries()).sort((a: [string, number], b: [string, number]) => b[1] - a[1]);
          suggestions[locationId] = {
            primary: sorted[0][0],
            alternates: sorted.slice(1, 4).map((entry: [string, number]) => entry[0])
          };
        }
      }
      
      // Also build suggestions by location title for fallback
      const titleSuggestions: Record<string, { primary: string | null; alternates: string[] }> = {};
      
      const titleEntries = Array.from(locationTitleToEmployers.entries());
      for (const [normalizedTitle, employerCounts] of titleEntries) {
        if (employerCounts.size > 0) {
          const sorted = Array.from(employerCounts.entries()).sort((a: [string, number], b: [string, number]) => b[1] - a[1]);
          titleSuggestions[normalizedTitle] = {
            primary: sorted[0][0],
            alternates: sorted.slice(1, 4).map((entry: [string, number]) => entry[0])
          };
        }
      }
      
      res.json({ 
        byLocationId: suggestions,
        byLocationTitle: titleSuggestions
      });
    } catch (error: any) {
      console.error("Failed to get employer suggestions:", error);
      res.status(500).json({ message: "Failed to get employer suggestions" });
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

  // Bulk import endpoint for CSV data
  const csvImportSchema = z.object({
    records: z.array(z.object({
      departmentId: z.string().nullable().optional(),
      departmentTitle: z.string().nullable().optional(),
      locationId: z.string().nullable().optional(),
      locationTitle: z.string().nullable().optional(),
      jobCode: z.string().nullable().optional(),
      jobTitle: z.string().nullable().optional(),
      employerName: z.string().nullable().optional(),
      secondaryEmployerName: z.string().nullable().optional(),
      bargainingUnitName: z.string().nullable().optional(),
    })),
    clearExisting: z.boolean().optional().default(false),
  });

  app.post("/api/sitespecific/btu/employer-map/import", requireAuth, requirePermission("admin"), componentMiddleware, async (req, res) => {
    try {
      const tableExists = await employerMapStorage.tableExists();
      if (!tableExists) {
        return res.status(503).json({ 
          message: "Employer map table does not exist. Please enable the BTU component first." 
        });
      }
      
      const parseResult = csvImportSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({ 
          message: "Validation failed", 
          errors: parseResult.error.errors 
        });
      }

      const { records: csvRecords, clearExisting } = parseResult.data;
      
      // Fetch bargaining units for name-to-ID mapping
      const bargainingUnits = await storage.bargainingUnits.getAllBargainingUnits();
      
      // Log available bargaining units for debugging
      console.log("Available bargaining units for mapping:", bargainingUnits.map((bu: any) => ({ id: bu.id, name: bu.name, siriusId: bu.siriusId })));
      
      // Track unmatched names for debugging
      const unmatchedNames = new Set<string>();
      
      // Create name-to-ID mapping (case-insensitive, supports code and name matching)
      const mapBargainingUnitNameToId = (name: string | null | undefined): string | null => {
        if (!name || name.trim() === "" || name.toUpperCase() === "NO CHANGE") {
          return null;
        }
        
        // Normalize: lowercase, trim, and remove extra whitespace
        const normalizedName = name.toLowerCase().trim().replace(/\s+/g, ' ');
        
        // Try exact match by name first
        const exactMatch = bargainingUnits.find(
          (bu: { id: string; name: string; siriusId?: string }) => 
            bu.name.toLowerCase().trim() === normalizedName
        );
        if (exactMatch) {
          console.log(`Matched "${name}" to "${exactMatch.name}" (exact match)`);
          return exactMatch.id;
        }
        
        // Try match by sirius_id/code (e.g., "BT1", "BT2")
        const codeMatch = bargainingUnits.find(
          (bu: { id: string; name: string; siriusId?: string }) => 
            bu.siriusId?.toLowerCase() === normalizedName
        );
        if (codeMatch) {
          console.log(`Matched "${name}" to "${codeMatch.name}" (code match)`);
          return codeMatch.id;
        }
        
        // Try partial/fuzzy match - look for bargaining units that contain the key part of the name
        for (const unit of bargainingUnits) {
          const unitNameLower = unit.name.toLowerCase().trim();
          // Check if CSV name contains the unit name or vice versa
          if (normalizedName.includes(unitNameLower) || unitNameLower.includes(normalizedName)) {
            console.log(`Matched "${name}" to "${unit.name}" (contains match)`);
            return unit.id;
          }
        }
        
        // Try matching by significant words (excluding common words like "unit")
        const commonWords = ['unit', 'the', 'a', 'an'];
        const words = normalizedName.split(/\s+/).filter((w: string) => !commonWords.includes(w) && w.length > 2);
        for (const unit of bargainingUnits) {
          const unitWords = unit.name.toLowerCase().split(/\s+/).filter((w: string) => !commonWords.includes(w) && w.length > 2);
          // Check if any significant word matches
          const matchingWords = words.filter((w: string) => 
            unitWords.some((uw: string) => uw === w || uw.includes(w) || w.includes(uw))
          );
          if (matchingWords.length > 0) {
            console.log(`Matched "${name}" to "${unit.name}" (word match: ${matchingWords.join(', ')})`);
            return unit.id;
          }
        }
        
        // No match found
        unmatchedNames.add(name);
        console.log(`No match found for bargaining unit: "${name}"`);
        return null;
      };

      // Clear existing records if requested
      if (clearExisting) {
        await employerMapStorage.deleteAll();
      }

      // Process and insert records
      let successCount = 0;
      let errorCount = 0;
      const errors: Array<{ row: number; error: string }> = [];

      for (let i = 0; i < csvRecords.length; i++) {
        const csvRecord = csvRecords[i];
        try {
          const insertData: InsertBtuEmployerMap = {
            departmentId: csvRecord.departmentId || null,
            departmentTitle: csvRecord.departmentTitle || null,
            locationId: csvRecord.locationId || null,
            locationTitle: csvRecord.locationTitle || null,
            jobCode: csvRecord.jobCode || null,
            jobTitle: csvRecord.jobTitle || null,
            employerName: csvRecord.employerName || null,
            secondaryEmployerName: csvRecord.secondaryEmployerName || null,
            bargainingUnitId: mapBargainingUnitNameToId(csvRecord.bargainingUnitName),
          };
          
          await employerMapStorage.create(insertData);
          successCount++;
        } catch (err: any) {
          errorCount++;
          errors.push({ row: i + 2, error: err.message || "Unknown error" }); // +2 for header and 0-based index
        }
      }

      res.json({
        success: true,
        imported: successCount,
        failed: errorCount,
        total: csvRecords.length,
        errors: errors.slice(0, 10), // Return first 10 errors only
        unmatchedBargainingUnits: Array.from(unmatchedNames).slice(0, 20), // Show unmatched BU names for debugging
      });
    } catch (error: any) {
      if (error?.message === "COMPONENT_TABLE_NOT_FOUND") {
        return res.status(503).json({ 
          message: "Employer map table does not exist. Please enable the BTU component first." 
        });
      }
      console.error("Failed to import employer map records:", error);
      res.status(500).json({ message: "Failed to import records" });
    }
  });
}
