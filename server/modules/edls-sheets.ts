import type { Express } from "express";
import { storage } from "../storage";
import { db } from "../db";
import { edlsSheets, edlsCrews, insertEdlsSheetsSchema, insertEdlsCrewsSchema, type InsertEdlsCrew } from "@shared/schema";
import { requireAccess } from "../services/access-policy-evaluator";
import { requireComponent } from "./components";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getSupervisorContext, validateSupervisorForSave } from "./edls-supervisor-context";
import { getEffectiveUser } from "./masquerade";

const crewInputSchema = insertEdlsCrewsSchema.omit({ sheetId: true });

const sheetWithCrewsSchema = insertEdlsSheetsSchema.extend({
  crews: z.array(crewInputSchema).min(1, "At least one crew is required"),
});

export function registerEdlsSheetsRoutes(
  app: Express,
  requireAuth: any,
  requirePermission: any
) {
  const edlsComponent = requireComponent("edls");

  app.get("/api/edls/sheets", requireAuth, edlsComponent, requireAccess('staff'), async (req, res) => {
    try {
      const { 
        employerId, 
        page: pageParam,
        limit: limitParam 
      } = req.query;
      
      const page = parseInt(pageParam as string) || 0;
      const limit = Math.min(parseInt(limitParam as string) || 100, 100);
      
      const result = await storage.edlsSheets.getPaginated(
        page, 
        limit, 
        employerId as string | undefined
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

  app.get("/api/edls/supervisor-context", requireAuth, edlsComponent, async (req, res) => {
    try {
      const user = (req as any).user;
      const replitUserId = user?.claims?.sub;
      const session = req.session as any;
      const { dbUser } = await getEffectiveUser(session, replitUserId);
      
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

  app.post("/api/edls/sheets", requireAuth, edlsComponent, requireAccess('staff'), async (req, res) => {
    try {
      const user = (req as any).user;
      const replitUserId = user?.claims?.sub;
      const session = req.session as any;
      const { dbUser } = await getEffectiveUser(session, replitUserId);
      
      if (!dbUser) {
        res.status(401).json({ message: "User not found" });
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
        supervisor: supervisorValidation.supervisorId,
      };
      
      const employer = await storage.employers.getEmployer(finalSheetData.employerId);
      if (!employer) {
        res.status(400).json({ message: "Employer not found" });
        return;
      }
      
      const crewsTotalWorkerCount = crews.reduce((sum, crew) => sum + crew.workerCount, 0);
      if (crewsTotalWorkerCount !== finalSheetData.workerCount) {
        res.status(400).json({ 
          message: `Crew worker counts (${crewsTotalWorkerCount}) must equal sheet worker count (${finalSheetData.workerCount})` 
        });
        return;
      }
      
      const result = await db.transaction(async (tx) => {
        const [sheet] = await tx.insert(edlsSheets).values(finalSheetData).returning();
        
        const createdCrews = await Promise.all(
          crews.map(crew => 
            tx.insert(edlsCrews).values({ ...crew, sheetId: sheet.id }).returning()
          )
        );
        
        return { ...sheet, crews: createdCrews.map(c => c[0]) };
      });
      
      res.status(201).json(result);
    } catch (error) {
      console.error("Failed to create EDLS sheet:", error);
      res.status(500).json({ message: "Failed to create sheet" });
    }
  });

  app.put("/api/edls/sheets/:id", requireAuth, edlsComponent, requireAccess('staff'), async (req, res) => {
    try {
      const { id } = req.params;
      
      const user = (req as any).user;
      const replitUserId = user?.claims?.sub;
      const session = req.session as any;
      const { dbUser } = await getEffectiveUser(session, replitUserId);
      
      if (!dbUser) {
        res.status(401).json({ message: "User not found" });
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
      
      const { crews, ...sheetData } = parsed.data;
      
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
      
      if (sheetData.employerId) {
        const employer = await storage.employers.getEmployer(sheetData.employerId);
        if (!employer) {
          res.status(400).json({ message: "Employer not found" });
          return;
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
        
        const result = await db.transaction(async (tx) => {
          await tx.delete(edlsCrews).where(eq(edlsCrews.sheetId, id));
          
          const [updatedSheet] = Object.keys(sheetData).length > 0
            ? await tx.update(edlsSheets).set(sheetData).where(eq(edlsSheets.id, id)).returning()
            : [existingSheet];
          
          const createdCrews = await Promise.all(
            crews.map(crew => {
              const { id: crewId, ...crewData } = crew as InsertEdlsCrew & { id?: string };
              return tx.insert(edlsCrews).values({ ...crewData, sheetId: id }).returning();
            })
          );
          
          return { ...updatedSheet, crews: createdCrews.map(c => c[0]) };
        });
        
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
    } catch (error) {
      console.error("Failed to update EDLS sheet:", error);
      res.status(500).json({ message: "Failed to update sheet" });
    }
  });

  app.delete("/api/edls/sheets/:id", requireAuth, edlsComponent, requireAccess('staff'), async (req, res) => {
    try {
      const { id } = req.params;
      
      const existingSheet = await storage.edlsSheets.get(id);
      if (!existingSheet) {
        res.status(404).json({ message: "Sheet not found" });
        return;
      }
      
      await storage.edlsSheets.delete(id);
      res.status(204).send();
    } catch (error) {
      console.error("Failed to delete EDLS sheet:", error);
      res.status(500).json({ message: "Failed to delete sheet" });
    }
  });

  app.get("/api/edls/sheets/:sheetId/crews", requireAuth, edlsComponent, requireAccess('staff'), async (req, res) => {
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
