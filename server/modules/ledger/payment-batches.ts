import type { Express } from "express";
import { storage } from "../../storage";
import { insertLedgerPaymentBatchSchema, ledgerPaymentBatchAssignments } from "@shared/schema/ledger/payment-batch/schema";
import { ledgerPayments, insertLedgerPaymentSchema } from "@shared/schema";
import { requireAccess } from "../../services/access-policy-evaluator";
import { requireComponent } from "../components";
import { getClient } from "../../storage/transaction-context";
import { eq, and, sql } from "drizzle-orm";
import { logger } from "../../logger";
import { validateProposedAllocation, triggerPaymentChargePlugins } from "./payments";

async function computeBatchSummary(batchId: string) {
  const client = getClient();
  const rows = await client
    .select({
      paymentId: ledgerPaymentBatchAssignments.paymentId,
      amount: ledgerPayments.amount,
      status: ledgerPayments.status,
    })
    .from(ledgerPaymentBatchAssignments)
    .innerJoin(ledgerPayments, eq(ledgerPaymentBatchAssignments.paymentId, ledgerPayments.id))
    .where(eq(ledgerPaymentBatchAssignments.batchId, batchId));

  const paymentsCount = rows.length;
  const paymentsTotal = rows.reduce((sum, r) => sum + parseFloat(r.amount || "0"), 0);
  return {
    paymentsCount,
    paymentsTotal: paymentsTotal.toFixed(2),
  };
}

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
      const summary = await computeBatchSummary(batch.id);
      res.json({ ...batch, ...summary });
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

  // GET payments assigned to this batch
  app.get(
    "/api/ledger-payment-batches/:id/payments",
    requireComponent("ledger.payment.batch"),
    requireAccess('staff'),
    async (req, res) => {
      try {
        const batch = await storage.ledger.paymentBatches.get(req.params.id);
        if (!batch) {
          res.status(404).json({ message: "Payment batch not found" });
          return;
        }
        const client = getClient();
        const rows = await client
          .select({ payment: ledgerPayments, assignmentId: ledgerPaymentBatchAssignments.id })
          .from(ledgerPaymentBatchAssignments)
          .innerJoin(ledgerPayments, eq(ledgerPaymentBatchAssignments.paymentId, ledgerPayments.id))
          .where(eq(ledgerPaymentBatchAssignments.batchId, batch.id))
          .orderBy(sql`${ledgerPayments.dateReceived} DESC NULLS LAST`);

        res.json(
          rows.map((r) => ({ ...r.payment, _assignmentId: r.assignmentId })),
        );
      } catch (error) {
        logger.error("Error fetching batch payments", { error: error instanceof Error ? error.message : String(error) });
        res.status(500).json({ message: "Failed to fetch batch payments" });
      }
    },
  );

  // POST create a new payment AND assign it to this batch in one call.
  // Body: { paymentId: string }  -> just attach existing payment
  // Body: { payment: <insertLedgerPaymentSchema body> }  -> create + attach
  app.post(
    "/api/ledger-payment-batches/:id/payments",
    requireComponent("ledger.payment.batch"),
    requireAccess('staff'),
    async (req, res) => {
      try {
        const batch = await storage.ledger.paymentBatches.get(req.params.id);
        if (!batch) {
          res.status(404).json({ message: "Payment batch not found" });
          return;
        }

        const client = getClient();
        let paymentId: string;
        let createdNotifications: any[] = [];

        if (typeof req.body?.paymentId === "string") {
          paymentId = req.body.paymentId;
          const existing = await storage.ledger.payments.get(paymentId);
          if (!existing) {
            res.status(404).json({ message: "Payment not found" });
            return;
          }
          // Account consistency check
          const ea = await storage.ledger.ea.get(existing.ledgerEaId);
          if (!ea || ea.accountId !== batch.accountId) {
            res.status(400).json({
              message: "Payment belongs to a different account than this batch",
            });
            return;
          }
        } else if (req.body?.payment) {
          const raw = req.body.payment;
          const processed = {
            ...raw,
            dateReceived: raw.dateReceived ? new Date(raw.dateReceived) : undefined,
            dateCleared: raw.dateCleared ? new Date(raw.dateCleared) : undefined,
          };
          const validated = insertLedgerPaymentSchema.parse(processed);

          // Account consistency: primary EA must belong to batch's account
          const primaryEa = await storage.ledger.ea.get(validated.ledgerEaId);
          if (!primaryEa) {
            res.status(400).json({ message: "EA entry not found" });
            return;
          }
          if (primaryEa.accountId !== batch.accountId) {
            res.status(400).json({
              message: "Selected participant belongs to a different account than this batch",
            });
            return;
          }

          // Validate proposedAllocation just like /api/ledger/payments does
          const allocValidation = validateProposedAllocation(
            validated.details as Record<string, unknown> | null,
            validated.amount,
          );
          if (!allocValidation.valid) {
            res.status(400).json({ message: allocValidation.error });
            return;
          }

          // All allocation EAs must also belong to this batch's account
          if (allocValidation.allocations) {
            for (const alloc of allocValidation.allocations) {
              const allocEa = await storage.ledger.ea.get(alloc.eaId);
              if (!allocEa) {
                res.status(400).json({
                  message: `Allocation references non-existent EA: ${alloc.eaId}`,
                });
                return;
              }
              if (allocEa.accountId !== batch.accountId) {
                res.status(400).json({
                  message: "Allocation participant belongs to a different account than this batch",
                });
                return;
              }
            }
          }

          const created = await storage.ledger.payments.create(validated);
          paymentId = created.id;

          // Fire charge plugins (creates ledger entries) just like /api/ledger/payments
          createdNotifications = await triggerPaymentChargePlugins(created);
        } else {
          res.status(400).json({ message: "Provide either paymentId or payment body" });
          return;
        }

        // upsert assignment
        try {
          const [assignment] = await client
            .insert(ledgerPaymentBatchAssignments)
            .values({ batchId: batch.id, paymentId })
            .returning();
          res.status(201).json({
            assignment,
            paymentId,
            ledgerNotifications: createdNotifications,
          });
        } catch (err) {
          // unique violation on paymentId means already assigned (possibly to another batch)
          const existing = await client
            .select()
            .from(ledgerPaymentBatchAssignments)
            .where(eq(ledgerPaymentBatchAssignments.paymentId, paymentId));
          if (existing.length > 0) {
            res.status(409).json({
              message: "Payment is already assigned to a batch",
              assignment: existing[0],
            });
            return;
          }
          throw err;
        }
      } catch (error) {
        if (error instanceof Error && error.name === "ZodError") {
          res.status(400).json({ message: "Invalid payment data", error: error.message });
          return;
        }
        logger.error("Error attaching payment to batch", { error: error instanceof Error ? error.message : String(error) });
        res.status(500).json({ message: "Failed to attach payment to batch" });
      }
    },
  );

  // DELETE remove an assignment (and optionally delete the payment itself)
  // ?deletePayment=true also deletes the underlying payment record
  app.delete(
    "/api/ledger-payment-batches/:id/payments/:paymentId",
    requireComponent("ledger.payment.batch"),
    requireAccess('staff'),
    async (req, res) => {
      try {
        const { id, paymentId } = req.params;
        const deletePayment = req.query.deletePayment === "true";

        const batch = await storage.ledger.paymentBatches.get(id);
        if (!batch) {
          res.status(404).json({ message: "Payment batch not found" });
          return;
        }

        const client = getClient();
        const result = await client
          .delete(ledgerPaymentBatchAssignments)
          .where(
            and(
              eq(ledgerPaymentBatchAssignments.batchId, id),
              eq(ledgerPaymentBatchAssignments.paymentId, paymentId),
            ),
          );

        if (!result.rowCount || result.rowCount === 0) {
          res.status(404).json({ message: "Assignment not found" });
          return;
        }

        if (deletePayment) {
          await storage.ledger.entries.deleteByReference("payment", paymentId);
          await storage.ledger.payments.delete(paymentId);
        }

        res.status(204).send();
      } catch (error) {
        logger.error("Error removing payment from batch", { error: error instanceof Error ? error.message : String(error) });
        res.status(500).json({ message: "Failed to remove payment from batch" });
      }
    },
  );
}
