import type { Express, Request, Response } from "express";
import { checkAccessInline } from "../../services/access-policy-evaluator";
import { storage } from "../../storage";
import { resolveGateway } from "./payment-gateway-context";
import { triggerPaymentChargePlugins } from "./payments";
import { randomUUID } from "node:crypto";
import { paymentEventMatchesAmount, selectFinancialPaymentType, shouldApplyPaymentEvent } from "./payment-attempt-state";
import { getEffectiveUser } from "../masquerade";
import { createUnifiedOptionsStorage } from "../../storage/unified-options";
import { runInTransaction } from "../../storage/transaction-context";
import { getComponentChecker } from "../../services/access-policy-evaluator";
import { getCurrency } from "@shared/currency";

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

type WorkerPayableAccount = {
  eaId: string;
  accountId: string;
  accountName: string;
  currencyCode: string;
  gatewayConfigId: string | null;
  eligible: boolean;
  error?: string;
};

type AccountEligibility =
  | {
      eligible: true;
      resolved: Awaited<ReturnType<typeof resolveGateway>>;
      paymentType: { id: string };
      createPaymentIntent: NonNullable<
        Awaited<ReturnType<typeof resolveGateway>>["plugin"]["createPaymentIntent"]
      >;
    }
  | { eligible: false; error: string };

function parseStoredMoney(
  value: unknown,
  label: string,
  options: { nonNegative?: boolean; allowNumber?: boolean } = {},
): number {
  const validString =
    typeof value === "string" &&
    value.trim().length > 0 &&
    value === value.trim() &&
    /^-?\d+(?:\.\d{1,2})?$/.test(value);
  const validNumber =
    options.allowNumber === true &&
    typeof value === "number" &&
    Number.isFinite(value);
  if (!validString && !validNumber) {
    throw new PaymentAttemptConflictError(
      `${label} is unavailable because its stored amount is invalid`,
    );
  }
  const amount = Number(value);
  if (!Number.isFinite(amount) || (options.nonNegative && amount < 0)) {
    throw new PaymentAttemptConflictError(
      `${label} is unavailable because its stored amount is invalid`,
    );
  }
  return amount;
}

async function getAccountEligibility(account: {
  isActive: boolean;
  currencyCode: string;
  gatewayConfigId: string | null;
}): Promise<AccountEligibility> {
  if (!account.isActive) {
    return { eligible: false, error: "This ledger account is inactive" };
  }
  const currency = getCurrency(account.currencyCode);
  if (!currency || currency.precision !== 2) {
    return {
      eligible: false,
      error: `Online worker payments do not support ${account.currencyCode} accounts`,
    };
  }
  if (!account.gatewayConfigId) {
    return {
      eligible: false,
      error: "This ledger account does not have a payment gateway configured",
    };
  }
  let resolved: Awaited<ReturnType<typeof resolveGateway>>;
  try {
    resolved = await resolveGateway(account.gatewayConfigId);
    await assertGatewayReadyForCharge(resolved);
    const createPaymentIntent = resolved.plugin.createPaymentIntent;
    if (!createPaymentIntent) {
      return {
        eligible: false,
        error: "This payment gateway does not support online payments",
      };
    }
    const paymentType = selectFinancialPaymentType(
      await options.list("ledger-payment-type"),
      account.currencyCode,
    );
    if (paymentType) {
      return { eligible: true, resolved, paymentType, createPaymentIntent };
    }
    return {
      eligible: false,
      error: `No financial ledger payment type is configured for ${account.currencyCode}`,
    };
  } catch (cause) {
    return {
      eligible: false,
      error: cause instanceof Error ? cause.message : "Payment gateway unavailable",
    };
  }
}

