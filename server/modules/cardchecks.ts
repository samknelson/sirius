import type { Express } from "express";
import { storage } from "../storage";
import { insertCardcheckSchema } from "@shared/schema";
import { requireComponent } from "./components";
import { db } from "../db";
import { sql } from "drizzle-orm";

export function registerCardchecksRoutes(
  app: Express,
  requireAuth: any,
  requirePermission: any,
  requireAccess: any
) {
  const cardcheckComponent = requireComponent("cardcheck");

  // GET /api/workers/:workerId/cardchecks - Get cardchecks for a worker (worker.view policy)
  app.get("/api/workers/:workerId/cardchecks", requireAuth, cardcheckComponent, requireAccess('worker.view', (req: any) => req.params.workerId), async (req, res) => {
    try {
      const { workerId } = req.params;
      const cardchecks = await storage.cardchecks.getCardchecksByWorkerId(workerId);
      res.json(cardchecks);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch cardchecks" });
    }
  });

  // GET /api/cardcheck/:id - Get specific cardcheck (cardcheck.view policy)
  app.get("/api/cardcheck/:id", requireAuth, cardcheckComponent, requireAccess('cardcheck.view', (req: any) => req.params.id), async (req, res) => {
    try {
      const { id } = req.params;
      const cardcheck = await storage.cardchecks.getCardcheckById(id);
      
      if (!cardcheck) {
        res.status(404).json({ message: "Cardcheck not found" });
        return;
      }
      
      res.json(cardcheck);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch cardcheck" });
    }
  });

  app.post("/api/workers/:workerId/cardchecks", requireAuth, cardcheckComponent, requireAccess('worker.edit', (req: any) => req.params.workerId), async (req, res) => {
    try {
      const { workerId } = req.params;
      
      // Get the worker to copy bargainingUnitId
      const worker = await storage.workers.getWorker(workerId);
      if (!worker) {
        return res.status(404).json({ message: "Worker not found" });
      }
      
      // Copy bargainingUnitId from worker when creating cardcheck
      const data = { 
        ...req.body, 
        workerId,
        bargainingUnitId: worker.bargainingUnitId || null
      };
      const parsed = insertCardcheckSchema.safeParse(data);
      
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid cardcheck data", errors: parsed.error.errors });
      }
      
      const cardcheck = await storage.cardchecks.createCardcheck(parsed.data);
      res.status(201).json(cardcheck);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to create cardcheck" });
    }
  });

  app.patch("/api/cardcheck/:id", requireAuth, cardcheckComponent, requireAccess('cardcheck.edit', (req: any) => req.params.id), async (req, res) => {
    try {
      const { id } = req.params;
      
      const existing = await storage.cardchecks.getCardcheckById(id);
      if (!existing) {
        res.status(404).json({ message: "Cardcheck not found" });
        return;
      }
      
      if (existing.status === "revoked") {
        return res.status(400).json({ message: "Cannot modify a revoked cardcheck. Revoked cardchecks are permanently locked." });
      }
      
      const body = { ...req.body };
      if (body.signedDate && typeof body.signedDate === "string") {
        body.signedDate = new Date(body.signedDate);
      }
      
      const parsed = insertCardcheckSchema.partial().safeParse(body);
      
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid cardcheck data", errors: parsed.error.errors });
      }
      
      const updatedCardcheck = await storage.cardchecks.updateCardcheck(id, parsed.data);
      
      if (!updatedCardcheck) {
        res.status(404).json({ message: "Cardcheck not found" });
        return;
      }
      
      res.json(updatedCardcheck);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to update cardcheck" });
    }
  });

  app.delete("/api/cardcheck/:id", requireAuth, cardcheckComponent, requirePermission("staff"), async (req, res) => {
    try {
      const { id } = req.params;
      
      const deleted = await storage.cardchecks.deleteCardcheck(id);
      
      if (!deleted) {
        res.status(404).json({ message: "Cardcheck not found" });
        return;
      }
      
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete cardcheck" });
    }
  });

  app.get("/api/cardchecks/status-summary", requireAuth, cardcheckComponent, requirePermission("staff"), async (req, res) => {
    try {
      const summary = await storage.cardchecks.getCardcheckStatusSummary();
      res.json(summary);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch cardcheck status summary" });
    }
  });

  // POST /api/cardcheck/:id/sign - Sign a cardcheck (cardcheck.edit policy)
  app.post("/api/cardcheck/:id/sign", requireAuth, cardcheckComponent, requireAccess('cardcheck.edit', (req: any) => req.params.id), async (req, res) => {
    try {
      const { id: cardcheckId } = req.params;
      const user = req.user as any;
      const replitUserId = user?.claims?.sub;
      
      if (!replitUserId) {
        return res.status(401).json({ message: "User not authenticated" });
      }

      const dbUser = await storage.users.getUserByReplitId(replitUserId);
      if (!dbUser) {
        return res.status(401).json({ message: "User not found" });
      }

      const existingCardcheck = await storage.cardchecks.getCardcheckById(cardcheckId);
      if (!existingCardcheck) {
        return res.status(404).json({ message: "Cardcheck not found" });
      }

      if (existingCardcheck.status === "signed") {
        return res.status(400).json({ message: "Cardcheck is already signed" });
      }

      if (existingCardcheck.status === "revoked") {
        return res.status(400).json({ message: "Cannot sign a revoked cardcheck" });
      }

      const { docRender, esigData, signatureType, docType = "cardcheck", rate } = req.body;

      if (!docRender || !esigData) {
        return res.status(400).json({ message: "Missing required signing data" });
      }

      // Extract fileId from esigData if signing with uploaded document
      const fileId = signatureType === "upload" && esigData?.value ? esigData.value : undefined;

      const result = await storage.esigs.signCardcheck({
        cardcheckId,
        userId: dbUser.id,
        docRender,
        docType,
        esigData,
        signatureType,
        fileId,
        rate: rate !== undefined ? Number(rate) : undefined,
      });

      res.json(result);
    } catch (error: any) {
      console.error("Failed to sign cardcheck:", error);
      res.status(500).json({ message: "Failed to sign cardcheck" });
    }
  });

  // GET /api/employers/organizing - Get organizing employer list with card check stats
  app.get("/api/employers/organizing", requireAuth, cardcheckComponent, requirePermission("staff"), async (req, res) => {
    try {
      // Get all active employers with their type info
      const employersResult = await db.execute(sql`
        SELECT 
          e.id,
          e.name,
          e.type_id as "typeId",
          et.name as "typeName",
          et.icon as "typeIcon"
        FROM employers e
        LEFT JOIN options_employer_type et ON e.type_id = et.id
        WHERE e.is_active = true
        ORDER BY e.name
      `);

      const employers = employersResult.rows as any[];

      // Get worker counts and card check stats per employer/bargaining unit
      // Workers are "active" if their most recent employment record has status "Active" or "Active - Secondary"
      const statsResult = await db.execute(sql`
        WITH latest_employment AS (
          SELECT DISTINCT ON (wh.worker_id, wh.employer_id)
            wh.worker_id,
            wh.employer_id,
            wh.employment_status_id,
            es.name as status_name
          FROM worker_hours wh
          LEFT JOIN options_employment_status es ON wh.employment_status_id = es.id
          ORDER BY wh.worker_id, wh.employer_id, wh.year DESC, wh.month DESC, wh.day DESC
        ),
        active_workers AS (
          SELECT 
            le.worker_id,
            le.employer_id,
            w.bargaining_unit_id
          FROM latest_employment le
          INNER JOIN workers w ON w.id = le.worker_id
          WHERE le.status_name IN ('Active', 'Active - Secondary')
        ),
        worker_cardchecks AS (
          SELECT 
            aw.employer_id,
            aw.bargaining_unit_id,
            COUNT(DISTINCT aw.worker_id) as total_workers,
            COUNT(DISTINCT CASE WHEN cc.status = 'signed' THEN aw.worker_id END) as signed_workers
          FROM active_workers aw
          LEFT JOIN cardchecks cc ON cc.worker_id = aw.worker_id AND cc.status = 'signed'
          GROUP BY aw.employer_id, aw.bargaining_unit_id
        )
        SELECT 
          wc.employer_id as "employerId",
          wc.bargaining_unit_id as "bargainingUnitId",
          bu.name as "bargainingUnitName",
          wc.total_workers as "totalWorkers",
          wc.signed_workers as "signedWorkers"
        FROM worker_cardchecks wc
        LEFT JOIN bargaining_units bu ON bu.id = wc.bargaining_unit_id
      `);

      const stats = statsResult.rows as any[];

      // Get stewards for each employer
      const stewardsResult = await db.execute(sql`
        SELECT 
          wsa.employer_id as "employerId",
          wsa.worker_id as "workerId",
          wsa.bargaining_unit_id as "bargainingUnitId",
          c.display_name as "displayName",
          bu.name as "bargainingUnitName"
        FROM worker_steward_assignments wsa
        INNER JOIN workers w ON w.id = wsa.worker_id
        INNER JOIN contacts c ON c.id = w.contact_id
        LEFT JOIN bargaining_units bu ON bu.id = wsa.bargaining_unit_id
        ORDER BY c.display_name
      `);

      const stewards = stewardsResult.rows as any[];

      // Build response with aggregated data
      const employerMap = new Map<string, any>();

      for (const emp of employers) {
        employerMap.set(emp.id, {
          id: emp.id,
          name: emp.name,
          typeId: emp.typeId,
          typeName: emp.typeName,
          typeIcon: emp.typeIcon,
          totalWorkers: 0,
          signedWorkers: 0,
          bargainingUnits: [],
          stewards: []
        });
      }

      // Aggregate stats by employer
      for (const stat of stats) {
        const emp = employerMap.get(stat.employerId);
        if (emp) {
          emp.totalWorkers += Number(stat.totalWorkers) || 0;
          emp.signedWorkers += Number(stat.signedWorkers) || 0;
          if (stat.bargainingUnitId) {
            emp.bargainingUnits.push({
              id: stat.bargainingUnitId,
              name: stat.bargainingUnitName || 'Unknown',
              totalWorkers: Number(stat.totalWorkers) || 0,
              signedWorkers: Number(stat.signedWorkers) || 0
            });
          }
        }
      }

      // Add stewards to employers
      for (const steward of stewards) {
        const emp = employerMap.get(steward.employerId);
        if (emp) {
          emp.stewards.push({
            workerId: steward.workerId,
            displayName: steward.displayName,
            bargainingUnitId: steward.bargainingUnitId,
            bargainingUnitName: steward.bargainingUnitName
          });
        }
      }

      // Filter to only employers with workers and sort by name
      const result = Array.from(employerMap.values())
        .filter(emp => emp.totalWorkers > 0)
        .sort((a, b) => a.name.localeCompare(b.name));

      res.json(result);
    } catch (error: any) {
      console.error("Failed to fetch organizing employer list:", error);
      res.status(500).json({ message: "Failed to fetch organizing employer list" });
    }
  });
}
