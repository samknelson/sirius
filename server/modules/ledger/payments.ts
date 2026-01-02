import type { Express } from "express";
import { storage } from "../../storage";
import { insertLedgerPaymentSchema, LedgerPayment } from "@shared/schema";
import { requireAccess } from "../../accessControl";
import { requireComponent } from "../components";
import { executeChargePlugins, TriggerType, PaymentSavedContext, LedgerNotification } from "../../charge-plugins";
import { logger } from "../../logger";
import { eventBus, EventType } from "../../services/event-bus";

async function triggerPaymentChargePlugins(payment: LedgerPayment): Promise<LedgerNotification[]> {
  try {
    const ea = await storage.ledger.ea.get(payment.ledgerEaId);
    if (!ea) {
      logger.warn("Cannot trigger charge plugins - EA not found", {
        service: "ledger-payments",
        paymentId: payment.id,
        ledgerEaId: payment.ledgerEaId,
      });
      return [];
    }

    const payload = {
      paymentId: payment.id,
      amount: payment.amount,
      status: payment.status,
      ledgerEaId: payment.ledgerEaId,
      accountId: ea.accountId,
      entityType: ea.entityType,
      entityId: ea.entityId,
      dateCleared: payment.dateCleared,
      memo: payment.memo,
      paymentTypeId: payment.paymentType,
    };

    // Emit event for any listeners (future notification plugins, etc.)
    eventBus.emit(EventType.PAYMENT_SAVED, payload).catch(err => {
      logger.error("Failed to emit PAYMENT_SAVED event", {
        service: "ledger-payments",
        paymentId: payment.id,
        error: err instanceof Error ? err.message : String(err),
      });
    });

    // Execute charge plugins directly (for backwards compatibility with notifications)
    const context: PaymentSavedContext = {
      trigger: TriggerType.PAYMENT_SAVED,
      ...payload,
    };

    const result = await executeChargePlugins(context);
    return result.notifications;
  } catch (error) {
    logger.error("Failed to execute charge plugins for payment", {
      service: "ledger-payments",
      paymentId: payment.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

export function registerLedgerPaymentRoutes(app: Express) {
  // GET /api/ledger/payment-types - Get all payment types
  app.get("/api/ledger/payment-types", requireComponent("ledger"), requireAccess('ledger.staff'), async (req, res) => {
    try {
      const paymentTypes = await storage.options.ledgerPaymentTypes.getAllLedgerPaymentTypes();
      res.json(paymentTypes);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch payment types" });
    }
  });

  // GET /api/ledger/payments/ea/:eaId - Get all payments for a specific EA entry
  app.get("/api/ledger/payments/ea/:eaId", requireComponent("ledger"), requireAccess('ledger.staff'), async (req, res) => {
    try {
      const { eaId } = req.params;
      const payments = await storage.ledger.payments.getByLedgerEaId(eaId);
      res.json(payments);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch payments" });
    }
  });

  // GET /api/ledger/accounts/:accountId/payments - Get all payments for a specific account with entity data
  app.get("/api/ledger/accounts/:accountId/payments", requireComponent("ledger"), requireAccess('ledger.staff'), async (req, res) => {
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
  app.get("/api/ledger/payments/:id", requireComponent("ledger"), requireAccess('ledger.staff'), async (req, res) => {
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

  // GET /api/ledger/payments/:id/transactions - Get ledger entries for a payment
  app.get("/api/ledger/payments/:id/transactions", requireComponent("ledger"), requireAccess('ledger.staff'), async (req, res) => {
    try {
      const { id } = req.params;
      const transactions = await storage.ledger.entries.getTransactions({
        referenceType: "payment",
        referenceId: id,
      });
      res.json(transactions);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch payment transactions" });
    }
  });

  // POST /api/ledger/payments - Create a new payment
  app.post("/api/ledger/payments", requireComponent("ledger"), requireAccess('ledger.staff'), async (req, res) => {
    try {
      // Convert date strings to Date objects
      const processedBody = {
        ...req.body,
        dateReceived: req.body.dateReceived ? new Date(req.body.dateReceived) : undefined,
        dateCleared: req.body.dateCleared ? new Date(req.body.dateCleared) : undefined,
      };
      
      const validatedData = insertLedgerPaymentSchema.parse(processedBody);
      const payment = await storage.ledger.payments.create(validatedData);
      
      // Trigger charge plugins - they handle their own reconciliation
      const notifications = await triggerPaymentChargePlugins(payment);
      
      res.status(201).json({
        ...payment,
        ledgerNotifications: notifications,
      });
    } catch (error) {
      console.error("Error creating payment:", error);
      if (error instanceof Error && error.name === "ZodError") {
        res.status(400).json({ 
          message: "Invalid payment data", 
          error: error.message 
        });
      } else {
        res.status(500).json({ 
          message: "Failed to create payment", 
          error: error instanceof Error ? error.message : "Unknown error" 
        });
      }
    }
  });

  // PUT /api/ledger/payments/:id - Update a payment
  app.put("/api/ledger/payments/:id", requireComponent("ledger"), requireAccess('ledger.staff'), async (req, res) => {
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
      
      // Trigger charge plugins - they handle their own reconciliation
      const notifications = await triggerPaymentChargePlugins(payment);
      
      res.json({
        ...payment,
        ledgerNotifications: notifications,
      });
    } catch (error) {
      console.error("Error updating payment:", error);
      if (error instanceof Error && error.name === "ZodError") {
        res.status(400).json({ 
          message: "Invalid payment data", 
          error: error.message 
        });
      } else {
        res.status(500).json({ 
          message: "Failed to update payment", 
          error: error instanceof Error ? error.message : "Unknown error" 
        });
      }
    }
  });

  // DELETE /api/ledger/payments/:id - Delete a payment
  app.delete("/api/ledger/payments/:id", requireComponent("ledger"), requireAccess('ledger.staff'), async (req, res) => {
    try {
      const { id } = req.params;
      
      // Delete any associated ledger entries first
      const deletedEntriesCount = await storage.ledger.entries.deleteByReference("payment", id);
      if (deletedEntriesCount > 0) {
        logger.info("Deleted ledger entries when deleting payment", {
          service: "ledger-payments",
          paymentId: id,
          deletedCount: deletedEntriesCount,
        });
      }
      
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
