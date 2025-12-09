import type { Express } from "express";
import type { IStorage } from "../storage/database";
import { insertEsigSchema } from "@shared/schema";

export function registerEsigsRoutes(
  app: Express,
  requireAuth: any,
  requirePermission: any,
  storage: IStorage
) {
  app.post("/api/esigs", requireAuth, async (req, res) => {
    try {
      const user = req.user as any;
      const userId = user?.id;
      if (!userId) {
        return res.status(401).json({ message: "User not authenticated" });
      }

      const body = { ...req.body, userId };
      
      if (body.signedDate && typeof body.signedDate === "string") {
        body.signedDate = new Date(body.signedDate);
      }
      
      const parsed = insertEsigSchema.safeParse(body);
      
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid esig data", errors: parsed.error.errors });
      }
      
      const esig = await storage.esigs.createEsig(parsed.data);
      res.status(201).json(esig);
    } catch (error: any) {
      console.error("Failed to create esig:", error);
      res.status(500).json({ message: "Failed to create esig" });
    }
  });

  app.get("/api/esigs/:id", requireAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const esig = await storage.esigs.getEsigById(id);
      
      if (!esig) {
        return res.status(404).json({ message: "E-signature not found" });
      }
      
      res.json(esig);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch esig" });
    }
  });

  app.post("/api/cardcheck/:id/sign", requireAuth, requirePermission("workers.manage"), async (req, res) => {
    try {
      const { id: cardcheckId } = req.params;
      const user = req.user as any;
      const userId = user?.id;
      
      if (!userId) {
        return res.status(401).json({ message: "User not authenticated" });
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

      const { docRender, esigData, signatureType, docType = "cardcheck" } = req.body;

      if (!docRender || !esigData) {
        return res.status(400).json({ message: "Missing required signing data" });
      }

      const result = await storage.esigs.signCardcheck({
        cardcheckId,
        userId,
        docRender,
        docType,
        esigData,
        signatureType,
      });

      res.json(result);
    } catch (error: any) {
      console.error("Failed to sign cardcheck:", error);
      res.status(500).json({ message: "Failed to sign cardcheck" });
    }
  });
}
