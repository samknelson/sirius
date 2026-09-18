import type { Express, Request, Response } from "express";
import { checkAccessInline } from "../../services/access-policy-evaluator";
import { storage } from "../../storage";
import { resolveGateway } from "./payment-gateway-context";
import { triggerPaymentChargePlugins } from "./payments";
import { randomUUID } from "node:crypto";
import { selectFinancialPaymentType, shouldApplyPaymentEvent } from "./payment-attempt-state";
import { createUnifiedOptionsStorage } from "../../storage/unified-options";
import { runInTransaction } from "../../storage/transaction-context";
import { getComponentChecker } from "../../services/access-policy-evaluator";

const options = createUnifiedOptionsStorage();
const raw = (req: Request) => (req as Request & { rawBody?: Buffer }).rawBody;

function error(res: Response, status: number, message: string) {
  return res.status(status).json({ message });
}

async function assertWorker(req: Request, workerId: string) {
  const result = await checkAccessInline(req, "worker.ledger", workerId);
  return result.granted;
}

async function assertGatewayReadyForCharge(
  resolved: Awaited<ReturnType<typeof resolveGateway>>,
): Promise<void> {
  const component = resolved.plugin.requiredComponent;
  const checker = getComponentChecker();
  if (component && (!checker || !(await checker(component)))) {
    throw new PaymentAttemptConflictError(`Component not enabled: ${component}`);
  }
  if (!resolved.plugin.constructWebhookEvent || !resolved.context.webhookSecret) {
    throw new PaymentAttemptConflictError(
      "This payment gateway is not ready for online payments because its signed webhook is not configured",
    );
  }
}

function workerVisibleStatus(attempt: { status: string; ledgerPaymentId?: string | null }) {
  return attempt.status === "succeeded" && !attempt.ledgerPaymentId
    ? "processing"
    : attempt.status;
}

