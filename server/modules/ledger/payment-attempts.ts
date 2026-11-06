import type { Express, Request, Response } from "express";
import { checkAccessInline } from "../../services/access-policy-evaluator";
import { storage } from "../../storage";
import { resolveGateway } from "./payment-gateway-context";
import { selectFinancialPaymentType } from "./payment-attempt-state";
import { getEffectiveUser } from "../masquerade";
import { createUnifiedOptionsStorage } from "../../storage/unified-options";
import { runInTransaction } from "../../storage/transaction-context";
import { getComponentChecker } from "../../services/access-policy-evaluator";
import { getCurrency } from "@shared/currency";
import {
  assertAdminTestPaymentAuthority,
  assertAdminPaymentAuthority,
  assertOnlinePaymentAuthority,
  OnlinePaymentAuthorityError,
} from "./online-payment-authority";
import { onlinePaymentSettingsSchema, onlinePaymentAuthorizationTextsSchema, ONLINE_PAYMENT_AUTHORIZATION_VARIABLE } from "@shared/ledger/online-payments";
import { z } from "zod";
import { calculateCheckoutSelection, type CheckoutSelectionInput } from "@shared/ledger/checkout-selection";
import { enforceFloodLimit, FloodError } from "../../flood/service";
import { CHECKOUT_FLOOD_EVENT } from "../../flood/events";
import { PaymentCancellationError, PaymentInitiationRejected } from "../../plugins/ledger/payment-gateway/types";
import { checkoutPaymentTypes, initiatePayment } from "./payment-initiation";
import { ensureCustomer } from "./payment-methods";
import { processPaymentEvidence, evidenceFromPayment, settlementError, logSettlementFailure, SettlementRefusal } from "./payment-settlement";
import { CHECKOUT_SAVE_METHOD_CONSENT } from "@shared/ledger/checkout-save-consent";
import { ADMIN_PAYMENT_CONFIRMATION } from "@shared/ledger/admin-payment-confirmation";
import { adminPaymentGatewayFingerprint, assertAdminPaymentGateway, assertAdminAssistedPaymentProvenance } from "./admin-assisted-payment";

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
    // The historical contract cannot carry checkout consent, invoice
    // selections, or the provider method identity needed for an idempotent
    // session. Do not allow it to bypass the canonical checkout invariants.
    // Clients must use /api/ledger/checkout/.../sessions.
    return error(res, 410, "Legacy payment intent endpoint retired; use ledger checkout sessions");
    /*
    try {
      const { workerId, paymentMethodId, eaId, amount, idempotencyKey } = req.body ?? {};
      if (!workerId || !paymentMethodId || !eaId || !idempotencyKey || !/^\d+(?:\.\d{1,2})?$/.test(String(amount)) || Number(amount) <= 0) {
        return error(res, 400, "workerId, eaId, paymentMethodId, amount, and idempotencyKey are required");
      }
       try { await assertOnlinePaymentAuthority(req, "worker", workerId, "pay"); }
       catch (e) { if (e instanceof OnlinePaymentAuthorityError) return error(res, 403, e.message); throw e; }
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
    */
  };
  app.post("/api/ledger/payment-attempts", requireAuth, createAttempt);
  app.get("/api/ledger/payment-attempts/:attemptId", requireAuth, async (req, res) => {
    const attempt = await storage.ledger.paymentAttempts.get(req.params.attemptId);
    if (!attempt) return error(res, 404, "Payment attempt not found");
    if (!attempt.workerId) return error(res, 403, "Access denied");
    try {
      const actor = await assertOnlinePaymentAuthority(req, "worker", attempt.workerId, "pay");
      if (!attempt.createdByUserId || actor !== attempt.createdByUserId) return error(res, 403, "Only the checkout creator can view this payment");
    } catch (e) { if (e instanceof OnlinePaymentAuthorityError) return error(res, 403, e.message); throw e; }
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

  // Provider-generic checkout contract. Consent and invoice selections are
  // copied into the attempt row before calling the provider.
  const checkoutEntity = z.enum(["worker", "employer"]);
  const checkoutBody = z.object({
    amount: z.union([z.string(), z.number()]),
    selection: z.object({
      mode: z.enum(["full", "statements"]),
      invoiceNumbers: z.array(z.string().trim().min(1)).max(500),
    }).strict(),
    creditTransfers: z.array(z.object({
      sourceInvoiceNumber: z.string(), sourceStatementYmd: z.string(),
      targetInvoiceNumber: z.string(), targetStatementYmd: z.string(),
      amount: z.string(),
    }).strict()).max(1000).default([]),
    idempotencyKey: z.string().trim().min(1).max(200),
    paymentMethodId: z.string().trim().min(1).optional(),
    paymentMethodType: z.enum(["card", "us_bank_account"]).optional(),
    saveMethod: z.boolean().default(false),
    saveMethodConsent: z.object({
      version: z.string().trim().min(1),
      text: z.string().trim().min(1),
      accepted: z.literal(true),
    }).strict().optional(),
    consent: z.object({ version: z.string().trim().min(1), text: z.string().trim().min(1), accepted: z.literal(true) }).strict(),
    statementSelection: z.array(z.object({
      invoiceNumber: z.string().trim().min(1),
      amount: z.union([z.string(), z.number()]),
    }).strict()).max(500).default([]),
  }).strict();
  const adminTestCheckoutBody = checkoutBody.omit({ consent: true }).extend({
    adminTestConfirmation: z.literal(true),
    purpose: z.string().trim().min(1).max(500),
  }).strict();
  const adminCheckoutBody = checkoutBody.omit({ consent: true }).extend({
    adminConfirmation: z.object({
      version: z.literal(ADMIN_PAYMENT_CONFIRMATION.version),
      text: z.literal(ADMIN_PAYMENT_CONFIRMATION.text),
      accepted: z.literal(true),
    }).strict(),
  }).strict();
  const safeAttempt = (a: any, extra: Record<string, unknown> = {}) => ({
    id: a.id, entityType: a.entityType, entityId: a.entityId, eaId: a.ledgerEaId,
    amount: a.amount, currency: a.currency, status: a.status,
    canCancel: a.status === "created" && !!a.providerIntentRef && !a.ledgerPaymentId,
    ledgerPaymentId: a.ledgerPaymentId ?? null,
    statementSelection: a.statementSelection ?? [],
    creditTransfers: a.metadata?.checkoutQuote?.creditTransfers ?? [],
    isAdminTest: a.metadata?.adminTest?.isAdminTest === true,
    adminTestPurpose: a.metadata?.adminTest?.purpose ?? null,
    isAdminAssisted: a.metadata?.source === "admin_assisted_checkout",
    failureMessage: a.status === "failed" ? a.failureMessage : null, ...extra,
  });
  const receipt = async (a: any) => {
    const payment = a.ledgerPaymentId ? await storage.ledger.payments.get(a.ledgerPaymentId) : null;
    return safeAttempt(a, {
      paymentStatus: payment?.status ?? null,
      dateReceived: payment?.dateReceived ?? null,
      dateCleared: payment?.dateCleared ?? null,
    });
  };
  const safePublicConfig = (config: Record<string, unknown>) => Object.fromEntries(
    Object.entries(config).filter(([key]) => ["publishableKey", "paymentTypes", "clientMode"].includes(key)),
  );
  const authorizeCheckout = async (req: Request, res: Response) => {
    const entityType = checkoutEntity.safeParse(req.params.entityType);
    if (!entityType.success) { error(res, 400, "Unsupported entity type"); return null; }
    try { return await assertOnlinePaymentAuthority(req, entityType.data, req.params.entityId, "pay"); }
    catch (e) { if (e instanceof OnlinePaymentAuthorityError) { error(res, 403, e.message); return null; } throw e; }
  };
  const loadCheckout = async (entityType: string, entityId: string, eaId?: string) => {
    const eas = eaId ? [await storage.ledger.ea.get(eaId)] : await storage.ledger.ea.getByEntity(entityType, entityId);
    const ea = eas.find((x: any) => x && (!eaId || x.id === eaId) && x.entityType === entityType && x.entityId === entityId);
    if (!ea) throw new PaymentAttemptConflictError("Ledger account entry not found");
    const account = await storage.ledger.accounts.get(ea.accountId);
    if (!account || !account.isActive) throw new PaymentAttemptConflictError("Ledger account is unavailable");
    const currency = getCurrency(account.currencyCode);
    if (!currency || currency.precision !== 2) throw new PaymentAttemptConflictError(`Online checkout does not support ${account.currencyCode} accounts`);
    const settings = onlinePaymentSettingsSchema.parse((account.data as any)?.onlinePayments ?? {});
    if (!settings.enabled || !settings.payerTypes.includes(entityType as any)) throw new PaymentAttemptConflictError("Online checkout is not enabled");
    if (!account.gatewayConfigId) throw new PaymentAttemptConflictError("Payment gateway is not configured");
    const resolved = await resolveGateway(account.gatewayConfigId);
    await assertGatewayReadyForCharge(resolved);
    if (!resolved.plugin.createPaymentSession || !resolved.plugin.retrievePayment || !resolved.plugin.cancelPayment) throw new PaymentAttemptConflictError("Payment gateway does not support checkout");
    return { ea, account, settings, resolved };
  };
  const assertAdminTestGateway = (resolved: Awaited<ReturnType<typeof resolveGateway>>) => {
    if (resolved.plugin.isTestMode?.(resolved.context) !== true) {
      throw new PaymentAttemptConflictError(
        "Admin test payments are available only when this gateway positively confirms test mode",
      );
    }
  };
  const selectionInput = async (loaded: Awaited<ReturnType<typeof loadCheckout>>): Promise<CheckoutSelectionInput> => {
    const balance = parseStoredMoney(await storage.ledger.ea.getBalance(loaded.ea.id), "Balance");
    const reservations = await storage.ledger.paymentAttempts.getReservations(loaded.ea.id);
    const reserved = reservations.reduce((sum, row) => sum + Math.round(parseStoredMoney(row.amount, "Pending payment", { nonNegative: true }) * 100), 0);
    return {
      balance: balance.toFixed(2), reserved: (reserved / 100).toFixed(2),
      invoices: await storage.ledger.invoices.listForEa(loaded.ea.id),
      // Do not expose provider references, consent, actor IDs or method metadata.
      reservations: reservations.map(row => ({
        amount: row.amount, statementSelection: row.statementSelection,
        metadata: { invoicePeriods: (row.metadata as any)?.invoicePeriods,
          checkoutQuote: (row.metadata as any)?.checkoutQuote
          ? { unstatementedAmount: (row.metadata as any).checkoutQuote.unstatementedAmount,
              creditTransfers: (row.metadata as any).checkoutQuote.creditTransfers,
              statements: (row.metadata as any).checkoutQuote.statements } : undefined },
      })),
      allowPartial: loaded.settings.allowPartial, minAmount: loaded.settings.minAmount,
    };
  };
  const ownedPending = async (eaId: string, userId: string, source?: string) =>
    (await storage.ledger.paymentAttempts.getReservations(eaId))
      .filter(row => row.createdByUserId === userId && (!source || (row.metadata as any)?.source === source))
      .map(row => ({
        id: row.id, amount: row.amount, currency: row.currency, status: row.status,
        canCancel: row.status === "created" && !!row.providerIntentRef && !row.ledgerPaymentId,
      }));
  app.get("/api/ledger/pay-accounts/:entityType/:entityId", requireAuth, async (req, res) => {
    const userId = await authorizeCheckout(req, res); if (!userId) return;
    try {
      const eas = await storage.ledger.ea.getByEntity(req.params.entityType, req.params.entityId);
      const result = [];
      for (const ea of eas) {
        try {
          const { account, settings } = await loadCheckout(req.params.entityType, req.params.entityId, ea.id);
          const balance = parseStoredMoney(await storage.ledger.ea.getBalance(ea.id), "Balance");
          const reserved = parseStoredMoney(await storage.ledger.paymentAttempts.getReservedAmount(ea.id), "Reserved amount", { nonNegative: true, allowNumber: true });
           result.push({ eaId: ea.id, accountId: account.id, accountName: account.name, currency: account.currencyCode, gatewayConfigId: account.gatewayConfigId, balance: balance.toFixed(2), available: Math.max(0, balance - reserved).toFixed(2), settings, pendingCheckouts: await ownedPending(ea.id, userId) });
        } catch { /* ineligible accounts are not exposed */ }
      }
      return res.json(result);
    } catch (e) { return error(res, 500, e instanceof Error ? e.message : "Failed to load payment accounts"); }
  });
  app.get("/api/ledger/checkout/:entityType/:entityId/:eaId", requireAuth, async (req, res) => {
    const userId = await authorizeCheckout(req, res); if (!userId) return;
    try {
      const loaded = await loadCheckout(req.params.entityType, req.params.entityId, req.params.eaId);
      const auth = await storage.variables.getByName(ONLINE_PAYMENT_AUTHORIZATION_VARIABLE);
      const authorization = onlinePaymentAuthorizationTextsSchema.safeParse(auth?.value);
      const input = await runInTransaction(async () => {
        await storage.ledger.paymentAttempts.lockEa(loaded.ea.id);
        return selectionInput(loaded);
      });
      const quote = calculateCheckoutSelection(input, { mode: "full", invoiceNumbers: [] });
      let methodPermission = true;
      try { await assertOnlinePaymentAuthority(req, req.params.entityType as "worker" | "employer", req.params.entityId, "methods"); }
      catch (e) { if (e instanceof OnlinePaymentAuthorityError) methodPermission = false; else throw e; }
      const reusable = !!loaded.resolved.plugin.attachMethod;
      const paymentTypes = checkoutPaymentTypes(loaded.resolved, loaded.settings.paymentTypes ?? ["card", "us_bank_account"]);
      return res.json({
        entityType: req.params.entityType, entityId: req.params.entityId, eaId: loaded.ea.id,
        account: { id: loaded.account.id, name: loaded.account.name, currency: loaded.account.currencyCode, gatewayConfigId: loaded.account.gatewayConfigId },
        balance: input.balance, reserved: input.reserved, available: quote.available,
        invoices: input.invoices, selectionInput: input, quote,
        pendingCheckouts: await ownedPending(loaded.ea.id, userId),
        readiness: {
          paymentAuthorization: authorization.success ? "ready" : "configuration_required",
          methodPermission: methodPermission ? "allowed" : "denied",
          reusableMethods: reusable ? "supported" : "unsupported",
          saveMethod: !methodPermission ? "permission_denied" : !authorization.success ? "configuration_required" : !reusable ? "provider_unsupported" : "ready",
        },
        paymentTypes, payComponentId: loaded.resolved.plugin.payComponentId ?? null,
        reusableMethodsSupported: reusable,
        settings: loaded.settings,
        authorization: authorization.success
          ? authorization.data[req.params.entityType === "worker" ? "consumer" : "business"]
          : null,
      });
    } catch (e) { return error(res, e instanceof PaymentAttemptConflictError ? 409 : 500, e instanceof Error ? e.message : "Checkout unavailable"); }
  });
  const adminPreview = (adminAssisted: boolean) => async (req: Request, res: Response) => {
    const entityType = checkoutEntity.safeParse(req.params.entityType);
    if (!entityType.success) return error(res, 400, "Unsupported entity type");
    if (adminAssisted && entityType.data !== "worker") return error(res, 400, "Administrator payments on behalf are available for workers only");
    try {
      const actorId = await (adminAssisted ? assertAdminPaymentAuthority(req) : assertAdminTestPaymentAuthority(req));
      const loaded = await loadCheckout(entityType.data, req.params.entityId, req.params.eaId);
      if (!adminAssisted) assertAdminTestGateway(loaded.resolved);
      const input = await runInTransaction(async () => {
        await storage.ledger.paymentAttempts.lockEa(loaded.ea.id);
        return selectionInput(loaded);
      });
      const quote = calculateCheckoutSelection(input, { mode: "full", invoiceNumbers: [] });
      const paymentTypes = checkoutPaymentTypes(loaded.resolved, loaded.settings.paymentTypes ?? ["card", "us_bank_account"]);
      return res.json({
        entityType: entityType.data, entityId: req.params.entityId, eaId: loaded.ea.id,
        account: { id: loaded.account.id, name: loaded.account.name, currency: loaded.account.currencyCode, gatewayConfigId: loaded.account.gatewayConfigId },
        balance: input.balance, reserved: input.reserved, available: quote.available,
        invoices: input.invoices, selectionInput: input, quote,
        pendingCheckouts: await ownedPending(loaded.ea.id, actorId, adminAssisted ? "admin_assisted_checkout" : "admin_test_checkout"),
        readiness: { paymentAuthorization: adminAssisted ? "admin_assisted" : "admin_test", methodPermission: "denied",
          reusableMethods: "unsupported", saveMethod: "permission_denied" },
        paymentTypes, payComponentId: loaded.resolved.plugin.payComponentId ?? null,
        reusableMethodsSupported: false, settings: loaded.settings,
        ...(adminAssisted
          ? { isAdminAssisted: true, adminConfirmation: ADMIN_PAYMENT_CONFIRMATION }
          : { isAdminTest: true, testMode: true }),
      });
    } catch (e) {
      return error(res, e instanceof OnlinePaymentAuthorityError ? 403 : e instanceof PaymentAttemptConflictError ? 409 : 500,
        e instanceof OnlinePaymentAuthorityError || e instanceof PaymentAttemptConflictError ? e.message : "Administrator checkout could not be loaded. Retry or ask support to check this account's payment configuration.");
    }
  };
  app.get("/api/ledger/admin-test-checkout/:entityType/:entityId/:eaId", requireAuth, adminPreview(false));
  app.get("/api/ledger/admin-checkout/:entityType/:entityId/:eaId", requireAuth, adminPreview(true));

  const createCheckoutSession = async (req: Request, res: Response, mode: "payer" | "admin_test" | "admin_assisted" = "payer") => {
    const adminTest = mode === "admin_test";
    const adminAssisted = mode === "admin_assisted";
    const adminCheckout = adminTest || adminAssisted;
    const description = adminTest ? "Admin test payment" : adminAssisted ? "Administrator payment on behalf of worker" : "Ledger payment";
    const providerMetadata: Record<string, string> = adminTest ? { paymentPurpose: "admin_test" } : adminAssisted ? { paymentPurpose: "admin_assisted" } : {};
    let userId: string;
    try {
      if (adminCheckout) {
        if (adminAssisted && req.params.entityType !== "worker") return error(res, 400, "Administrator payments on behalf are available for workers only");
        userId = await (adminAssisted ? assertAdminPaymentAuthority(req) : assertAdminTestPaymentAuthority(req));
      } else {
        const authorized = await authorizeCheckout(req, res);
        if (!authorized) return;
        userId = authorized;
      }
      const parsed = adminTest ? adminTestCheckoutBody.parse(req.body) : adminAssisted ? adminCheckoutBody.parse(req.body) : checkoutBody.parse(req.body);
      const body = parsed as z.infer<typeof checkoutBody> & {
        adminTestConfirmation?: true;
        purpose?: string;
        adminConfirmation?: typeof ADMIN_PAYMENT_CONFIRMATION & { accepted: true };
      };
      if (body.paymentMethodId ? body.paymentMethodType !== undefined : !body.paymentMethodType) {
        return error(res, 400, "Choose exactly one saved method or new payment type");
      }
      if (body.saveMethod !== !!body.saveMethodConsent ||
          (body.saveMethodConsent && (body.saveMethodConsent.version !== CHECKOUT_SAVE_METHOD_CONSENT.version ||
            body.saveMethodConsent.text !== CHECKOUT_SAVE_METHOD_CONSENT.text)) ||
          (body.saveMethod && (body.paymentMethodId ||
            !["card", "us_bank_account"].includes(body.paymentMethodType ?? "")))) {
        return error(res, 400, "Saving a payment method requires separate save consent for a new card or US bank account");
      }
      if (adminTest && (body.paymentMethodId || body.saveMethod || body.adminTestConfirmation !== true || !body.purpose)) {
        return error(res, 400, "Admin test checkout requires a new method, purpose, and explicit test confirmation");
      }
      if (adminAssisted && (body.paymentMethodId || body.saveMethod || body.saveMethodConsent)) {
        return error(res, 400, "Administrator checkout uses a new payment method for this payment only; saved methods cannot be used or stored");
      }
      const amountText = String(body.amount);
      if (!/^\d+(?:\.\d{1,2})?$/.test(amountText)) return error(res, 400, "amount must be a currency value");
      const cents = Math.round(Number(amountText) * 100);
      if (!Number.isSafeInteger(cents) || cents <= 0 || cents > 9999999999) return error(res, 400, "Amount is outside the supported range");
      const loaded = await loadCheckout(req.params.entityType, req.params.entityId, req.params.eaId);
      if (adminTest) assertAdminTestGateway(loaded.resolved);
      if (body.saveMethod) {
        try {
          await assertOnlinePaymentAuthority(req, req.params.entityType as "worker" | "employer", req.params.entityId, "methods");
        } catch (e) {
          if (e instanceof OnlinePaymentAuthorityError) return error(res, 403, e.message);
          throw e;
        }
        if (!loaded.resolved.plugin.attachMethod) return error(res, 409, "Payment gateway does not support reusable methods");
      }
      const existing = await storage.ledger.paymentAttempts.getByIdempotencyKey(body.idempotencyKey);
      if (existing) {
        if (["expired", "canceled", "failed"].includes(existing.status) ||
            (!existing.providerIntentRef && existing.reservationExpiresAt &&
             new Date(existing.reservationExpiresAt).getTime() <= Date.now())) {
          return error(res, 409, "This checkout attempt has ended; start a new checkout");
        }
        const existingConsent = existing.consent && typeof existing.consent === "object" ? existing.consent as Record<string, unknown> : {};
        const existingMetadata = existing.metadata && typeof existing.metadata === "object" ? existing.metadata as Record<string, unknown> : {};
        const existingSaveConsent = existingMetadata.saveMethodConsent && typeof existingMetadata.saveMethodConsent === "object"
          ? existingMetadata.saveMethodConsent as Record<string, unknown> : null;
        const existingAdminTest = existingMetadata.adminTest && typeof existingMetadata.adminTest === "object"
          ? existingMetadata.adminTest as Record<string, unknown> : {};
        const existingAdminAssisted = assertAdminAssistedPaymentProvenance(existing);
        if (existing.entityType !== req.params.entityType || existing.entityId !== req.params.entityId ||
            existing.ledgerEaId !== req.params.eaId || Math.round(Number(existing.amount) * 100) !== cents ||
            existing.saveMethod !== body.saveMethod ||
            (body.saveMethod && (existingSaveConsent?.version !== body.saveMethodConsent?.version ||
              existingSaveConsent?.text !== body.saveMethodConsent?.text ||
              existingSaveConsent?.accepted !== true)) ||
            existing.gatewayConfigId !== loaded.account.gatewayConfigId ||
            existing.createdByUserId !== userId ||
            (adminAssisted !== existingAdminAssisted) ||
            (adminTest
              ? existingAdminTest.isAdminTest !== true || existingAdminTest.actorUserId !== userId || existingAdminTest.purpose !== body.purpose
              : existingAdminTest.isAdminTest === true) ||
            existingMetadata.paymentMethodRef !== (body.paymentMethodId ? (await storage.ledger.paymentMethods.get(body.paymentMethodId))?.providerMethodRef : null) ||
             (body.paymentMethodType !== undefined && JSON.stringify(existingMetadata.paymentTypes) !== JSON.stringify([body.paymentMethodType])) ||
            (!adminCheckout && (existingConsent.version !== body.consent.version || existingConsent.text !== body.consent.text)) ||
            JSON.stringify(existingMetadata.checkoutSelection) !== JSON.stringify({
              mode: body.selection.mode, invoiceNumbers: [...body.selection.invoiceNumbers].sort(),
            }) ||
            JSON.stringify((existingMetadata.checkoutQuote as any)?.creditTransfers ?? []) !== JSON.stringify(body.creditTransfers) ||
            JSON.stringify(existing.statementSelection ?? []) !== JSON.stringify(body.statementSelection)) {
          return error(res, 409, "Idempotency key was already used for a different checkout");
        }
        if (adminAssisted) assertAdminPaymentGateway(existing, loaded.resolved);
        if (!existing.providerIntentRef && ["created", "requires_action", "processing"].includes(existing.status)) {
          const metadata = existing.metadata && typeof existing.metadata === "object" ? existing.metadata as Record<string, unknown> : {};
          const retryMethodRef = typeof metadata.paymentMethodRef === "string" ? metadata.paymentMethodRef : undefined;
           const retryTypes = Array.isArray(metadata.paymentTypes) ? metadata.paymentTypes.filter((x): x is string => typeof x === "string") : [];
           if (retryTypes.length !== 1) return error(res, 409, "Checkout payment type is unavailable; start a new checkout");
          const retryCustomer = retryMethodRef
            ? (await storage.ledger.gatewayCustomers.get(existing.entityType, existing.entityId, existing.gatewayConfigId))?.customerRef
            : existing.saveMethod
              ? await ensureCustomer(existing.entityType, existing.entityId, loaded.resolved)
              : undefined;
          if (retryMethodRef && !retryCustomer) return error(res, 409, "Payment customer is not configured");
          const retry = await initiatePayment(existing, loaded.resolved, {
            sessionId: existing.id, amountMinor: Math.round(Number(existing.amount) * 100),
            currency: existing.currency, customerRef: retryCustomer,
            savedMethodRef: retryMethodRef, saveMethod: existing.saveMethod,
             paymentTypes: retryTypes, description,
             metadata: { attemptId: existing.id, entityType: existing.entityType, entityId: existing.entityId,
               ...providerMetadata },
          });
          const retried = await storage.ledger.paymentAttempts.updateStatus(existing.id, retry.status, { providerIntentRef: retry.providerRef });
          return res.json(safeAttempt(retried ?? existing, { clientSecret: retry.clientSecret, publicConfig: safePublicConfig(retry.publicConfig), providerRef: retry.providerRef }));
        }
        const intent = existing.providerIntentRef ? await loaded.resolved.plugin.retrievePayment!(loaded.resolved.context, existing.providerIntentRef) : undefined;
         return res.json(safeAttempt(existing, { clientSecret: intent?.clientSecret ?? null,
           publicConfig: safePublicConfig({ publishableKey: (loaded.resolved.config.data as any)?.publishableKey, paymentTypes: existingMetadata.paymentTypes }),
           providerRef: existing.providerIntentRef }));
      }
      try { await enforceFloodLimit(CHECKOUT_FLOOD_EVENT, { userId, eaId: loaded.ea.id }); }
      catch (e) { if (e instanceof FloodError) return error(res, 429, "Too many checkout attempts"); /* flood storage is advisory */ }
      let savedMethod: any;
      if (body.paymentMethodId) {
        savedMethod = await storage.ledger.paymentMethods.get(body.paymentMethodId);
        if (!savedMethod || !savedMethod.isActive || savedMethod.entityType !== req.params.entityType ||
            savedMethod.entityId !== req.params.entityId || savedMethod.gatewayConfigId !== loaded.account.gatewayConfigId ||
            !savedMethod.providerMethodRef) return error(res, 400, "Saved payment method is unavailable");
      }
      const paymentTypes = checkoutPaymentTypes(loaded.resolved, loaded.settings.paymentTypes ?? ["card", "us_bank_account"]);
      if (paymentTypes.length === 0) return error(res, 409, "No compatible payment types are configured. Ask an administrator to enable a card or bank account type under Gateway Payment Types and ledger online payment settings.");
      if (body.paymentMethodType && !paymentTypes.includes(body.paymentMethodType)) {
        return error(res, 400, "The selected payment type is not enabled for this account. Refresh checkout and choose an available method.");
      }
      let selectedType = body.paymentMethodType;
      if (savedMethod) {
        const summary = await loaded.resolved.plugin.getMethodSummary(loaded.resolved.context, savedMethod.providerMethodRef);
        if (!paymentTypes.includes(summary.type as typeof paymentTypes[number])) return error(res, 400, "Saved payment method type is not enabled");
        selectedType = summary.type as typeof selectedType;
      }
      const sessionTypes = [selectedType!];
      let selectedText: { version: string; text: string } | null = null;
      if (!adminCheckout) {
        const auth = await storage.variables.getByName(ONLINE_PAYMENT_AUTHORIZATION_VARIABLE);
        const texts = onlinePaymentAuthorizationTextsSchema.safeParse(auth?.value);
        selectedText = texts.success ? texts.data[req.params.entityType === "worker" ? "consumer" : "business"] : null;
        if (!selectedText || body.consent.version !== selectedText.version || body.consent.text !== selectedText.text) {
          return error(res, 400, "Current payment authorization must be accepted");
        }
      }
      const savedCustomer = savedMethod
        ? await storage.ledger.gatewayCustomers.get(req.params.entityType, req.params.entityId, loaded.account.gatewayConfigId!)
        : undefined;
      if (savedMethod && !savedCustomer) return error(res, 409, "Payment customer is not configured");
      const preflight = {
        sessionId: "", amountMinor: cents, currency: loaded.account.currencyCode,
        customerRef: savedCustomer?.customerRef, savedMethodRef: savedMethod?.providerMethodRef,
        saveMethod: body.saveMethod, paymentTypes: sessionTypes,
        description,
        metadata: providerMetadata as Record<string, string>,
      };
      const gatewayFingerprint = adminAssisted ? adminPaymentGatewayFingerprint(loaded.resolved) : undefined;
      // Validate credentials/types before any customer-side provider call.
      // An opted-in new method has no customer yet; session creation below
      // still requires the real customer after ensureCustomer completes.
      loaded.resolved.plugin.validatePaymentSession?.(loaded.resolved.context, preflight, { customerWillBeCreated: body.saveMethod });
      const attempt = await runInTransaction(async () => {
        await storage.ledger.paymentAttempts.lockEa(loaded.ea.id);
        await storage.ledger.paymentAttempts.expireReservations(loaded.ea.id);
        // All authoritative balances and statement reservations are read after
        // the EA lock, not from the earlier preview or request.
        const current = await loadCheckout(req.params.entityType, req.params.entityId, req.params.eaId);
        if (adminTest) assertAdminTestGateway(current.resolved);
        if (adminAssisted && gatewayFingerprint !== adminPaymentGatewayFingerprint(current.resolved)) {
          throw new PaymentAttemptConflictError("Payment gateway credentials changed. Refresh checkout and review the current account before continuing.");
        }
        if (current.account.gatewayConfigId !== loaded.account.gatewayConfigId ||
            current.account.currencyCode !== loaded.account.currencyCode) {
          throw new PaymentAttemptConflictError("Checkout configuration changed. Refresh and review before confirming.");
        }
        const currentTypes = checkoutPaymentTypes(current.resolved, current.settings.paymentTypes ?? ["card", "us_bank_account"]);
        if (sessionTypes.some(type => !currentTypes.includes(type))) {
          throw new PaymentAttemptConflictError("The selected payment type is no longer enabled. Refresh checkout and ask an administrator to check Gateway Payment Types.");
        }
        current.resolved.plugin.validatePaymentSession?.(current.resolved.context, preflight, { customerWillBeCreated: body.saveMethod });
        // Use the configuration re-read at the authoritative boundary for
        // creation too, not the earlier preview-time snapshot.
        loaded.resolved = current.resolved;
        const quote = calculateCheckoutSelection(await selectionInput(current), body.selection);
        if (quote.issues.length) throw new PaymentAttemptConflictError(quote.issues.join(" "));
        if (quote.amountMinor !== cents || JSON.stringify(quote.statementSelection) !== JSON.stringify(body.statementSelection) ||
            JSON.stringify(quote.creditTransfers) !== JSON.stringify(body.creditTransfers)) {
          throw new PaymentAttemptConflictError("Statement balances changed. Review the updated selection before confirming.");
        }
        let currentText: { version: string; text: string } | null = null;
        if (!adminCheckout) {
          const currentAuth = onlinePaymentAuthorizationTextsSchema.safeParse(
            (await storage.variables.getByName(ONLINE_PAYMENT_AUTHORIZATION_VARIABLE))?.value,
          );
          currentText = currentAuth.success ? currentAuth.data[req.params.entityType === "worker" ? "consumer" : "business"] : null;
          if (!currentText || currentText.version !== body.consent.version || currentText.text !== body.consent.text) {
            throw new PaymentAttemptConflictError("Current payment authorization must be accepted");
          }
        }
        return storage.ledger.paymentAttempts.create({
          workerId: req.params.entityType === "worker" ? req.params.entityId : null,
          ledgerEaId: loaded.ea.id, gatewayConfigId: loaded.account.gatewayConfigId!,
          accountId: loaded.account.id, entityType: req.params.entityType, entityId: req.params.entityId,
          createdByUserId: userId, createdAt: new Date(), updatedAt: new Date(), saveMethod: body.saveMethod,
          consent: adminCheckout ? null : {
            ...body.consent, acceptedAt: new Date().toISOString(),
            authorizationVersion: currentText!.version, authorizationText: currentText!.text,
          },
          statementSelection: quote.statementSelection, idempotencyKey: body.idempotencyKey,
          amount: quote.amount, currency: loaded.account.currencyCode, status: "requires_action", reservationExpiresAt: null,
          failureCode: "creation_not_started",
          metadata: { source: adminTest ? "admin_test_checkout" : adminAssisted ? "admin_assisted_checkout" : "online_checkout",
            ...(adminTest ? { adminTest: { isAdminTest: true, actorUserId: userId, purpose: body.purpose,
              confirmedAt: new Date().toISOString() } } : {}),
            ...(adminAssisted ? { adminAssisted: { actorUserId: userId, gatewayFingerprint,
              confirmation: { ...body.adminConfirmation, acceptedAt: new Date().toISOString() } } } : {}),
            paymentMethodRef: savedMethod?.providerMethodRef ?? null, paymentTypes: sessionTypes,
            ...(body.saveMethodConsent ? { saveMethodConsent: {
              ...body.saveMethodConsent,
              acceptedAt: new Date().toISOString(),
              textVersion: body.saveMethodConsent.version,
              authorizationType: "save_payment_method",
            } } : {}),
            checkoutSelection: { mode: body.selection.mode, invoiceNumbers: [...body.selection.invoiceNumbers].sort() },
            checkoutQuote: quote, invoicePeriods: quote.invoicePeriods },
        } as any);
      });
      if ((attempt as any).__created === false) {
        // A competing request inserted the same key after our initial lookup.
        // Never return its provider secret without verifying its full intent.
        return error(res, 409, "Idempotency key was already used; retry this checkout");
      }
      const customerRef = savedCustomer?.customerRef ??
        (body.saveMethod ? await ensureCustomer(req.params.entityType, req.params.entityId, loaded.resolved) : undefined);
       const session = await initiatePayment(attempt, loaded.resolved, {
         sessionId: attempt.id, amountMinor: cents, currency: loaded.account.currencyCode,
         customerRef, savedMethodRef: savedMethod?.providerMethodRef, saveMethod: body.saveMethod,
         paymentTypes: sessionTypes, description,
         metadata: { attemptId: attempt.id, entityType: req.params.entityType, entityId: req.params.entityId,
           ...providerMetadata },
       }, true);
      const updated = await storage.ledger.paymentAttempts.updateStatus(attempt.id, session.status, { providerIntentRef: session.providerRef });
      return res.status(201).json(safeAttempt(updated ?? attempt, { clientSecret: session.clientSecret, publicConfig: safePublicConfig(session.publicConfig), providerRef: session.providerRef }));
    } catch (e) {
      if (e instanceof OnlinePaymentAuthorityError) return error(res, 403, e.message);
      if (adminAssisted && e instanceof z.ZodError) return error(res, 400, "Review the payment selection and accept the administrator authorization before continuing.");
      return error(res, e instanceof z.ZodError ? 400 : e instanceof PaymentAttemptConflictError || e instanceof PaymentInitiationRejected ? 409 : 500,
        adminAssisted && !(e instanceof PaymentAttemptConflictError || e instanceof PaymentInitiationRejected)
          ? "Could not start the payment. Check your unfinished payment status before trying again; contact support if its outcome is unknown."
          : e instanceof Error ? e.message : "Checkout session failed");
    }
   };
  app.post("/api/ledger/checkout/:entityType/:entityId/:eaId/sessions", requireAuth,
    (req, res) => createCheckoutSession(req, res));
  app.post("/api/ledger/admin-test-checkout/:entityType/:entityId/:eaId/sessions", requireAuth,
    (req, res) => createCheckoutSession(req, res, "admin_test"));
  app.post("/api/ledger/admin-checkout/:entityType/:entityId/:eaId/sessions", requireAuth,
    (req, res) => createCheckoutSession(req, res, "admin_assisted"));

  const checkoutStatus = async (req: Request, res: Response, cancel: boolean, mode: "payer" | "admin_test" | "admin_assisted" = "payer") => {
    const adminTest = mode === "admin_test";
    const adminAssisted = mode === "admin_assisted";
    try {
      const attempt = await storage.ledger.paymentAttempts.get(req.params.attemptId);
      if (!attempt) return error(res, 404, "Payment attempt not found");
      const metadata = attempt.metadata && typeof attempt.metadata === "object" ? attempt.metadata as Record<string, any> : {};
      const adminTestAttempt = metadata.source === "admin_test_checkout" && metadata.adminTest?.isAdminTest === true;
      const adminAssistedAttempt = assertAdminAssistedPaymentProvenance(attempt);
      if (adminTest !== adminTestAttempt || adminAssisted !== adminAssistedAttempt) return error(res, 403, "Access denied");
      const actorId = adminTest
        ? await assertAdminTestPaymentAuthority(req)
        : adminAssisted ? await assertAdminPaymentAuthority(req)
        : await assertOnlinePaymentAuthority(req, attempt.entityType as "worker" | "employer", attempt.entityId, "pay");
      if (!attempt.createdByUserId || actorId !== attempt.createdByUserId ||
          (adminTest && metadata.adminTest.actorUserId !== actorId)) {
        return error(res, 403, cancel ? "Only the checkout creator can cancel it" : "Only the checkout creator can view this payment");
      }
      const resolved = await resolveGateway(attempt.gatewayConfigId);
      if (adminTest) assertAdminTestGateway(resolved);
      if (adminAssisted) assertAdminPaymentGateway(attempt, resolved);
      if (cancel) {
        // Hold the same attempt lock as webhook settlement while checking the
        // local state and asking the provider. A processing webhook cannot
        // slip between the local check and the cancellation transition.
        const outcome = await runInTransaction(async () => {
          await storage.ledger.paymentAttempts.lockAttempt(attempt.id);
          const fresh = await storage.ledger.paymentAttempts.get(attempt.id);
          if (!fresh || fresh.status !== "created" || fresh.ledgerPaymentId)
            return { message: "This payment is already processing or complete; check its status before paying again" };
          if (adminAssisted) {
            if (!assertAdminAssistedPaymentProvenance(fresh) || fresh.createdByUserId !== actorId)
              return { message: "Administrator payment authorization changed. Check its status or contact support." };
            assertAdminPaymentGateway(fresh, resolved);
          }
          if (!fresh.providerIntentRef || !resolved.plugin.cancelPayment || !resolved.plugin.retrievePayment)
            return { message: "Payment cannot be canceled automatically. Contact support with the confirmation number" };
          const current = await resolved.plugin.retrievePayment(resolved.context, fresh.providerIntentRef);
          if (current.status !== "created") {
            await processPaymentEvidence(fresh.id, fresh.gatewayConfigId, evidenceFromPayment(current));
            return { message: "Provider confirmation has begun or this payment has ended. Check its updated status" };
          }
          // A simultaneous provider confirmation may still win; only its
          // confirmed canceled response can release the reservation.
          const canceled = adminAssisted
            ? await resolved.plugin.cancelPayment(resolved.context, fresh.providerIntentRef, { adminAssistedAttemptId: fresh.id })
            : await resolved.plugin.cancelPayment(resolved.context, fresh.providerIntentRef);
          await processPaymentEvidence(fresh.id, fresh.gatewayConfigId, evidenceFromPayment(canceled));
          const saved = await storage.ledger.paymentAttempts.get(fresh.id);
          if (canceled.status !== "canceled" || saved?.status !== "canceled" || saved.ledgerPaymentId)
            return { message: "Cancellation could not be confirmed. Check the payment status" };
          return { saved };
        });
        return "saved" in outcome && outcome.saved
          ? res.json(safeAttempt(outcome.saved))
          : error(res, 409, outcome.message ?? "Cancellation could not be confirmed");
      } else if (attempt.providerIntentRef && resolved.plugin.retrievePayment) {
        const result = await resolved.plugin.retrievePayment(resolved.context, attempt.providerIntentRef);
        await processPaymentEvidence(attempt.id, attempt.gatewayConfigId, evidenceFromPayment(result));
      }
      return res.json(await receipt(await storage.ledger.paymentAttempts.get(attempt.id)));
    } catch (e) {
      if (e instanceof OnlinePaymentAuthorityError) return error(res, 403, e.message);
      if (e instanceof PaymentCancellationError) return error(res, 409, "Provider could not cancel this payment. Check its status or contact support");
      return error(res, 502, adminAssisted
        ? "Payment status could not be checked. Retry this receipt or contact support with the confirmation number. Do not start another payment while its outcome is unknown."
        : "Payment provider could not be reconciled");
    }
  };
  app.get("/api/ledger/checkout/sessions/:attemptId", requireAuth, (req, res) => checkoutStatus(req, res, false));
  app.post("/api/ledger/checkout/sessions/:attemptId/cancel", requireAuth, (req, res) => checkoutStatus(req, res, true));
  app.get("/api/ledger/admin-test-checkout/sessions/:attemptId", requireAuth, (req, res) => checkoutStatus(req, res, false, "admin_test"));
  app.post("/api/ledger/admin-test-checkout/sessions/:attemptId/cancel", requireAuth, (req, res) => checkoutStatus(req, res, true, "admin_test"));
  app.get("/api/ledger/admin-checkout/sessions/:attemptId", requireAuth, (req, res) => checkoutStatus(req, res, false, "admin_assisted"));
  app.post("/api/ledger/admin-checkout/sessions/:attemptId/cancel", requireAuth, (req, res) => checkoutStatus(req, res, true, "admin_assisted"));
  // Never let a malformed administrator-checkout request reach the SPA HTML fallback.
  app.use("/api/ledger/admin-checkout", requireAuth, (_req, res) =>
    error(res, 404, "Administrator checkout request not found. Reopen Make payment from the worker's Accounts page; check any existing payment's status before starting another."));

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
      let event;
      try {
        event = resolved.plugin.verifyWebhook(resolved.context, body, headers);
      } catch {
        return error(res, 400, "Invalid webhook signature or payload");
      }
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
        await storage.ledger.paymentAttempts.markEventIgnored(req.params.gatewayConfigId, event.eventId, "Unsupported provider event");
        return res.json({ received: true, unsupported: true });
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
        throw new SettlementRefusal("Payment gateway mismatch");
      }
      if (!providerRef) {
        throw new SettlementRefusal("Payment reference mismatch");
      }
      if (attempt.providerIntentRef && attempt.providerIntentRef !== providerRef) {
        throw new SettlementRefusal("Payment reference mismatch");
      }
      const transition = await processPaymentEvidence(attempt.id, req.params.gatewayConfigId, event);
      await complete();
      return res.json({ received: true, ...(transition === "stale" ? { stale: true } : {}), ...(newlyRecorded ? {} : { duplicate: true }) });
    } catch (e) {
      if (receivedEventId) {
        if (e instanceof SettlementRefusal &&
            ["Payment gateway mismatch", "Payment reference mismatch", "Payment amount or currency mismatch"].includes(e.message)) {
          await storage.ledger.paymentAttempts.markEventIgnored(req.params.gatewayConfigId, receivedEventId, e.message);
          return res.json({ received: true, ignored: true });
        }
        await storage.ledger.paymentAttempts.completeEvent(
          req.params.gatewayConfigId, receivedEventId,
          settlementError(e),
        );
        await logSettlementFailure(null, settlementError(e));
      }
      return error(res, receivedEventId ? 500 : 400, receivedEventId ? "Webhook processing failed" : "Invalid webhook");
    }
  });
}

class PaymentAttemptConflictError extends Error {}
