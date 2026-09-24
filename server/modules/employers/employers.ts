import type { Express, Request, Response, NextFunction } from "express";
import { storage } from "../../storage";
import { type InsertEmployer } from "@shared/schema";
import { getEffectiveUser } from "../masquerade";
import { isComponentEnabled } from "../components";
import { createUnifiedOptionsStorage } from "../../storage/unified-options";

type AuthMiddleware = (req: Request, res: Response, next: NextFunction) => void | Promise<any>;
type PermissionMiddleware = (permissionKey: string) => (req: Request, res: Response, next: NextFunction) => void | Promise<any>;
type AccessMiddleware = (policy: string, getEntityId?: (req: Request) => string | undefined) => (req: Request, res: Response, next: NextFunction) => void | Promise<any>;

/**
 * Fetch employerId -> { companyId, companyName } when the employer.company
 * component is enabled; returns null when disabled or when company tables
 * are absent (component never migrated in this environment).
 */
export async function getCompanyMapIfEnabled(): Promise<Map<string, { companyId: string; companyName: string }> | null> {
  const companyEnabled = await isComponentEnabled("employer.company");
  if (!companyEnabled) return null;
  try {
    return await storage.employerCompanies.getAllWithCompanyName();
  } catch (enrichError: any) {
    const isTableMissing = enrichError?.message?.includes('relation') && enrichError?.message?.includes('does not exist');
    if (!isTableMissing) {
      console.error("Error enriching employers with company data:", enrichError);
    }
    return null;
  }
}

/**
 * List enrichment for GET /api/employers: batch-loads industries and the full
 * employer policy history, resolves each employer's current policy as-of
 * today, and (when the employer.company component is enabled) joins company
 * name/id. Failures to load auxiliary data degrade to null fields rather than
 * failing the list.
 */
async function enrichEmployersList<T extends { id: string; industryId?: string | null }>(
  employers: T[]
): Promise<Array<T & {
  industryName: string | null;
  currentPolicyId: string | null;
  currentPolicyName: string | null;
  companyId?: string | null;
  companyName?: string | null;
}>> {
  const [industryMap, policyByEmployer, companyMap] = await Promise.all([
    (async () => {
      const map = new Map<string, string>();
      try {
        const industries = await createUnifiedOptionsStorage().list("industry");
        for (const ind of industries) {
          if (ind?.id) map.set(ind.id, ind.name ?? null);
        }
      } catch (error) {
        console.error("Failed to load industries for employer list:", error);
      }
      return map;
    })(),
    (async () => {
      // Resolve each employer's policy as-of today (one row per employer,
      // resolved in the database).
      const map = new Map<string, { policyId: string; policyName: string | null }>();
      try {
        const today = new Date().toISOString().slice(0, 10);
        const rows = await storage.employerPolicyHistory.getCurrentPolicyByEmployer(today);
        for (const row of rows) {
          map.set(row.employerId, { policyId: row.policyId, policyName: row.policyName });
        }
      } catch (error) {
        console.error("Failed to load policy history for employer list:", error);
      }
      return map;
    })(),
    getCompanyMapIfEnabled(),
  ]);

  return employers.map(emp => {
    const policy = policyByEmployer.get(emp.id);
    const companyEntry = companyMap?.get(emp.id);
    return {
      ...emp,
      industryName: (emp.industryId && industryMap.get(emp.industryId)) || null,
      currentPolicyId: policy?.policyId ?? null,
      currentPolicyName: policy?.policyName ?? null,
      ...(companyMap
        ? { companyId: companyEntry?.companyId || null, companyName: companyEntry?.companyName || null }
        : {}),
    };
  });
}

/**
 * Registers /api/my-employers and /api/employers/lookup. Kept separate from
 * registerEmployerRoutes because routes.ts must register these BEFORE its
 * legacy /api/employers/:id route, or Express captures "lookup" as :id.
 */
export function registerEmployerLookupRoutes(
  app: Express,
  requireAuth: AuthMiddleware
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
      
      const companyMap = await getCompanyMapIfEnabled();
      const activeEmployers = employers
        .filter((emp): emp is NonNullable<typeof emp> => emp !== null && emp !== undefined && emp.isActive)
        .map(emp => ({
          id: emp.id,
          name: emp.name,
          companyName: companyMap?.get(emp.id)?.companyName ?? null,
        }));
      
      res.json(activeEmployers);
    } catch (error) {
      console.error("Failed to fetch user employers:", error);
      res.status(500).json({ message: "Failed to fetch user employers" });
    }
  });

  app.get("/api/employers/lookup", requireAuth, async (req, res) => {
    try {
      const allEmployers = await storage.employers.getAllEmployers();
      const companyMap = await getCompanyMapIfEnabled();
      const lookup = allEmployers
        .filter(emp => emp.isActive)
        .map(emp => ({
          id: emp.id,
          name: emp.name,
          companyName: companyMap?.get(emp.id)?.companyName ?? null,
        }));
      res.json(lookup);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch employer lookup" });
    }
  });
}