export function registerLedgerPaymentAttemptRoutes(
  app: Express,
  requireAuth: import("express").RequestHandler,
): void {
  const createAttempt = async (req: Request, res: Response) => {
    try {
      const { workerId, paymentMethodId, eaId, amount, idempotencyKey } = req.body ?? {};
      if (!workerId || !paymentMethodId || !eaId || !idempotencyKey || !/^\d+(?:\.\d{1,2})?$/.test(String(amount)) || Number(amount) <= 0) {
        return error(res, 400, "workerId, eaId, paymentMethodId, amount, and idempotencyKey are required");
      }
      if (!(await assertWorker(req, workerId))) return error(res, 403, "Access denied");
      const worker = await storage.workers.getWorker(workerId);
      const method = await storage.ledger.paymentMethods.get(paymentMethodId);
      if (!worker || !method || method.entityType !== "worker" || method.entityId !== workerId || !method.isActive) {
        return error(res, 404, "Payment method not found");
      }
      const ea = await storage.ledger.ea.get(eaId);
      if (ea?.entityType !== "worker" || ea.entityId !== workerId) return error(res, 403, "Ledger account does not belong to this worker");
      if (!ea) return error(res, 409, "No ledger account is configured for this worker");
      const existing = await storage.ledger.paymentAttempts.getByIdempotencyKey(idempotencyKey);
      if (existing) {
        if (
          existing.workerId !== workerId ||
          existing.ledgerEaId !== eaId ||
          existing.paymentMethodId !== paymentMethodId ||
          Number(existing.amount) !== Number(amount)
        ) {
          return error(res, 409, "Idempotency key was already used for a different payment");
        }
        const existingGateway = await resolveGateway(existing.gatewayConfigId);
        const existingIntent =
          existing.providerIntentRef && existingGateway.plugin.retrievePaymentIntent
            ? await existingGateway.plugin.retrievePaymentIntent(
                existingGateway.context,
                existing.providerIntentRef,
              )
            : undefined;
        return res.json({
          ...existing,
          clientSecret: existingIntent?.clientSecret ?? null,
          componentId: existingGateway.plugin.addComponentId ?? null,
          publicConfig: {
            publishableKey:
              existingGateway.config.data && typeof existingGateway.config.data === "object"
                ? (existingGateway.config.data as Record<string, unknown>).publishableKey
                : undefined,
          },
          status: workerVisibleStatus({
            status: existingIntent?.status ?? existing.status,
            ledgerPaymentId: existing.ledgerPaymentId,
          }),
        });
      }
      const resolved = await resolveGateway(method.gatewayConfigId);
      await assertGatewayReadyForCharge(resolved);
      if (!resolved.plugin.createPaymentIntent) {
        return error(res, 409, "This payment gateway does not support online payments");
      }
      const account = await storage.ledger.accounts.get(ea.accountId);
      const currency = account?.currencyCode ?? "USD";
      const paymentType = selectFinancialPaymentType(
        await options.list("ledger-payment-type"),
        currency,
      );
      if (!paymentType) {
        return error(
          res,
          409,
          `No financial ledger payment type is configured for ${currency}`,
        );
      }
      if (account?.gatewayConfigId && account.gatewayConfigId !== method.gatewayConfigId) {
        return error(res, 409, "Payment method is not enabled for this ledger account");
      }
      const methodSummary = await resolved.plugin.getMethodSummary(resolved.context, method.paymentMethod);
      if (methodSummary.type !== "card" && methodSummary.type !== "us_bank_account") {
        return error(res, 400, "This payment method cannot be used for worker payments");
      }
      const customer = await storage.ledger.gatewayCustomers.get("worker", workerId, method.gatewayConfigId);
      if (!customer) return error(res, 409, "Payment customer is not configured");
      const attempt = await runInTransaction(async () => {
        await storage.ledger.paymentAttempts.lockEa(ea.id);
        await storage.ledger.paymentAttempts.expireReservations(ea.id);
        const balance = Number(await storage.ledger.ea.getBalance(ea.id));
        const reserved = await storage.ledger.paymentAttempts.getReservedAmount(ea.id);
        if (!Number.isFinite(balance) || Number(amount) > balance - reserved + 0.0001) {
          throw new PaymentAttemptConflictError("Payment amount exceeds the available balance");
        }
        return storage.ledger.paymentAttempts.create({
          workerId, ledgerEaId: ea.id, gatewayConfigId: method.gatewayConfigId,
          paymentMethodId, idempotencyKey, amount: String(amount), currency,
          status: "requires_action",
          reservationExpiresAt: new Date(Date.now() + 30 * 60 * 1000),
          metadata: {
            source: "worker_self",
            ledgerPaymentTypeId: paymentType.id,
          },
        });
      });
      try {
        const intent = await resolved.plugin.createPaymentIntent(resolved.context, {
          amount: Math.round(Number(amount) * 100), currency, customerRef: customer.customerRef,
          paymentMethodRef: method.paymentMethod, paymentMethodType: methodSummary.type, idempotencyKey,
          metadata: { attemptId: attempt.id, workerId },
        });
        const updated = await storage.ledger.paymentAttempts.updateStatus(attempt.id, intent.status, {
          providerIntentRef: intent.providerIntentRef,
          failureMessage: intent.failureMessage,
        });
        return res.status(201).json({
          ...(updated ?? attempt),
          clientSecret: intent.clientSecret ?? null,
          componentId: resolved.plugin.addComponentId ?? null,
          publicConfig: {
            publishableKey: resolved.config.data && typeof resolved.config.data === "object"
              ? (resolved.config.data as Record<string, unknown>).publishableKey : undefined,
            paymentTypes: [methodSummary.type],
          },
          status: intent.status === "succeeded" ? "processing" : intent.status,
        });
      } catch (providerError) {
        await storage.ledger.paymentAttempts.updateStatus(attempt.id, "failed", {
          failureMessage: providerError instanceof Error ? providerError.message : String(providerError),
        });
        return error(res, 402, "Payment could not be completed");
      }
    } catch (e) {
      if (e instanceof PaymentAttemptConflictError) return error(res, 409, e.message);
      return error(res, 500, e instanceof Error ? e.message : "Failed to create payment attempt");
    }
  };
  app.post("/api/ledger/payment-attempts", requireAuth, createAttempt);
  app.get("/api/ledger/payment-attempts/:attemptId", requireAuth, async (req, res) => {
    const attempt = await storage.ledger.paymentAttempts.get(req.params.attemptId);
    if (!attempt) return error(res, 404, "Payment attempt not found");
    if (!(await assertWorker(req, attempt.workerId))) return error(res, 403, "Access denied");
    return res.json({
      id: attempt.id,
      status: workerVisibleStatus(attempt),
      amount: attempt.amount,
      currency: attempt.currency,
      ledgerPaymentId: attempt.ledgerPaymentId,
      failureMessage: attempt.status === "failed" ? attempt.failureMessage : null,
    });
  });
  app.post("/api/workers/:workerId/ledger/payment-intent", requireAuth, async (req, res) => {
    req.body = { ...req.body, workerId: req.params.workerId, idempotencyKey: req.body?.idempotencyKey ?? `worker:${req.params.workerId}:${req.body?.eaId}:${req.body?.paymentMethodId}:${req.body?.amount}` };
    return createAttempt(req, res);
  });

  app.get("/api/workers/:workerId/ledger/payable", requireAuth, async (req, res) => {
    if (!(await assertWorker(req, req.params.workerId))) return error(res, 403, "Access denied");
    const eas = await storage.ledger.ea.getByEntity("worker", req.params.workerId);
    if (eas.length !== 1) return error(res, 409, "A single payable ledger account must be configured");
    const account = await storage.ledger.accounts.get(eas[0].accountId);
    const balance = await storage.ledger.ea.getBalance(eas[0].id);
    return res.json({ eaId: eas[0].id, balance, currencyCode: account?.currencyCode ?? "USD" });
  });

  app.post("/api/ledger/payment-gateways/:gatewayConfigId/webhook", async (req, res) => {
    const body = raw(req);
    const signature = req.header("stripe-signature");
    if (!body || !signature) return error(res, 400, "Signed raw webhook body is required");
    try {
      const resolved = await resolveGateway(req.params.gatewayConfigId, { allowDisabled: true });
      if (!resolved.plugin.constructWebhookEvent) {
        return error(res, 404, "This payment gateway does not accept webhooks");
      }
      const event = resolved.plugin.constructWebhookEvent(resolved.context, body, signature);
      const object = (event.data ?? {}) as Record<string, unknown>;
      const metadata = (object.metadata ?? {}) as Record<string, unknown>;
      const attemptId = typeof metadata.attemptId === "string" ? metadata.attemptId : undefined;
      const providerRef = typeof object.id === "string" ? object.id : undefined;
      const attempt = attemptId
        ? await storage.ledger.paymentAttempts.get(attemptId)
        : providerRef ? await storage.ledger.paymentAttempts.getByProviderIntent(providerRef) : undefined;
      if (!attempt) return res.json({ received: true });
      if (attempt.gatewayConfigId !== req.params.gatewayConfigId) {
        return error(res, 400, "Webhook event does not belong to this payment gateway");
      }
      if (!providerRef) {
        return error(res, 400, "Webhook event does not identify a provider payment");
      }
      if (attempt.providerIntentRef && attempt.providerIntentRef !== providerRef) {
        return error(res, 400, "Webhook event does not belong to this payment attempt");
      }
      const newlyRecorded = await storage.ledger.paymentAttempts.recordEvent({
        attemptId: attempt.id, providerEventId: event.id, eventType: event.type,
        providerCreated: event.created ?? 0, payload: event.data,
      });
      const status = event.type === "payment_intent.succeeded" ? "succeeded"
        : event.type === "payment_intent.processing" ? "processing"
          : event.type === "payment_intent.payment_failed" || event.type === "payment_intent.canceled"
            ? "failed" : undefined;
      if (!shouldApplyPaymentEvent(attempt.status, attempt.lastProviderEventCreated, status ?? attempt.status, event.created)) {
        return res.json({ received: true, stale: true });
      }
      if (status) {
        const updated = await storage.ledger.paymentAttempts.updateStatus(attempt.id, status, {
          providerIntentRef: providerRef ?? attempt.providerIntentRef,
          lastProviderEventCreated: event.created ?? attempt.lastProviderEventCreated,
          failureMessage: typeof object.last_payment_error === "object" ? "Payment failed" : undefined,
        });
        if (status === "succeeded" && updated && !updated.ledgerPaymentId) {
          const types = await options.list("ledger-payment-type");
          const storedPaymentTypeId =
            attempt.metadata &&
            typeof attempt.metadata === "object" &&
            typeof (attempt.metadata as Record<string, unknown>).ledgerPaymentTypeId === "string"
              ? (attempt.metadata as Record<string, unknown>).ledgerPaymentTypeId as string
              : undefined;
          const paymentType =
            types.find(
              (type) =>
                type.id === storedPaymentTypeId &&
                type.category === "financial" &&
                type.currencyCode?.toUpperCase() === attempt.currency.toUpperCase(),
            ) ?? selectFinancialPaymentType(types, attempt.currency);
          if (!paymentType) {
            return error(
              res,
              503,
              `No financial ledger payment type is configured for ${attempt.currency}`,
            );
          }
          const ledgerPaymentId = randomUUID();
          const posted = await runInTransaction(async () => {
            if (!(await storage.ledger.paymentAttempts.claimLedgerPosting(attempt.id, ledgerPaymentId))) {
              return false;
            }
            const createdPayment = await storage.ledger.payments.create({
              id: ledgerPaymentId,
              status: "cleared", allocated: false, amount: attempt.amount,
              paymentType: paymentType.id, ledgerEaId: attempt.ledgerEaId,
              dateReceived: new Date(), dateCleared: new Date(),
              memo: "Worker online payment", details: {
                provider: "stripe", paymentAttemptId: attempt.id,
                providerIntentRef: providerRef,
                proposedAllocation: [{ eaId: attempt.ledgerEaId, amount: attempt.amount, statementYmd: "" }],
              },
            } as any);
            await triggerPaymentChargePlugins(createdPayment);
            return true;
          });
          if (!posted) {
            return res.json({ received: true, duplicate: true });
          }
        }
      }
      return res.json({ received: true, ...(newlyRecorded ? {} : { duplicate: true }) });
    } catch (e) {
      return error(res, 400, e instanceof Error ? e.message : "Invalid webhook");
    }
  });
}

class PaymentAttemptConflictError extends Error {}