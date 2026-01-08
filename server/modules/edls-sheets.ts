import type { Express } from "express";
import { storage } from "../storage";
import { insertEdlsSheetsSchema } from "@shared/schema";
import { requireAccess } from "../services/access-policy-evaluator";
import { requireComponent } from "./components";

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
      
      res.json(sheet);
    } catch (error) {
      console.error("Failed to fetch EDLS sheet:", error);
      res.status(500).json({ message: "Failed to fetch sheet" });
    }
  });

  app.post("/api/edls/sheets", requireAuth, edlsComponent, requireAccess('staff'), async (req, res) => {
    try {
      const parsed = insertEdlsSheetsSchema.safeParse(req.body);
      
      if (!parsed.success) {
        res.status(400).json({ message: "Invalid request body", errors: parsed.error.flatten() });
        return;
      }
      
      const employer = await storage.employers.getEmployer(parsed.data.employerId);
      if (!employer) {
        res.status(400).json({ message: "Employer not found" });
        return;
      }
      
      const sheet = await storage.edlsSheets.create(parsed.data);
      res.status(201).json(sheet);
    } catch (error) {
      console.error("Failed to create EDLS sheet:", error);
      res.status(500).json({ message: "Failed to create sheet" });
    }
  });

  app.put("/api/edls/sheets/:id", requireAuth, edlsComponent, requireAccess('staff'), async (req, res) => {
    try {
      const { id } = req.params;
      
      const existingSheet = await storage.edlsSheets.get(id);
      if (!existingSheet) {
        res.status(404).json({ message: "Sheet not found" });
        return;
      }
      
      const updateSchema = insertEdlsSheetsSchema.partial();
      const parsed = updateSchema.safeParse(req.body);
      
      if (!parsed.success) {
        res.status(400).json({ message: "Invalid request body", errors: parsed.error.flatten() });
        return;
      }
      
      if (parsed.data.employerId) {
        const employer = await storage.employers.getEmployer(parsed.data.employerId);
        if (!employer) {
          res.status(400).json({ message: "Employer not found" });
          return;
        }
      }
      
      const sheet = await storage.edlsSheets.update(id, parsed.data);
      res.json(sheet);
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
}
