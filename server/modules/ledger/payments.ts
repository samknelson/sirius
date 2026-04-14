import type { Express, Request, Response } from "express";
import { storage } from "../../storage";
import { createUnifiedOptionsStorage } from "../../storage/unified-options";
import { insertLedgerPaymentSchema, type LedgerPayment } from "@shared/schema";
import { requireAccess, checkAccessInline } from "../../services/access-policy-evaluator";
import { requireComponent } from "../components";
import { executeChargePlugins, TriggerType, PaymentSavedContext, LedgerNotification } from "../../charge-plugins";
import { logger } from "../../logger";
import { eventBus, EventType } from "../../services/event-bus";

const unifiedOptionsStorage = createUnifiedOptionsStorage();

interface ProposedAllocationEntry {
  eaId: string;
  amount: string;
  statementYmd: string;
}

function validateProposedAllocation(
  details: Record<string, unknown> | null | undefined,
  paymentAmount: string
): { valid: boolean; error?: string; allocations?: ProposedAllocationEntry[] } {
  if (!details || !details.proposedAllocation) {
    return { valid: true };
  }
  const raw = details.proposedAllocation;
  if (!Array.isArray(raw)) {
    return { valid: false, error: "proposedAllocation must be an array" };
  }
  const allocations: ProposedAllocationEntry[] = [];
  const seenEaIds = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object") {
      return { valid: false, error: "Each allocation must be an object" };
    }
    if (typeof item.eaId !== "string" || !item.eaId) {
      return { valid: false, error: "Each allocation must have a valid eaId" };
    }
    if (typeof item.amount !== "string" || isNaN(parseFloat(item.amount))) {
      return { valid: false, error: "Each allocation must have a valid amount" };
    }
    if (seenEaIds.has(item.eaId)) {
      return { valid: false, error: "Duplicate EA allocations are not allowed" };
    }
    seenEaIds.add(item.eaId);
    allocations.push({
      eaId: item.eaId,
      amount: item.amount,
      statementYmd: typeof item.statementYmd === "string" ? item.statementYmd : "",
    });
  }
  const allocationTotal = allocations.reduce((sum, a) => sum + parseFloat(a.amount), 0);
  const payAmt = parseFloat(paymentAmount);
  if (Math.abs(payAmt - allocationTotal) > 0.01) {
    return { valid: false, error: "Allocation amounts must equal the payment amount" };
  }
  return { valid: true, allocations };
}

// Helper to check EA access inline after fetching the EA
async function checkPaymentEaAccessInline(req: Request, res: Response, ea: { entityType: string; entityId: string }, policyId: string): Promise<boolean> {
  const result = await checkAccessInline(req, policyId, ea.entityId, { entityType: ea.entityType, entityId: ea.entityId });
  if (!result.granted) {
    res.status(403).json({ message: "Access denied" });
    return false;
  }
  return true;
}

