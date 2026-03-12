import type { Express } from "express";
import { storage } from "../storage";
import { insertCardcheckSchema } from "@shared/schema";
import { requireComponent } from "./components";

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
      
      // Look up user via resolveDbUser helper
      const { resolveDbUser } = await import("../auth/helpers");
      const dbUser = await resolveDbUser(user, user?.claims?.sub);
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
}