/**
 * Registers /api/employers/counts. Kept separate from registerEmployerRoutes
 * because routes.ts must register it BEFORE its legacy /api/employers/:id
 * route, or Express captures "counts" as :id.
 */
export function registerEmployerCountsRoute(
  app: Express,
  requireAuth: AuthMiddleware,
  requireAccess: AccessMiddleware
) {
  app.get("/api/employers/counts", requireAuth, requireAccess('staff'), async (_req, res) => {
    try {
      const workerCountRows = await storage.workerHours.getDistinctWorkerCountsByEmployer();
      const workerCounts: Record<string, number> = {};
      for (const row of workerCountRows) {
        workerCounts[row.employerId] = row.workerCount;
      }

      const trustBenefitsEnabled = await isComponentEnabled("trust.benefits");
      let benefitCounts: Record<string, Record<string, number>> | undefined;

      if (trustBenefitsEnabled) {
        const benefitCountRows = await storage.trust.wmb.getActiveBenefitWorkerCountsByEmployerLatestPeriod();
        benefitCounts = {};
        for (const row of benefitCountRows) {
          if (!benefitCounts[row.employerId]) benefitCounts[row.employerId] = {};
          benefitCounts[row.employerId][row.benefitId] = row.workerCount;
        }
      }

      res.json({ workerCounts, benefitCounts });
    } catch (error) {
      console.error("Failed to fetch employer counts:", error);
      res.status(500).json({ message: "Failed to fetch employer counts" });
    }
  });
}

export function registerEmployerRoutes(
  app: Express,
  requireAuth: AuthMiddleware,
  requirePermission: PermissionMiddleware,
  requireAccess: AccessMiddleware
) {
  app.get("/api/employers", requireAuth, requireAccess('staff'), async (req, res) => {
    try {
      const includeInactive = req.query.includeInactive === 'true';
      const allEmployers = await storage.employers.getAllEmployers();
      
      const employers = includeInactive 
        ? allEmployers 
        : allEmployers.filter(emp => emp.isActive);

      const enriched = await enrichEmployersList(employers);
      res.json(enriched);
    } catch (error) {
      console.error("Failed to fetch employers:", error);
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
      const { name, isActive = true, typeId, siriusId } = req.body;
      
      if (!name || typeof name !== 'string' || !name.trim()) {
        return res.status(400).json({ message: "Employer name is required" });
      }
      
      if (siriusId !== undefined && siriusId !== null && typeof siriusId !== 'string') {
        return res.status(400).json({ message: "siriusId must be a string" });
      }
      
      const employer = await storage.employers.createEmployer({ 
        name: name.trim(),
        isActive: typeof isActive === 'boolean' ? isActive : true,
        typeId: typeId === null || typeId === "" ? null : (typeId || null),
        siriusId: typeof siriusId === 'string' && siriusId.trim() ? siriusId.trim() : null
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
      const { name, isActive, typeId, industryId, companyId, siriusId, businessCalendarId } = req.body;
      
      const updates: Partial<InsertEmployer> = {};
      
      if (name !== undefined) {
        if (!name || typeof name !== 'string' || !name.trim()) {
          return res.status(400).json({ message: "Employer name cannot be empty" });
        }
        updates.name = name.trim();
      }
      
      if (siriusId !== undefined) {
        if (siriusId !== null && typeof siriusId !== 'string') {
          return res.status(400).json({ message: "siriusId must be a string" });
        }
        updates.siriusId = typeof siriusId === 'string' && siriusId.trim()
          ? siriusId.trim()
          : null;
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

      if (businessCalendarId !== undefined) {
        if (businessCalendarId === null || businessCalendarId === "") {
          updates.businessCalendarId = null;
        } else {
          if (typeof businessCalendarId !== 'string') {
            return res.status(400).json({ message: "businessCalendarId must be a string or null" });
          }
          const calendar = await storage.businessCalendars.get(businessCalendarId);
          if (!calendar) {
            return res.status(400).json({ message: "Business calendar not found" });
          }
          updates.businessCalendarId = businessCalendarId;
        }
      }
      
      if (Object.keys(updates).length === 0 && companyId === undefined && siriusId === undefined) {
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
