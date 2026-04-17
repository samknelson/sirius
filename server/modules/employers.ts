import type { Express, Request, Response, NextFunction } from "express";
import { storage } from "../storage";
import { type InsertEmployer } from "@shared/schema";
import { getEffectiveUser } from "./masquerade";
import { isComponentEnabled } from "./components";

type AuthMiddleware = (req: Request, res: Response, next: NextFunction) => void | Promise<any>;
type PermissionMiddleware = (permissionKey: string) => (req: Request, res: Response, next: NextFunction) => void | Promise<any>;
type AccessMiddleware = (policy: string, getEntityId?: (req: Request) => string | undefined) => (req: Request, res: Response, next: NextFunction) => void | Promise<any>;

export function registerEmployerRoutes(
  app: Express,
  requireAuth: AuthMiddleware,
  requirePermission: PermissionMiddleware,
  requireAccess: AccessMiddleware
) {
  app.get("/api/my-employers", requireAuth, async (req, res) => {
    try {
      const user = (req as any).user;
      const session = req.session as any;
      const { dbUser } = await getEffectiveUser(session, user);
      
      if (!dbUser?.email) {
        res.json([]);
        return;
      }
      
      const contact = await storage.contacts?.getContactByEmail?.(dbUser.email);
      if (!contact) {
        res.json([]);
        return;
      }
      
      const employerContactRecords = await storage.employerContacts.listByContactId(contact.id);
      
      const employerIds = Array.from(new Set(employerContactRecords.map(ec => ec.employerId)));
      
      const employers = await Promise.all(
        employerIds.map(id => storage.employers.getEmployer(id))
      );
      
      const activeEmployers = employers
        .filter((emp): emp is NonNullable<typeof emp> => emp !== null && emp !== undefined && emp.isActive)
        .map(emp => ({ id: emp.id, name: emp.name }));
      
      res.json(activeEmployers);
    } catch (error) {
      console.error("Failed to fetch user employers:", error);
      res.status(500).json({ message: "Failed to fetch user employers" });
    }
  });

  app.get("/api/employers/lookup", requireAuth, async (req, res) => {
    try {
      const allEmployers = await storage.employers.getAllEmployers();
      const lookup = allEmployers
        .filter(emp => emp.isActive)
        .map(emp => ({ id: emp.id, name: emp.name }));
      res.json(lookup);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch employer lookup" });
    }
  });

  app.get("/api/employers", requireAuth, requireAccess('staff'), async (req, res) => {
    try {
      const includeInactive = req.query.includeInactive === 'true';
      const allEmployers = await storage.employers.getAllEmployers();
      
      const employers = includeInactive 
        ? allEmployers 
        : allEmployers.filter(emp => emp.isActive);

      const companyEnabled = await isComponentEnabled("employer.company");
      if (companyEnabled) {
        try {
          const companyMap = await storage.employerCompanies.getAllWithCompanyName();
          const enriched = employers.map(emp => {
            const entry = companyMap.get(emp.id);
            return {
              ...emp,
              companyId: entry?.companyId || null,
              companyName: entry?.companyName || null,
            };
          });
          return res.json(enriched);
        } catch (enrichError: any) {
          const isTableMissing = enrichError?.message?.includes('relation') && enrichError?.message?.includes('does not exist');
          if (!isTableMissing) {
            console.error("Error enriching employers with company data:", enrichError);
          }
          return res.json(employers);
        }
      }
      
      res.json(employers);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch employers" });
    }
  });

  app.get("/api/employers/:id", requireAuth, requireAccess('employer.view', (req) => req.params.id), async (req, res) => {
    try {
      const { id } = req.params;
      const employer = await storage.employers.getEmployer(id);
      
      if (!employer) {
        res.status(404).json({ message: "Employer not found" });
        return;
      }
      
      res.json(employer);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch employer" });
    }
  });

  app.get("/api/employers/:employerId/workers", requireAuth, requireAccess('employer.view', (req) => req.params.employerId), async (req, res) => {
    try {
      const { employerId } = req.params;
      
      const employer = await storage.employers.getEmployer(employerId);
      if (!employer) {
        res.status(404).json({ message: "Employer not found" });
        return;
      }
      
      const workers = await storage.employers.getEmployerWorkers(employerId);
      res.json(workers);
    } catch (error) {
      console.error("Failed to fetch employer workers:", error);
      res.status(500).json({ message: "Failed to fetch employer workers" });
    }
  });

  app.post("/api/employers", requireAuth, requirePermission("staff"), async (req, res) => {
    try {
      const { name, isActive = true, typeId } = req.body;
      
      if (!name || typeof name !== 'string' || !name.trim()) {
        return res.status(400).json({ message: "Employer name is required" });
      }
      
      const employer = await storage.employers.createEmployer({ 
        name: name.trim(),
        isActive: typeof isActive === 'boolean' ? isActive : true,
        typeId: typeId === null || typeId === "" ? null : (typeId || null)
      });
      
      res.status(201).json(employer);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to create employer" });
    }
  });

  app.get("/api/employers/:id/company", requireAuth, requirePermission("staff"), async (req, res) => {
    try {
      const companyEnabled = await isComponentEnabled("employer.company");
      if (!companyEnabled) {
        return res.status(403).json({ message: "employer.company component is not enabled" });
      }
      const { id } = req.params;
      const ec = await storage.employerCompanies.getByEmployerId(id);
      if (!ec) {
        return res.json({ companyId: null, companyName: null });
      }
      const company = await storage.companies.get(ec.companyId);
      res.json({ companyId: ec.companyId, companyName: company?.name || null, employerCompanyId: ec.id });
    } catch (error) {
      console.error("Error fetching employer company:", error);
      res.status(500).json({ message: "Failed to fetch employer company" });
    }
  });

  app.put("/api/employers/:id", requireAuth, requirePermission("staff"), async (req, res) => {
    try {
      const { id } = req.params;
      const { name, isActive, typeId, industryId, companyId } = req.body;
      
      const updates: Partial<InsertEmployer> = {};
      
      if (name !== undefined) {
        if (!name || typeof name !== 'string' || !name.trim()) {
          return res.status(400).json({ message: "Employer name cannot be empty" });
        }
        updates.name = name.trim();
      }
      
      if (isActive !== undefined) {
        if (typeof isActive !== 'boolean') {
          return res.status(400).json({ message: "isActive must be a boolean" });
        }
        updates.isActive = isActive;
      }
      
      if (typeId !== undefined) {
        updates.typeId = typeId === null || typeId === "" ? null : typeId;
      }
      
      if (industryId !== undefined) {
        updates.industryId = industryId === null || industryId === "" ? null : industryId;
      }
      
      if (Object.keys(updates).length === 0 && companyId === undefined) {
        return res.status(400).json({ message: "No fields to update" });
      }
      
      let employer = null;
      if (Object.keys(updates).length > 0) {
        employer = await storage.employers.updateEmployer(id, updates);
        if (!employer) {
          res.status(404).json({ message: "Employer not found" });
          return;
        }
      } else {
        employer = await storage.employers.getEmployer(id);
        if (!employer) {
          res.status(404).json({ message: "Employer not found" });
          return;
        }
      }

      if (companyId !== undefined) {
        const companyEnabled = await isComponentEnabled("employer.company");
        if (companyEnabled) {
          const existing = await storage.employerCompanies.getByEmployerId(id);
          if (existing) {
            await storage.employerCompanies.delete(existing.id);
          }
          if (companyId !== null && companyId !== "") {
            await storage.employerCompanies.create({ employerId: id, companyId });
          }
        }
      }
      
      res.json(employer);
    } catch (error) {
      console.error("Error updating employer:", error);
      res.status(500).json({ message: "Failed to update employer" });
    }
  });

  app.delete("/api/employers/:id", requireAuth, requirePermission("staff"), async (req, res) => {
    try {
      const { id } = req.params;
      const deleted = await storage.employers.deleteEmployer(id);
      
      if (!deleted) {
        res.status(404).json({ message: "Employer not found" });
        return;
      }
      
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Failed to delete employer" });
    }
  });
}
