import type { Express } from "express";
import { storage } from "../../storage";
import { insertLedgerPaymentBatchSchema } from "@shared/schema/ledger/payment-batch/schema";
import { requireAccess } from "../../services/access-policy-evaluator";
import { requireComponent } from "../components";
import { runInTransaction } from "../../storage/transaction-context";
import { logger } from "../../logger";
import {
  createPaymentFromRequestBody,
  triggerPaymentChargePlugins,
  enrichWithAllocatedEntities,
} from "./payments";
import type { LedgerNotification } from "../../plugins/ledger/charge/types";
import type { LedgerPayment } from "@shared/schema";
import type { LedgerPaymentBatchAssignment } from "@shared/schema/ledger/payment-batch/schema";

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
      const summary = await storage.ledger.paymentBatchAssignments.getSummaryByBatchId(batch.id);
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
        const baseList = await storage.ledger.paymentBatchAssignments.getPaymentsByBatchId(batch.id);
        const enriched = await enrichWithAllocatedEntities(baseList);
        res.json(
          enriched.map((p, i) => ({ ...p, _assignmentId: baseList[i]._assignmentId })),
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
          | { kind: "created"; paymentId: string; assignment: LedgerPaymentBatchAssignment; createdPayment: LedgerPayment }
          | { kind: "attached"; paymentId: string; assignment: LedgerPaymentBatchAssignment }
          | { kind: "conflict"; assignment: LedgerPaymentBatchAssignment };
        type AttachError = { status: number; message: string };

        // Single transaction: create payment (if needed) + assignment must succeed together,
        // or both roll back. Charge plugins fire only after the transaction commits.
        let outcome: AttachOutcome | AttachError;
        try {
          outcome = await runInTransaction(async (): Promise<AttachOutcome | AttachError> => {
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
              const result = await createPaymentFromRequestBody(req.body.payment, {
                requireAccountId: batch.accountId,
              });
              if (!result.ok) {
                return { status: result.status, message: result.message };
              }
              createdPayment = result.payment;
              paymentIdLocal = createdPayment.id;
            } else {
              return { status: 400, message: "Provide either paymentId or payment body" };
            }

            // Insert the assignment in the SAME transaction so a failure rolls back the create.
            const assignResult = await storage.ledger.paymentBatchAssignments.assignPayment(
              batch.id,
              paymentIdLocal,
            );
            if (assignResult.kind === "created") {
              return createdPayment
                ? { kind: "created", paymentId: paymentIdLocal, assignment: assignResult.assignment, createdPayment }
                : { kind: "attached", paymentId: paymentIdLocal, assignment: assignResult.assignment };
            }
            // Conflict: for an attach (no create), this is a 409. For a create attempt,
            // throwing forces the whole transaction (including the payment insert) to roll back.
            if (createdPayment) {
              throw new Error("Newly created payment is already assigned to a batch (rolling back)");
            }
            return { kind: "conflict", assignment: assignResult.assignment };
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

        const removed = await storage.ledger.paymentBatchAssignments.unassign(id, paymentId);
        if (!removed) {
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
