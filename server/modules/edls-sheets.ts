import type { Express } from "express";
import { storage } from "../storage";
import { insertEdlsSheetsSchema, insertEdlsCrewsSchema, type InsertEdlsCrew } from "@shared/schema";
import { requireAccess } from "../services/access-policy-evaluator";
import { requireComponent } from "./components";
import { z } from "zod";
import { getSupervisorContext, validateSupervisorForSave, getEdlsSettings } from "./edls-supervisor-context";
import { getEffectiveUser } from "./masquerade";

const crewInputSchema = insertEdlsCrewsSchema.omit({ sheetId: true });

const sheetWithCrewsSchema = insertEdlsSheetsSchema.omit({ employerId: true }).extend({
  crews: z.array(crewInputSchema).min(1, "At least one crew is required"),
});

export function registerEdlsSheetsRoutes(
  app: Express,
  requireAuth: any,
  requirePermission: any
) {
  const edlsComponent = requireComponent("edls");

  app.get("/api/edls/sheets", requireAuth, edlsComponent, requireAccess('edls.any'), async (req, res) => {
    try {
      const { 
        employerId, 
        page: pageParam,
        limit: limitParam,
        dateFrom,
        dateTo,
        status
      } = req.query;
      
      const page = parseInt(pageParam as string) || 0;
      const limit = Math.min(parseInt(limitParam as string) || 100, 100);
      
      const result = await storage.edlsSheets.getPaginated(
        page, 
        limit, 
        {
          employerId: employerId as string | undefined,
          dateFrom: dateFrom as string | undefined,
          dateTo: dateTo as string | undefined,
          status: status as string | undefined,
        }
      );
      res.json(result);
    } catch (error) {
      console.error("Failed to fetch EDLS sheets:", error);
      res.status(500).json({ message: "Failed to fetch sheets" });
    }
  });

  app.get("/api/edls/sheets/:id", requireAuth, edlsComponent, requireAccess('edls.sheet.view', req => req.params.id), async (req, res) => {
    try {
      const { id } = req.params;
      const sheet = await storage.edlsSheets.getWithRelations(id);
      
      if (!sheet) {
        res.status(404).json({ message: "Sheet not found" });
        return;
      }
      
      const crews = await storage.edlsCrews.getBySheetId(id);
      
      res.json({ ...sheet, crews });
    } catch (error) {
      console.error("Failed to fetch EDLS sheet:", error);
      res.status(500).json({ message: "Failed to fetch sheet" });
    }
  });

  app.get("/api/edls/sheets/:id/available-workers", requireAuth, edlsComponent, requireAccess('edls.sheet.view', req => req.params.id), async (req, res) => {
    try {
      const { id } = req.params;
      const sheet = await storage.edlsSheets.get(id);
      
      if (!sheet) {
        res.status(404).json({ message: "Sheet not found" });
        return;
      }
      
      // Exclude workers already assigned to crews on this sheet
      const workers = await storage.workers.getWorkersByHomeEmployerId(
        sheet.employerId,
        { excludeAssignedToSheetId: id }
      );
      res.json(workers);
    } catch (error) {
      console.error("Failed to fetch available workers:", error);
      res.status(500).json({ message: "Failed to fetch available workers" });
    }
  });

  app.get("/api/edls/supervisor-context", requireAuth, edlsComponent, async (req, res) => {
    try {
      const user = (req as any).user;
      const session = req.session as any;
      const { dbUser } = await getEffectiveUser(session, user);
      
      if (!dbUser) {
        res.status(401).json({ message: "User not found" });
        return;
      }
      
      const sheetId = req.query.sheetId as string | undefined;
      const context = await getSupervisorContext(dbUser.id, sheetId);
      
      res.json(context);
    } catch (error) {
      console.error("Failed to fetch supervisor context:", error);
      res.status(500).json({ message: "Failed to fetch supervisor context" });
    }
  });

  app.post("/api/edls/sheets", requireAuth, edlsComponent, requireAccess('edls.sheet.create'), async (req, res) => {
    try {
      const user = (req as any).user;
      const session = req.session as any;
      const { dbUser } = await getEffectiveUser(session, user);
      
      if (!dbUser) {
        res.status(401).json({ message: "User not found" });
        return;
      }
      
      const edlsSettings = await getEdlsSettings();
      if (!edlsSettings.employer) {
        res.status(400).json({ message: "No employer configured in EDLS settings. Please configure an employer in EDLS Settings before creating sheets." });
        return;
      }
      
      const employer = await storage.employers.getEmployer(edlsSettings.employer);
      if (!employer) {
        res.status(400).json({ message: "Configured employer not found. Please update EDLS Settings with a valid employer." });
        return;
      }
      
      const parsed = sheetWithCrewsSchema.safeParse(req.body);
      
      if (!parsed.success) {
        res.status(400).json({ message: "Invalid request body", errors: parsed.error.flatten() });
        return;
      }
      
      const { crews, ...sheetData } = parsed.data;
      
      const supervisorContext = await getSupervisorContext(dbUser.id);
      const supervisorValidation = validateSupervisorForSave(
        supervisorContext,
        sheetData.supervisor || null,
        dbUser.id
      );
      
      if (!supervisorValidation.valid) {
        res.status(403).json({ message: supervisorValidation.error });
        return;
      }
      
      const finalSheetData = {
        ...sheetData,
        employerId: edlsSettings.employer,
        supervisor: supervisorValidation.supervisorId,
        assignee: sheetData.assignee || supervisorValidation.supervisorId,
      };
      
      const crewsTotalWorkerCount = crews.reduce((sum, crew) => sum + crew.workerCount, 0);
      if (crewsTotalWorkerCount !== finalSheetData.workerCount) {
        res.status(400).json({ 
          message: `Crew worker counts (${crewsTotalWorkerCount}) must equal sheet worker count (${finalSheetData.workerCount})` 
        });
        return;
      }
      
      const finalCrews = crews.map(crew => {
        if (supervisorContext.canManage) {
          const crewSupervisor = crew.supervisor && supervisorContext.options.some(opt => opt.id === crew.supervisor)
            ? crew.supervisor
            : supervisorValidation.supervisorId;
          return { ...crew, supervisor: crewSupervisor };
        }
        return { ...crew, supervisor: supervisorValidation.supervisorId };
      });
      
      const result = await storage.edlsSheets.create(finalSheetData, finalCrews);
      
      res.status(201).json(result);
    } catch (error) {
      console.error("Failed to create EDLS sheet:", error);
      res.status(500).json({ message: "Failed to create sheet" });
    }
  });

  app.put("/api/edls/sheets/:id", requireAuth, edlsComponent, requireAccess('edls.sheet.edit', req => req.params.id), async (req, res) => {
    try {
      const { id } = req.params;
      
      const user = (req as any).user;
      const session = req.session as any;
      const { dbUser } = await getEffectiveUser(session, user);
      
      if (!dbUser) {
        res.status(401).json({ message: "User not found" });
        return;
      }
      
      const edlsSettings = await getEdlsSettings();
      if (!edlsSettings.employer) {
        res.status(400).json({ message: "No employer configured in EDLS settings. Please configure an employer in EDLS Settings before saving sheets." });
        return;
      }
      
      const configuredEmployer = await storage.employers.getEmployer(edlsSettings.employer);
      if (!configuredEmployer) {
        res.status(400).json({ message: "Configured employer not found. Please update EDLS Settings with a valid employer." });
        return;
      }
      
      const existingSheet = await storage.edlsSheets.get(id);
      if (!existingSheet) {
        res.status(404).json({ message: "Sheet not found" });
        return;
      }
      
      const updateSchema = sheetWithCrewsSchema.partial().extend({
        crews: z.array(crewInputSchema.extend({ id: z.string().optional() })).optional(),
      });
      const parsed = updateSchema.safeParse(req.body);
      
      if (!parsed.success) {
        res.status(400).json({ message: "Invalid request body", errors: parsed.error.flatten() });
        return;
      }
      
      const { crews, ...parsedSheetData } = parsed.data;
      
      const sheetData = {
        ...parsedSheetData,
        employerId: edlsSettings.employer,
      };
      
      if (!sheetData.departmentId) {
        sheetData.departmentId = existingSheet.departmentId;
      }
      
      if (sheetData.supervisor !== undefined) {
        const supervisorContext = await getSupervisorContext(dbUser.id, id);
        const supervisorValidation = validateSupervisorForSave(
          supervisorContext,
          sheetData.supervisor || null,
          dbUser.id
        );
        
        if (!supervisorValidation.valid) {
          res.status(403).json({ message: supervisorValidation.error });
          return;
        }
        
        sheetData.supervisor = supervisorValidation.supervisorId;
      }
      
      if (sheetData.assignee === undefined || sheetData.assignee === null || sheetData.assignee === '') {
        const finalSupervisor = sheetData.supervisor ?? existingSheet.supervisor;
        if (finalSupervisor) {
          sheetData.assignee = finalSupervisor;
        }
      }
      
      const finalWorkerCount = sheetData.workerCount ?? existingSheet.workerCount;
      
      if (crews !== undefined) {
        if (crews.length === 0) {
          res.status(400).json({ message: "At least one crew is required" });
          return;
        }
        
        const crewsTotalWorkerCount = crews.reduce((sum, crew) => sum + crew.workerCount, 0);
        if (crewsTotalWorkerCount !== finalWorkerCount) {
          res.status(400).json({ 
            message: `Crew worker counts (${crewsTotalWorkerCount}) must equal sheet worker count (${finalWorkerCount})` 
          });
          return;
        }
        
        const supervisorContext = await getSupervisorContext(dbUser.id, id);
        const finalSheetSupervisor = sheetData.supervisor ?? existingSheet.supervisor;
        
        const finalCrews = crews.map(crew => {
          const { id: crewId, ...crewData } = crew as InsertEdlsCrew & { id?: string };
          if (supervisorContext.canManage) {
            const crewSupervisor = crewData.supervisor && supervisorContext.options.some(opt => opt.id === crewData.supervisor)
              ? crewData.supervisor
              : finalSheetSupervisor;
            return { id: crewId, ...crewData, supervisor: crewSupervisor };
          }
          return { id: crewId, ...crewData, supervisor: finalSheetSupervisor };
        });
        
        const result = await storage.edlsSheets.update(id, sheetData, finalCrews);
        
        res.json(result);
      } else {
        const currentCrewsTotal = await storage.edlsCrews.getCrewsTotalWorkerCount(id);
        if (currentCrewsTotal !== finalWorkerCount) {
          res.status(400).json({ 
            message: `Cannot update worker count to ${finalWorkerCount}. Current crews total ${currentCrewsTotal}. Please update crews to match.` 
          });
          return;
        }
        
        const updatedSheet = await storage.edlsSheets.update(id, sheetData);
        const updatedCrews = await storage.edlsCrews.getBySheetId(id);
        
        res.json({ ...updatedSheet, crews: updatedCrews });
      }
    } catch (error: any) {
      if (error?.name === 'DomainValidationError') {
        const firstError = error.errors?.[0];
        res.status(400).json({ message: firstError?.message || "Validation failed" });
        return;
      }
      console.error("Failed to update EDLS sheet:", error);
      res.status(500).json({ message: "Failed to update sheet" });
    }
  });

  app.delete("/api/edls/sheets/:id", requireAuth, edlsComponent, requireAccess('admin'), async (req, res) => {
    try {
      const { id } = req.params;
      
      const existingSheet = await storage.edlsSheets.get(id);
      if (!existingSheet) {
        res.status(404).json({ message: "Sheet not found" });
        return;
      }
      
      await storage.edlsSheets.delete(id);
      res.status(204).send();
    } catch (error: any) {
      if (error?.name === 'DomainValidationError') {
        const firstError = error.errors?.[0];
        res.status(400).json({ message: firstError?.message || "Validation failed" });
        return;
      }
      console.error("Failed to delete EDLS sheet:", error);
      res.status(500).json({ message: "Failed to delete sheet" });
    }
  });

  app.get("/api/edls/sheets/:sheetId/crews", requireAuth, edlsComponent, requireAccess('edls.sheet.view', req => req.params.sheetId), async (req, res) => {
    try {
      const { sheetId } = req.params;
      
      const sheet = await storage.edlsSheets.get(sheetId);
      if (!sheet) {
        res.status(404).json({ message: "Sheet not found" });
        return;
      }
      
      const crews = await storage.edlsCrews.getBySheetIdWithRelations(sheetId);
      res.json(crews);
    } catch (error) {
      console.error("Failed to fetch crews:", error);
      res.status(500).json({ message: "Failed to fetch crews" });
    }
  });

  app.get("/api/edls/sheets/:sheetId/assignments", requireAuth, edlsComponent, requireAccess('edls.sheet.view', req => req.params.sheetId), async (req, res) => {
    try {
      const { sheetId } = req.params;
      
      const sheet = await storage.edlsSheets.get(sheetId);
      if (!sheet) {
        res.status(404).json({ message: "Sheet not found" });
        return;
      }
      
      const assignments = await storage.edlsAssignments.getBySheetId(sheetId);
      res.json(assignments);
    } catch (error) {
      console.error("Failed to fetch assignments:", error);
      res.status(500).json({ message: "Failed to fetch assignments" });
    }
  });

  const createAssignmentSchema = z.object({
    workerId: z.string().min(1, "Worker ID is required"),
  });

  app.post("/api/edls/sheets/:sheetId/crews/:crewId/assignments", requireAuth, edlsComponent, requireAccess('edls.sheet.edit', req => req.params.sheetId), async (req, res) => {
    try {
      const { sheetId, crewId } = req.params;
      const parsed = createAssignmentSchema.safeParse(req.body);
      
      if (!parsed.success) {
        res.status(400).json({ message: "Invalid request", errors: parsed.error.flatten() });
        return;
      }
      
      const crew = await storage.edlsCrews.get(crewId);
      if (!crew) {
        res.status(404).json({ message: "Crew not found" });
        return;
      }

      if (crew.sheetId !== sheetId) {
        res.status(400).json({ message: "Crew does not belong to this sheet" });
        return;
      }
      
      const sheet = await storage.edlsSheets.get(sheetId);
      if (!sheet) {
        res.status(404).json({ message: "Sheet not found" });
        return;
      }

      const worker = await storage.workers.getWorker(parsed.data.workerId);
      if (!worker) {
        res.status(404).json({ message: "Worker not found" });
        return;
      }

      if (worker.denormHomeEmployerId !== sheet.employerId) {
        res.status(400).json({ message: "Worker is not an employee of this employer" });
        return;
      }
      
      const assignment = await storage.edlsAssignments.create({
        crewId,
        workerId: parsed.data.workerId,
        date: sheet.date as string,
      });
      
      res.status(201).json(assignment);
    } catch (error: any) {
      if (error?.name === 'DomainValidationError') {
        const firstError = error.errors?.[0];
        res.status(400).json({ message: firstError?.message || "Validation failed" });
        return;
      }
      if (error?.code === '23505') {
        res.status(400).json({ message: "Worker is already assigned on this date" });
        return;
      }
      console.error("Failed to create assignment:", error);
      res.status(500).json({ message: "Failed to create assignment" });
    }
  });

  app.delete(
    "/api/edls/sheets/:sheetId/assignments/:assignmentId",
    requireAuth,
    edlsComponent,
    requireAccess('edls.sheet.edit', (req) => req.params.sheetId),
    async (req, res) => {
      try {
        const { sheetId, assignmentId } = req.params;
        
        const sheet = await storage.edlsSheets.get(sheetId);
        if (!sheet) {
          res.status(404).json({ message: "Sheet not found" });
          return;
        }
        
        const assignment = await storage.edlsAssignments.get(assignmentId);
        if (!assignment) {
          res.status(404).json({ message: "Assignment not found" });
          return;
        }
        
        const crew = await storage.edlsCrews.get(assignment.crewId);
        if (!crew || crew.sheetId !== sheetId) {
          res.status(404).json({ message: "Assignment not found on this sheet" });
          return;
        }
        
        await storage.edlsAssignments.delete(assignmentId);
        res.status(204).send();
      } catch (error) {
        console.error("Failed to delete assignment:", error);
        res.status(500).json({ message: "Failed to delete assignment" });
      }
    }
  );

  const setStatusSchema = z.object({
    status: z.enum(["draft", "request", "lock", "trash", "reserved"]),
  });

  const trashLockSchema = z.object({
    trashLock: z.boolean(),
  });

  app.patch(
    "/api/edls/sheets/:id/trash-lock",
    requireAuth,
    edlsComponent,
    requireAccess('edls.sheet.edit', (req) => req.params.id),
    async (req, res) => {
      try {
        const { id } = req.params;
        const parsed = trashLockSchema.safeParse(req.body);
        
        if (!parsed.success) {
          res.status(400).json({ message: "Invalid request", errors: parsed.error.flatten() });
          return;
        }
        
        const existingSheet = await storage.edlsSheets.get(id);
        if (!existingSheet) {
          res.status(404).json({ message: "Sheet not found" });
          return;
        }
        
        const currentData = (existingSheet.data as Record<string, any>) || {};
        const updatedData = { ...currentData, trashLock: parsed.data.trashLock };
        
        const updatedSheet = await storage.edlsSheets.update(id, { data: updatedData });
        res.json(updatedSheet);
      } catch (error) {
        console.error("Failed to update trash lock:", error);
        res.status(500).json({ message: "Failed to update trash lock" });
      }
    }
  );

  app.patch(
    "/api/edls/sheets/:id/status",
    requireAuth,
    edlsComponent,
    requireAccess('edls.sheet.set_status', {
      getEntityId: (req) => req.params.id,
      getEntityData: (req) => ({ targetStatus: req.body.status }),
    }),
    async (req, res) => {
      try {
        const { id } = req.params;
        const parsed = setStatusSchema.safeParse(req.body);
        
        if (!parsed.success) {
          res.status(400).json({ message: "Invalid status", errors: parsed.error.flatten() });
          return;
        }
        
        const existingSheet = await storage.edlsSheets.get(id);
        if (!existingSheet) {
          res.status(404).json({ message: "Sheet not found" });
          return;
        }
        
        const updatedSheet = await storage.edlsSheets.update(id, { status: parsed.data.status });
        res.json(updatedSheet);
      } catch (error) {
        console.error("Failed to update sheet status:", error);
        res.status(500).json({ message: "Failed to update sheet status" });
      }
    }
  );
}
