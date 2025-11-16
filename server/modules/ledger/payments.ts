import type { Express } from "express";
import { storage } from "../../storage";
import { insertLedgerPaymentSchema } from "@shared/schema";
import { policies } from "../../policies";
import { requireAccess } from "../../accessControl";

export function registerLedgerPaymentRoutes(app: Express) {
  // GET /api/ledger/payment-types - Get all payment types
  app.get("/api/ledger/payment-types", requireAccess(policies.ledgerStaff), async (req, res) => {
    try {
      const paymentTypes = await storage.options.ledgerPaymentTypes.getAllLedgerPaymentTypes();
      res.json(paymentTypes);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch payment types" });
    }
  });

  // GET /api/ledger/payments/ea/:eaId - Get all payments for a specific EA entry
  app.get("/api/ledger/payments/ea/:eaId", requireAccess(policies.ledgerStaff), async (req, res) => {
    try {
      const { eaId } = req.params;
      const payments = await storage.ledger.payments.getByLedgerEaId(eaId);
      res.json(payments);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch payments" });
    }
  });

  // GET /api/ledger/payments/:id - Get a specific payment
  app.get("/api/ledger/payments/:id", requireAccess(policies.ledgerStaff), async (req, res) => {
    try {
      const { id } = req.params;
      const payment = await storage.ledger.payments.get(id);
      
      if (!payment) {
        res.status(404).json({ message: "Payment not found" });
        return;
      }
      
      res.json(payment);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch payment" });
    }
  });

  // POST /api/ledger/payments - Create a new payment
  app.post("/api/ledger/payments", requireAccess(policies.ledgerStaff), async (req, res) => {
    try {
      const validatedData = insertLedgerPaymentSchema.parse(req.body);
      const payment = await storage.ledger.payments.create(validatedData);
      res.status(201).json(payment);
    } catch (error) {
      if (error instanceof Error && error.name === "ZodError") {
        res.status(400).json({ message: "Invalid payment data" });
      } else {
        res.status(500).json({ message: "Failed to create payment" });
      }
    }
  });

  // PUT /api/ledger/payments/:id - Update a payment
  app.put("/api/ledger/payments/:id", requireAccess(policies.ledgerStaff), async (req, res) => {
    try {
      const { id } = req.params;
      console.log("Update payment request body:", JSON.stringify(req.body, null, 2));
      const validatedData = insertLedgerPaymentSchema.partial().parse(req.body);
      
      const payment = await storage.ledger.payments.update(id, validatedData);
      
      if (!payment) {
        res.status(404).json({ message: "Payment not found" });
        return;
      }
      
      res.json(payment);
    } catch (error) {
      if (error instanceof Error && error.name === "ZodError") {
        console.error("Zod validation error:", error);
        res.status(400).json({ message: "Invalid payment data", error: error });
      } else {
        console.error("Failed to update payment:", error);
        res.status(500).json({ message: "Failed to update payment" });
      }
    }
  });

  // DELETE /api/ledger/payments/:id - Delete a payment
  app.delete("/api/ledger/payments/:id", requireAccess(policies.ledgerStaff), async (req, res) => {
    try {
      const { id } = req.params;
      const success = await storage.ledger.payments.delete(id);
      
      if (!success) {
        res.status(404).json({ message: "Payment not found" });
        return;
      }
      
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Failed to delete payment" });
    }
  });
}
