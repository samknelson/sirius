import type { Express } from "express";
import { storage } from "../../storage";
import { insertLedgerPaymentBatchSchema, ledgerPaymentBatchAssignments } from "@shared/schema/ledger/payment-batch/schema";
import { ledgerPayments, ledgerEa, employers, insertLedgerPaymentSchema } from "@shared/schema";
import { requireAccess } from "../../services/access-policy-evaluator";
import { requireComponent } from "../components";
import { getClient, runInTransaction } from "../../storage/transaction-context";
import { eq, and, sql } from "drizzle-orm";
import { logger } from "../../logger";
import {
  validateProposedAllocation,
  triggerPaymentChargePlugins,
  enrichWithAllocatedEntities,
} from "./payments";
import type { LedgerNotification } from "../../charge-plugins";
import type { LedgerPayment, LedgerPaymentWithEntity, AllocatedEntity } from "@shared/schema";

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
        // Match the enriched shape used by /api/ledger/accounts/:id/payments
        // (joins EA + employer for entity info) so the batch Payments tab
        // can reuse the same UI components.
        const rows = await client
          .select({
            payment: ledgerPayments,
            ea: ledgerEa,
            employer: employers,
            assignmentId: ledgerPaymentBatchAssignments.id,
          })
          .from(ledgerPaymentBatchAssignments)
          .innerJoin(ledgerPayments, eq(ledgerPaymentBatchAssignments.paymentId, ledgerPayments.id))
          .innerJoin(ledgerEa, eq(ledgerPayments.ledgerEaId, ledgerEa.id))
          .leftJoin(
            employers,
            and(eq(ledgerEa.entityType, "employer"), eq(ledgerEa.entityId, employers.id)),
          )
          .where(eq(ledgerPaymentBatchAssignments.batchId, batch.id))
          .orderBy(sql`${ledgerPayments.dateReceived} DESC NULLS LAST`);

        const baseList: LedgerPaymentWithEntity[] = rows.map((r) => ({
          ...(r.payment as LedgerPayment),
          entityType: r.ea.entityType,
          entityId: r.ea.entityId,
          entityName: r.employer?.name ?? null,
          allocatedEntities: [] as AllocatedEntity[],
        }));
        const enriched = await enrichWithAllocatedEntities(baseList);
        res.json(
          enriched.map((p, i) => ({ ...p, _assignmentId: rows[i].assignmentId })),
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

        type AttachOutcome =
          | { kind: "created"; paymentId: string; assignment: typeof ledgerPaymentBatchAssignments.$inferSelect; createdPayment: LedgerPayment }
          | { kind: "attached"; paymentId: string; assignment: typeof ledgerPaymentBatchAssignments.$inferSelect }
          | { kind: "conflict"; assignment: typeof ledgerPaymentBatchAssignments.$inferSelect };
        type AttachError = { status: number; message: string };

        // Single transaction: create payment (if needed) + assignment must succeed together,
        // or both roll back. createdPaymentCharge plugins fire only after the transaction commits.
        let outcome: AttachOutcome | AttachError;
        try {
          outcome = await runInTransaction(async (): Promise<AttachOutcome | AttachError> => {
            const txClient = getClient();
            let paymentIdLocal: string;
            let createdPayment: LedgerPayment | undefined;

            if (typeof req.body?.paymentId === "string") {
              paymentIdLocal = req.body.paymentId;
              const existing = await storage.ledger.payments.get(paymentIdLocal);
              if (!existing) {
                return { status: 404, message: "Payment not found" };
              }
              const ea = await storage.ledger.ea.get(existing.ledgerEaId);
              if (!ea || ea.accountId !== batch.accountId) {
                return {
                  status: 400,
                  message: "Payment belongs to a different account than this batch",
                };
              }
            } else if (req.body?.payment) {
              const raw = req.body.payment;
              const processed = {
                ...raw,
                dateReceived: raw.dateReceived ? new Date(raw.dateReceived) : undefined,
                dateCleared: raw.dateCleared ? new Date(raw.dateCleared) : undefined,
              };
              const validated = insertLedgerPaymentSchema.parse(processed);

              const primaryEa = await storage.ledger.ea.get(validated.ledgerEaId);
              if (!primaryEa) {
                return { status: 400, message: "EA entry not found" };
              }
              if (primaryEa.accountId !== batch.accountId) {
                return {
                  status: 400,
                  message: "Selected participant belongs to a different account than this batch",
                };
              }

              const allocValidation = validateProposedAllocation(
                validated.details as Record<string, unknown> | null,
                validated.amount,
              );
              if (!allocValidation.valid) {
                return { status: 400, message: allocValidation.error || "Invalid allocation" };
              }

              if (allocValidation.allocations) {
                for (const alloc of allocValidation.allocations) {
                  const allocEa = await storage.ledger.ea.get(alloc.eaId);
                  if (!allocEa) {
                    return {
                      status: 400,
                      message: `Allocation references non-existent EA: ${alloc.eaId}`,
                    };
                  }
                  if (allocEa.accountId !== batch.accountId) {
                    return {
                      status: 400,
                      message:
                        "Allocation participant belongs to a different account than this batch",
                    };
                  }
                }
              }

              createdPayment = await storage.ledger.payments.create(validated);
              paymentIdLocal = createdPayment.id;
            } else {
              return { status: 400, message: "Provide either paymentId or payment body" };
            }

            // Insert the assignment in the SAME transaction so a failure rolls back the create.
            try {
              const [assignment] = await txClient
                .insert(ledgerPaymentBatchAssignments)
                .values({ batchId: batch.id, paymentId: paymentIdLocal })
                .returning();
              return createdPayment
                ? { kind: "created", paymentId: paymentIdLocal, assignment, createdPayment }
                : { kind: "attached", paymentId: paymentIdLocal, assignment };
            } catch (insertErr) {
              // unique violation on paymentId means already assigned to a batch.
              const existingAssignment = await txClient
                .select()
                .from(ledgerPaymentBatchAssignments)
                .where(eq(ledgerPaymentBatchAssignments.paymentId, paymentIdLocal));
              if (existingAssignment.length > 0) {
                // For an attach (no create), this is a 409. For a create attempt, throwing
                // forces the whole transaction (including the payment insert) to roll back.
                if (createdPayment) {
                  throw insertErr;
                }
                return { kind: "conflict", assignment: existingAssignment[0] };
              }
              throw insertErr;
            }
          });
        } catch (err) {
          if (err instanceof Error && err.name === "ZodError") {
            res.status(400).json({ message: "Invalid payment data", error: err.message });
            return;
          }
          throw err;
        }

        if ("status" in outcome) {
          res.status(outcome.status).json({ message: outcome.message });
          return;
        }
        if (outcome.kind === "conflict") {
          res.status(409).json({
            message: "Payment is already assigned to a batch",
            assignment: outcome.assignment,
          });
          return;
        }

        // Trigger charge plugins AFTER the transaction has committed, so we never produce
        // ledger side-effects for a payment whose assignment failed.
        let createdNotifications: LedgerNotification[] = [];
        if (outcome.kind === "created") {
          createdNotifications = await triggerPaymentChargePlugins(outcome.createdPayment);
        }

        res.status(201).json({
          assignment: outcome.assignment,
          paymentId: outcome.paymentId,
          ledgerNotifications: createdNotifications,
        });
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