async function triggerPaymentChargePlugins(payment: LedgerPayment): Promise<LedgerNotification[]> {
  try {
    const allNotifications: LedgerNotification[] = [];
    const details = (payment.details || {}) as Record<string, unknown>;
    const proposedAllocation = details.proposedAllocation as Array<{ eaId: string; amount: string; statementYmd: string }> | undefined;

    if (proposedAllocation && proposedAllocation.length > 0) {
      const currentEaIds = new Set(proposedAllocation.map(a => a.eaId));

      for (const alloc of proposedAllocation) {
        const ea = await storage.ledger.ea.get(alloc.eaId);
        if (!ea) {
          logger.warn("Cannot trigger charge plugins - allocation EA not found", {
            service: "ledger-payments",
            paymentId: payment.id,
            ledgerEaId: alloc.eaId,
          });
          continue;
        }

        const payload = {
          paymentId: payment.id,
          amount: alloc.amount,
          status: payment.status,
          ledgerEaId: alloc.eaId,
          accountId: ea.accountId,
          entityType: ea.entityType,
          entityId: ea.entityId,
          dateReceived: payment.dateReceived,
          dateCleared: payment.dateCleared,
          memo: payment.memo,
          paymentTypeId: payment.paymentType,
          allocationId: alloc.eaId,
        };

        eventBus.emit(EventType.PAYMENT_SAVED, payload).catch(err => {
          logger.error("Failed to emit PAYMENT_SAVED event for allocation", {
            service: "ledger-payments",
            paymentId: payment.id,
            ledgerEaId: alloc.eaId,
            error: err instanceof Error ? err.message : String(err),
          });
        });

        const context: PaymentSavedContext = {
          trigger: TriggerType.PAYMENT_SAVED,
          ...payload,
        };

        const result = await executeChargePlugins(context);
        allNotifications.push(...result.notifications);
      }

      try {
        const allExistingEntries = await storage.ledger.entries.getByReference("payment", payment.id);
        const currentAllocationKeys = new Set(
          proposedAllocation.map(a => `${payment.id}:${a.eaId}`)
        );
        for (const entry of allExistingEntries) {
          if (entry.chargePlugin === "payment-simple-allocation" && entry.chargePluginKey) {
            const keyParts = entry.chargePluginKey.split(":");
            if (keyParts.length >= 3) {
              const keySuffix = keyParts.slice(-2).join(":");
              if (!currentAllocationKeys.has(keySuffix)) {
                await storage.ledger.entries.delete(entry.id);
                logger.info("Deleted stale allocation ledger entry for removed EA", {
                  service: "ledger-payments",
                  paymentId: payment.id,
                  deletedEntryId: entry.id,
                  chargePluginKey: entry.chargePluginKey,
                });
              }
            } else {
              await storage.ledger.entries.delete(entry.id);
              logger.info("Deleted legacy single-EA ledger entry replaced by allocations", {
                service: "ledger-payments",
                paymentId: payment.id,
                deletedEntryId: entry.id,
                chargePluginKey: entry.chargePluginKey,
              });
            }
          }
        }
      } catch (cleanupErr) {
        logger.error("Failed to clean up stale allocation entries", {
          service: "ledger-payments",
          paymentId: payment.id,
          error: cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr),
        });
      }

      return allNotifications;
    }

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
      dateReceived: payment.dateReceived,
      dateCleared: payment.dateCleared,
      memo: payment.memo,
      paymentTypeId: payment.paymentType,
    };

    eventBus.emit(EventType.PAYMENT_SAVED, payload).catch(err => {
      logger.error("Failed to emit PAYMENT_SAVED event", {
        service: "ledger-payments",
        paymentId: payment.id,
        error: err instanceof Error ? err.message : String(err),
      });
    });

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
  // GET /api/ledger/payment-types - Get all payment types (available to all authenticated users for dropdowns)
  app.get("/api/ledger/payment-types", requireComponent("ledger"), requireAccess('authenticated'), async (req, res) => {
    try {
      const paymentTypes = await unifiedOptionsStorage.list("ledger-payment-type");
      res.json(paymentTypes);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch payment types" });
    }
  });

  // GET /api/ledger/payments/ea/:eaId - Get all payments for a specific EA entry
  app.get("/api/ledger/payments/ea/:eaId", requireComponent("ledger"), requireAccess('authenticated'), async (req, res) => {
    try {
      const { eaId } = req.params;
      
      // Look up the EA to get entity info for access check
      const ea = await storage.ledger.ea.get(eaId);
      if (!ea) {
        res.status(404).json({ message: "EA entry not found" });
        return;
      }
      
      // Check EA-level access
      if (!await checkPaymentEaAccessInline(req, res, ea, 'ledger.ea.view')) return;
      
      const payments = await storage.ledger.payments.getByLedgerEaId(eaId);
      res.json(payments);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch payments" });
    }
  });

  // GET /api/ledger/accounts/:accountId/payments - Get all payments for a specific account with entity data
  app.get("/api/ledger/accounts/:accountId/payments", requireComponent("ledger"), requireAccess('staff'), async (req, res) => {
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
  app.get("/api/ledger/payments/:id", requireComponent("ledger"), requireAccess('authenticated'), async (req, res) => {
    try {
      const { id } = req.params;
      const payment = await storage.ledger.payments.get(id);
      
      if (!payment) {
        res.status(404).json({ message: "Payment not found" });
        return;
      }
      
      // Look up the EA to check access
      const ea = await storage.ledger.ea.get(payment.ledgerEaId);
      if (!ea) {
        res.status(404).json({ message: "EA entry not found" });
        return;
      }
      
      // Check EA-level access
      if (!await checkPaymentEaAccessInline(req, res, ea, 'ledger.ea.view')) return;
      
      res.json(payment);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch payment" });
    }
  });

  // GET /api/ledger/payments/:id/transactions - Get ledger entries for a payment
  app.get("/api/ledger/payments/:id/transactions", requireComponent("ledger"), requireAccess('authenticated'), async (req, res) => {
    try {
      const { id } = req.params;
      
      // First get the payment to find its EA
      const payment = await storage.ledger.payments.get(id);
      if (!payment) {
        res.status(404).json({ message: "Payment not found" });
        return;
      }
      
      // Look up the EA to check access
      const ea = await storage.ledger.ea.get(payment.ledgerEaId);
      if (!ea) {
        res.status(404).json({ message: "EA entry not found" });
        return;
      }
      
      // Check EA-level access
      if (!await checkPaymentEaAccessInline(req, res, ea, 'ledger.ea.view')) return;
      
      const transactions = await storage.ledger.entries.getTransactions({
        referenceType: "payment",
        referenceId: id,
      });
      res.json(transactions);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch payment transactions" });
    }
  });

  // POST /api/ledger/payments - Create a new payment (staff only)
  app.post("/api/ledger/payments", requireComponent("ledger"), requireAccess('staff'), async (req, res) => {
    try {
      const rawBody = req.body;

      const processedBody = {
        ...rawBody,
        dateReceived: rawBody.dateReceived ? new Date(rawBody.dateReceived) : undefined,
        dateCleared: rawBody.dateCleared ? new Date(rawBody.dateCleared) : undefined,
      };
      
      const validatedData = insertLedgerPaymentSchema.parse(processedBody);

      const allocValidation = validateProposedAllocation(
        validatedData.details as Record<string, unknown> | null,
        validatedData.amount
      );
      if (!allocValidation.valid) {
        res.status(400).json({ message: allocValidation.error });
        return;
      }
      
      const ea = await storage.ledger.ea.get(validatedData.ledgerEaId);
      if (!ea) {
        res.status(404).json({ message: "EA entry not found" });
        return;
      }
      
      const payment = await storage.ledger.payments.create(validatedData);
      
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

  // PUT /api/ledger/payments/:id - Update a payment (staff only)
  app.put("/api/ledger/payments/:id", requireComponent("ledger"), requireAccess('staff'), async (req, res) => {
    try {
      const { id } = req.params;
      
      const existingPayment = await storage.ledger.payments.get(id);
      if (!existingPayment) {
        res.status(404).json({ message: "Payment not found" });
        return;
      }
      
      const rawBody = req.body;

      const processedBody = {
        ...rawBody,
        dateReceived: rawBody.dateReceived ? new Date(rawBody.dateReceived) : undefined,
        dateCleared: rawBody.dateCleared ? new Date(rawBody.dateCleared) : undefined,
      };
      
      const validatedData = insertLedgerPaymentSchema.partial().parse(processedBody);

      const effectiveAmount = validatedData.amount ?? existingPayment.amount;
      const effectiveDetails = validatedData.details !== undefined
        ? validatedData.details as Record<string, unknown> | null
        : existingPayment.details as Record<string, unknown> | null;
      const allocValidation = validateProposedAllocation(effectiveDetails, effectiveAmount);
      if (!allocValidation.valid) {
        res.status(400).json({ message: allocValidation.error });
        return;
      }
      
      const payment = await storage.ledger.payments.update(id, validatedData);
      
      if (!payment) {
        res.status(404).json({ message: "Payment not found" });
        return;
      }
      
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

  // DELETE /api/ledger/payments/:id - Delete a payment (staff only)
  app.delete("/api/ledger/payments/:id", requireComponent("ledger"), requireAccess('staff'), async (req, res) => {
    try {
      const { id } = req.params;
      
      // First get the payment
      const payment = await storage.ledger.payments.get(id);
      if (!payment) {
        res.status(404).json({ message: "Payment not found" });
        return;
      }
      
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
