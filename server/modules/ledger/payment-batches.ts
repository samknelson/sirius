import type { Express } from "express";
import { storage } from "../../storage";
import { insertLedgerPaymentBatchSchema } from "@shared/schema/ledger/payment-batch/schema";
import { requireAccess } from "../../services/access-policy-evaluator";
import { requireComponent } from "../components";

export function registerLedgerPaymentBatchRoutes(app: Express) {
  app.get("/api/ledger-payment-batches", requireComponent("ledger.payment.batch"), requireAccess('staff'), async (req, res) => {
    try {
      const { accountId } = req.query;
      if (accountId && typeof accountId === "string") {
        const batches = await storage.ledger.paymentBatches.getByAccountId(accountId);
        res.json(batches);
      } else {
        const batches = await storage.ledger.paymentBatches.getAll();
        res.json(batches);
      }
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch payment batches" });
    }
  });

  app.get("/api/ledger-payment-batches/:id", requireComponent("ledger.payment.batch"), requireAccess('staff'), async (req, res) => {
    try {
      const batch = await storage.ledger.paymentBatches.get(req.params.id);
      if (!batch) {
        res.status(404).json({ message: "Payment batch not found" });
        return;
      }
      res.json(batch);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch payment batch" });
    }
  });

  app.post("/api/ledger-payment-batches", requireComponent("ledger.payment.batch"), requireAccess('staff'), async (req, res) => {
    try {
      const validatedData = insertLedgerPaymentBatchSchema.parse(req.body);
      const account = await storage.ledger.accounts.get(validatedData.accountId);
      if (!account) {
        res.status(404).json({ message: "Account not found" });
        return;
      }
      const batch = await storage.ledger.paymentBatches.create(validatedData);
      res.status(201).json(batch);
    } catch (error) {
      if (error instanceof Error && error.name === "ZodError") {
        res.status(400).json({ message: "Invalid payment batch data", error: error.message });
      } else {
        res.status(500).json({ message: "Failed to create payment batch" });
      }
    }
  });

  app.patch("/api/ledger-payment-batches/:id", requireComponent("ledger.payment.batch"), requireAccess('staff'), async (req, res) => {
    try {
      const existing = await storage.ledger.paymentBatches.get(req.params.id);
      if (!existing) {
        res.status(404).json({ message: "Payment batch not found" });
        return;
      }
      const validatedData = insertLedgerPaymentBatchSchema.partial().parse(req.body);
      const { accountId, ...updateData } = validatedData;
      const batch = await storage.ledger.paymentBatches.update(req.params.id, updateData);
      if (!batch) {
        res.status(404).json({ message: "Payment batch not found" });
        return;
      }
      res.json(batch);
    } catch (error) {
      if (error instanceof Error && error.name === "ZodError") {
        res.status(400).json({ message: "Invalid payment batch data", error: error.message });
      } else {
        res.status(500).json({ message: "Failed to update payment batch" });
      }
    }
  });

  app.delete("/api/ledger-payment-batches/:id", requireComponent("ledger.payment.batch"), requireAccess('staff'), async (req, res) => {
    try {
      const existing = await storage.ledger.paymentBatches.get(req.params.id);
      if (!existing) {
        res.status(404).json({ message: "Payment batch not found" });
        return;
      }
      const success = await storage.ledger.paymentBatches.delete(req.params.id);
      if (!success) {
        res.status(404).json({ message: "Payment batch not found" });
        return;
      }
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Failed to delete payment batch" });
    }
  });
}
