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

  // GET /api/ledger/accounts/:accountId/payments - Get all payments for a specific account with entity data
  app.get("/api/ledger/accounts/:accountId/payments", requireAccess(policies.ledgerStaff), async (req, res) => {
    try {
      const { accountId } = req.params;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
      const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : undefined;

      if (limit !== undefined && offset !== undefined) {
        const result = await storage.ledger.payments.getByAccountIdWithEntityPaginated(accountId, limit, offset);
        res.json(result);
      } else {
        const payments = await storage.ledger.payments.getByAccountIdWithEntity(accountId);
        res.json(payments);
      }
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
      // Convert date strings to Date objects
      const processedBody = {
        ...req.body,
        dateReceived: req.body.dateReceived ? new Date(req.body.dateReceived) : undefined,
        dateCleared: req.body.dateCleared ? new Date(req.body.dateCleared) : undefined,
      };
      
      const validatedData = insertLedgerPaymentSchema.parse(processedBody);
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
      
      // Convert date strings to Date objects
      const processedBody = {
        ...req.body,
        dateReceived: req.body.dateReceived ? new Date(req.body.dateReceived) : undefined,
        dateCleared: req.body.dateCleared ? new Date(req.body.dateCleared) : undefined,
      };
      
      const validatedData = insertLedgerPaymentSchema.partial().parse(processedBody);
      
      const payment = await storage.ledger.payments.update(id, validatedData);
      
      if (!payment) {
        res.status(404).json({ message: "Payment not found" });
        return;
      }
      
      res.json(payment);
    } catch (error) {
      if (error instanceof Error && error.name === "ZodError") {
        res.status(400).json({ message: "Invalid payment data" });
      } else {
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