async function listWorkerPayableAccounts(workerId: string): Promise<WorkerPayableAccount[]> {
  const eas = await storage.ledger.ea.getByEntityWithBalance("worker", workerId);
  return Promise.all(eas.map(async (ea) => {
    const account = await storage.ledger.accounts.get(ea.accountId);
    if (!account) {
      return {
        eaId: ea.id,
        accountId: ea.accountId,
        accountName: "Unknown account",
        currencyCode: "USD",
        gatewayConfigId: null,
        eligible: false,
        error: "Ledger account not found",
      };
    }
    const eligibility = await getAccountEligibility(account);
    return {
      eaId: ea.id,
      accountId: account.id,
      accountName: account.name,
      currencyCode: account.currencyCode,
      gatewayConfigId: account.gatewayConfigId,
      eligible: eligibility.eligible,
      ...(eligibility.eligible ? {} : { error: eligibility.error }),
    };
  }));
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
      if (!ea) return error(res, 409, "No ledger account is configured for this worker");
      if (ea.entityType !== "worker" || ea.entityId !== workerId) return error(res, 403, "Ledger account does not belong to this worker");
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
      const account = await storage.ledger.accounts.get(ea.accountId);
      if (!account) return error(res, 409, "Ledger account configuration not found");
      const currency = account.currencyCode;
      const eligibility = await getAccountEligibility(account);
      if (!eligibility.eligible) return error(res, 409, eligibility.error);
      if (account.gatewayConfigId !== method.gatewayConfigId) {
        return error(res, 409, "Payment method is not enabled for this ledger account");
      }
      const { resolved, paymentType, createPaymentIntent } = eligibility;
      const methodSummary = await resolved.plugin.getMethodSummary(resolved.context, method.paymentMethod);
      if (methodSummary.type !== "card" && methodSummary.type !== "us_bank_account") {
        return error(res, 400, "This payment method cannot be used for worker payments");
      }
      const customer = await storage.ledger.gatewayCustomers.get("worker", workerId, method.gatewayConfigId);
      if (!customer) return error(res, 409, "Payment customer is not configured");
      const { dbUser } = await getEffectiveUser(req.session as any, req.user as any);
      const attempt = await runInTransaction(async () => {
        await storage.ledger.paymentAttempts.lockEa(ea.id);
        await storage.ledger.paymentAttempts.expireReservations(ea.id);
        const balance = parseStoredMoney(
          await storage.ledger.ea.getBalance(ea.id),
          "Payable balance",
        );
        const reserved = parseStoredMoney(
          await storage.ledger.paymentAttempts.getReservedAmount(ea.id),
          "Reserved payment amount",
          { nonNegative: true, allowNumber: true },
        );
        if (Number(amount) > balance - reserved + 0.0001) {
          throw new PaymentAttemptConflictError("Payment amount exceeds the available balance");
        }
        return storage.ledger.paymentAttempts.create({
          workerId, ledgerEaId: ea.id, gatewayConfigId: method.gatewayConfigId,
          accountId: account.id, entityType: "worker", entityId: workerId,
          createdByUserId: dbUser?.id ?? null,
          createdAt: new Date(), updatedAt: new Date(),
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
        const intent = await createPaymentIntent(resolved.context, {
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
    if (!attempt.workerId || !(await assertWorker(req, attempt.workerId))) return error(res, 403, "Access denied");
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

  app.get("/api/workers/:workerId/ledger/payable-accounts", requireAuth, async (req, res) => {
    try {
      if (!(await assertWorker(req, req.params.workerId))) return error(res, 403, "Access denied");
      return res.json(await listWorkerPayableAccounts(req.params.workerId));
    } catch (cause) {
      return error(
        res,
        500,
        cause instanceof Error ? cause.message : "Failed to load payable accounts",
      );
    }
  });

  app.get("/api/workers/:workerId/ledger/payable", requireAuth, async (req, res) => {
    try {
      if (!(await assertWorker(req, req.params.workerId))) return error(res, 403, "Access denied");
      const hasEaId = Object.prototype.hasOwnProperty.call(req.query, "eaId");
      if (
        hasEaId &&
        (typeof req.query.eaId !== "string" ||
          !req.query.eaId.trim() ||
          req.query.eaId !== req.query.eaId.trim())
      ) {
        return error(res, 400, "eaId must be a non-empty ledger account entry id");
      }
      const requestedEaId = hasEaId ? req.query.eaId as string : undefined;
      let ea;
      if (requestedEaId) {
        ea = await storage.ledger.ea.get(requestedEaId);
        if (!ea) return error(res, 404, "Ledger account entry not found");
        if (ea.entityType !== "worker" || ea.entityId !== req.params.workerId) {
          return error(res, 403, "Ledger account does not belong to this worker");
        }
      } else {
        const eas = await storage.ledger.ea.getByEntity("worker", req.params.workerId);
        if (eas.length === 0) return error(res, 409, "No ledger account is configured for this worker");
        if (eas.length > 1) {
          return error(res, 400, "eaId is required when a worker has multiple ledger accounts");
        }
        ea = eas[0];
      }
      const account = await storage.ledger.accounts.get(ea.accountId);
      if (!account) return error(res, 409, "Ledger account configuration not found");
      const eligibility = await getAccountEligibility(account);
      if (!eligibility.eligible) return error(res, 409, eligibility.error);
      const balance = await storage.ledger.ea.getBalance(ea.id);
      const balanceAmount = parseStoredMoney(balance, "Payable balance");
      const reservedAmount = parseStoredMoney(
        await storage.ledger.paymentAttempts.getReservedAmount(ea.id),
        "Reserved payment amount",
        { nonNegative: true, allowNumber: true },
      );
      const availableBalance = Math.max(0, balanceAmount - reservedAmount);
      return res.json({
        eaId: ea.id,
        accountId: account.id,
        accountName: account.name,
        balance,
        currencyCode: account.currencyCode,
        availableBalance: availableBalance.toFixed(2),
        reservedAmount: reservedAmount.toFixed(2),
        gatewayConfigId: account.gatewayConfigId,
      });
    } catch (cause) {
      if (cause instanceof PaymentAttemptConflictError) {
        return error(res, 409, cause.message);
      }
      return error(
        res,
        500,
        cause instanceof Error ? cause.message : "Failed to load payable balance",
      );
    }
  });

  app.post("/api/ledger/payment-gateways/:gatewayConfigId/webhook", async (req, res) => {
    const body = raw(req);
    if (!body) return error(res, 400, "Signed raw webhook body is required");
    let receivedEventId: string | undefined;
    try {
      const resolved = await resolveGateway(req.params.gatewayConfigId, { allowDisabled: true });
      if (!resolved.plugin.verifyWebhook) {
        return error(res, 404, "This payment gateway does not accept webhooks");
      }
      const headers = Object.fromEntries(Object.entries(req.headers)
        .filter((entry): entry is [string, string] => typeof entry[1] === "string"));
      const event = resolved.plugin.verifyWebhook(resolved.context, body, headers);
      const object = (event.payload ?? {}) as Record<string, unknown>;
      const metadata = (object.metadata ?? {}) as Record<string, unknown>;
      const attemptId = typeof metadata.attemptId === "string" ? metadata.attemptId : undefined;
      const providerRef = event.providerRef;
      const metadataAttempt = attemptId
        ? await storage.ledger.paymentAttempts.get(attemptId) : undefined;
      const attempt = metadataAttempt ?? (providerRef
        ? await storage.ledger.paymentAttempts.getByProviderIntent(providerRef, req.params.gatewayConfigId) : undefined);
      // Keep only reconciliation fields, never the raw provider object (which
      // may contain a client secret, billing details or free-form metadata).
      const newlyRecorded = await storage.ledger.paymentAttempts.recordEvent({
        gatewayConfigId: req.params.gatewayConfigId,
        attemptId: attempt?.gatewayConfigId === req.params.gatewayConfigId ? attempt.id : null,
        providerEventId: event.eventId, eventType: event.providerEventType,
        providerCreated: event.providerCreated ?? null,
        payload: {
          type: event.type, providerRef, amountMinor: event.amountMinor,
          currency: event.currency, methodRef: event.methodRef,
        },
      });
      receivedEventId = event.eventId;
      const complete = async () => storage.ledger.paymentAttempts.completeEvent(
        req.params.gatewayConfigId, event.eventId,
      );
      if (event.type === "unsupported") {
        await complete();
        return res.json({ received: true });
      }
      if (!attempt) {
        // The provider may beat the create response that stores its reference.
        // Retain this as unfinished for replay/reconciliation, not completed.
        await storage.ledger.paymentAttempts.completeEvent(
          req.params.gatewayConfigId, event.eventId, "Payment attempt not found",
        );
        return res.json({ received: true });
      }
      if (attempt.gatewayConfigId !== req.params.gatewayConfigId) {
        throw new Error("Webhook event does not belong to this payment gateway");
      }
      if (!providerRef) {
        throw new Error("Webhook event does not identify a provider payment");
      }
      if (attempt.providerIntentRef && attempt.providerIntentRef !== providerRef) {
        throw new Error("Webhook event does not belong to this payment attempt");
      }
      const status = event.type === "payment.succeeded" ? "succeeded"
        : event.type === "payment.processing" ? "processing"
          : event.type === "payment.failed" ? "failed"
            : event.type === "payment.canceled" ? "canceled" : undefined;
      if (status === "succeeded" && !paymentEventMatchesAmount(attempt, event)) {
        throw new Error("Provider payment amount or currency does not match the payment attempt");
      }
      if (!shouldApplyPaymentEvent(attempt.status, attempt.lastProviderEventCreated, status ?? attempt.status, event.providerCreated)) {
        await complete();
        return res.json({ received: true, stale: true });
      }
      if (status) {
        const updated = await storage.ledger.paymentAttempts.updateStatus(attempt.id, status, {
          providerIntentRef: providerRef ?? attempt.providerIntentRef,
          lastProviderEventCreated: event.providerCreated ?? attempt.lastProviderEventCreated,
          failureCode: event.failureCode,
          failureMessage: status === "failed" ? "Payment failed" : status === "canceled" ? "Payment canceled" : undefined,
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
            throw new Error(`No financial ledger payment type is configured for ${attempt.currency}`);
          }
          const ledgerPaymentId = randomUUID();
          const posted = await runInTransaction(async () => {
            // Serialize duplicate deliveries before inserting the payment.
            // The payment must exist before its immediate FK can be linked.
            await storage.ledger.paymentAttempts.lockAttempt(attempt.id);
            const lockedAttempt = await storage.ledger.paymentAttempts.get(attempt.id);
            if (!lockedAttempt) throw new Error("Payment attempt no longer exists");
            if (lockedAttempt.ledgerPaymentId) {
              return false;
            }
            const createdPayment = await storage.ledger.payments.create({
              id: ledgerPaymentId,
              status: "cleared", allocated: false, amount: attempt.amount,
              paymentType: paymentType.id, ledgerEaId: attempt.ledgerEaId,
              dateReceived: new Date(), dateCleared: new Date(),
              memo: "Worker online payment", details: {
                provider: resolved.plugin.id, paymentAttemptId: attempt.id,
                providerIntentRef: providerRef,
                proposedAllocation: [{ eaId: attempt.ledgerEaId, amount: attempt.amount, statementYmd: "" }],
              },
            } as any);
            if (!(await storage.ledger.paymentAttempts.claimLedgerPosting(attempt.id, ledgerPaymentId))) {
              // Roll back the inserted payment rather than leaving an orphan.
              throw new Error("Payment attempt could not claim ledger posting");
            }
            await triggerPaymentChargePlugins(createdPayment);
            return true;
          });
          if (!posted) {
            await complete();
            return res.json({ received: true, duplicate: true });
          }
        }
      }
      await complete();
      return res.json({ received: true, ...(newlyRecorded ? {} : { duplicate: true }) });
    } catch (e) {
      if (receivedEventId) {
        await storage.ledger.paymentAttempts.completeEvent(
          req.params.gatewayConfigId, receivedEventId,
          e instanceof Error ? e.message : "Webhook processing failed",
        );
      }
      return error(res, receivedEventId ? 500 : 400, receivedEventId ? "Webhook processing failed" : "Invalid webhook");
    }
  });
}

class PaymentAttemptConflictError extends Error {}