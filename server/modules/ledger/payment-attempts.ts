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
import { assertOnlinePaymentAuthority, OnlinePaymentAuthorityError } from "./online-payment-authority";
import { onlinePaymentSettingsSchema, onlinePaymentAuthorizationTextsSchema, ONLINE_PAYMENT_AUTHORIZATION_VARIABLE } from "@shared/ledger/online-payments";
import { z } from "zod";
import { enforceFloodLimit, FloodError } from "../../flood/service";
import { CHECKOUT_FLOOD_EVENT } from "../../flood/events";
import { PaymentCancellationError } from "../../plugins/ledger/payment-gateway/types";
import { ensureCustomer } from "./payment-methods";
import { processPaymentEvidence, evidenceFromPayment, settlementError, logSettlementFailure, SettlementRefusal } from "./payment-settlement";

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
    const staff = await checkAccessInline(req, "staff");
    if (!staff.granted) {
      try {
        const actor = await assertOnlinePaymentAuthority(req, "worker", attempt.workerId, "pay");
        if (!attempt.createdByUserId || actor !== attempt.createdByUserId) return error(res, 403, "Only the checkout creator can view this payment");
      } catch (e) { if (e instanceof OnlinePaymentAuthorityError) return error(res, 403, e.message); throw e; }
    }
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
    idempotencyKey: z.string().trim().min(1).max(200),
    paymentMethodId: z.string().trim().min(1).optional(),
    saveMethod: z.boolean().default(false),
    consent: z.object({ version: z.string().trim().min(1), text: z.string().trim().min(1), accepted: z.literal(true) }).strict(),
    statementSelection: z.array(z.object({
      invoiceNumber: z.string().trim().min(1),
      amount: z.union([z.string(), z.number()]),
    }).strict()).max(500).default([]),
  }).strict();
  const safeAttempt = (a: any, extra: Record<string, unknown> = {}) => ({
    id: a.id, entityType: a.entityType, entityId: a.entityId, eaId: a.ledgerEaId,
    amount: a.amount, currency: a.currency, status: workerVisibleStatus(a),
    failureMessage: a.status === "failed" ? a.failureMessage : null, ...extra,
  });
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
  app.get("/api/ledger/pay-accounts/:entityType/:entityId", requireAuth, async (req, res) => {
    if (!(await authorizeCheckout(req, res))) return;
    try {
      const eas = await storage.ledger.ea.getByEntity(req.params.entityType, req.params.entityId);
      const result = [];
      for (const ea of eas) {
        try {
          const { account, settings } = await loadCheckout(req.params.entityType, req.params.entityId, ea.id);
          const balance = parseStoredMoney(await storage.ledger.ea.getBalance(ea.id), "Balance");
          const reserved = parseStoredMoney(await storage.ledger.paymentAttempts.getReservedAmount(ea.id), "Reserved amount", { nonNegative: true, allowNumber: true });
          result.push({ eaId: ea.id, accountId: account.id, accountName: account.name, currency: account.currencyCode, gatewayConfigId: account.gatewayConfigId, balance: balance.toFixed(2), available: Math.max(0, balance - reserved).toFixed(2), settings });
        } catch { /* ineligible accounts are not exposed */ }
      }
      return res.json(result);
    } catch (e) { return error(res, 500, e instanceof Error ? e.message : "Failed to load payment accounts"); }
  });
  app.get("/api/ledger/checkout/:entityType/:entityId/:eaId", requireAuth, async (req, res) => {
    if (!(await authorizeCheckout(req, res))) return;
    try {
      const loaded = await loadCheckout(req.params.entityType, req.params.entityId, req.params.eaId);
      const auth = await storage.variables.getByName(ONLINE_PAYMENT_AUTHORIZATION_VARIABLE);
      const authorization = onlinePaymentAuthorizationTextsSchema.safeParse(auth?.value);
      const balance = parseStoredMoney(await storage.ledger.ea.getBalance(loaded.ea.id), "Balance");
      const reserved = parseStoredMoney(await storage.ledger.paymentAttempts.getReservedAmount(loaded.ea.id), "Reserved amount", { nonNegative: true, allowNumber: true });
      const invoices = await storage.ledger.invoices.listForEa(loaded.ea.id);
      const configuredTypes = Array.isArray((loaded.resolved.config.data as any)?.paymentTypes)
        ? (loaded.resolved.config.data as any).paymentTypes.filter((x: unknown): x is string => typeof x === "string") : [];
      const supportedTypes = (loaded.resolved.plugin.supportedPaymentTypes ?? []).map((x) => x.id);
      const paymentTypes = (loaded.settings.paymentTypes ?? ["card", "us_bank_account"])
        .filter((type) => configuredTypes.length === 0 || configuredTypes.includes(type))
        .filter((type) => supportedTypes.length === 0 || supportedTypes.includes(type));
      return res.json({
        entityType: req.params.entityType, entityId: req.params.entityId, eaId: loaded.ea.id,
        account: { id: loaded.account.id, name: loaded.account.name, currency: loaded.account.currencyCode },
        balance: balance.toFixed(2), available: Math.max(0, balance - reserved).toFixed(2),
        invoices, paymentTypes, payComponentId: loaded.resolved.plugin.payComponentId ?? null,
        settings: loaded.settings,
        authorization: authorization.success
          ? authorization.data[req.params.entityType === "worker" ? "consumer" : "business"]
          : null,
      });
    } catch (e) { return error(res, e instanceof PaymentAttemptConflictError ? 409 : 500, e instanceof Error ? e.message : "Checkout unavailable"); }
  });
  app.post("/api/ledger/checkout/:entityType/:entityId/:eaId/sessions", requireAuth, async (req, res) => {
    const userId = await authorizeCheckout(req, res); if (!userId) return;
    try {
      const body = checkoutBody.parse(req.body);
      const amountText = String(body.amount);
      if (!/^\d+(?:\.\d{1,2})?$/.test(amountText)) return error(res, 400, "amount must be a currency value");
      const cents = Math.round(Number(amountText) * 100);
      if (!Number.isSafeInteger(cents) || cents <= 0 || cents > 9999999999) return error(res, 400, "Amount is outside the supported range");
      const loaded = await loadCheckout(req.params.entityType, req.params.entityId, req.params.eaId);
      if (body.saveMethod) {
        try {
          await assertOnlinePaymentAuthority(req, req.params.entityType as "worker" | "employer", req.params.entityId, "methods");
        } catch (e) {
          if (e instanceof OnlinePaymentAuthorityError) return error(res, 403, e.message);
          throw e;
        }
      }
      if (cents < Math.round(loaded.settings.minAmount * 100)) return error(res, 400, "Amount is below the minimum");
      const invoices = await storage.ledger.invoices.listForEa(loaded.ea.id);
      const invoiceMap = new Map(invoices.map((invoice: any) => [invoice.invoiceNumber, invoice]));
      const selectedInvoices = new Set<string>();
      let selectedCents = 0;
      for (const selection of body.statementSelection) {
        if (selectedInvoices.has(selection.invoiceNumber)) return error(res, 400, "Invoice selection contains a duplicate");
        selectedInvoices.add(selection.invoiceNumber);
        const invoice = invoiceMap.get(selection.invoiceNumber);
        if (!invoice) return error(res, 400, "Invoice selection does not belong to this ledger account");
        if (!/^\d+(?:\.\d{1,2})?$/.test(String(selection.amount))) return error(res, 400, "Invoice selection amount is invalid");
        const selected = Math.round(Number(selection.amount) * 100);
        const due = Math.round(Number(invoice.invoiceBalance) * 100);
        if (!Number.isSafeInteger(selected) || !Number.isSafeInteger(due) || selected <= 0 || selected > due) return error(res, 400, "Invoice selection exceeds its balance");
        selectedCents += selected;
      }
      if (body.statementSelection.length > 0 && selectedCents !== cents) return error(res, 400, "Invoice selections must add up to the payment amount");
      const accountBalance = parseStoredMoney(await storage.ledger.ea.getBalance(loaded.ea.id), "Balance");
      const reservedBalance = parseStoredMoney(await storage.ledger.paymentAttempts.getReservedAmount(loaded.ea.id), "Reserved amount", { nonNegative: true, allowNumber: true });
      const availableCents = Math.max(0, Math.round((accountBalance - reservedBalance) * 100));
      if (!loaded.settings.allowPartial && cents !== availableCents) return error(res, 400, "This account requires payment of its full available balance");
      const existing = await storage.ledger.paymentAttempts.getByIdempotencyKey(body.idempotencyKey);
      if (existing) {
        if (["expired", "canceled", "failed"].includes(existing.status) ||
            (!existing.providerIntentRef && existing.reservationExpiresAt &&
             new Date(existing.reservationExpiresAt).getTime() <= Date.now())) {
          return error(res, 409, "This checkout attempt has ended; start a new checkout");
        }
        const existingConsent = existing.consent && typeof existing.consent === "object" ? existing.consent as Record<string, unknown> : {};
        const existingMetadata = existing.metadata && typeof existing.metadata === "object" ? existing.metadata as Record<string, unknown> : {};
        if (existing.entityType !== req.params.entityType || existing.entityId !== req.params.entityId ||
            existing.ledgerEaId !== req.params.eaId || Math.round(Number(existing.amount) * 100) !== cents ||
            existing.saveMethod !== body.saveMethod ||
            existing.gatewayConfigId !== loaded.account.gatewayConfigId ||
            existing.createdByUserId !== userId ||
            existingMetadata.paymentMethodRef !== (body.paymentMethodId ? (await storage.ledger.paymentMethods.get(body.paymentMethodId))?.providerMethodRef : null) ||
            existingConsent.version !== body.consent.version || existingConsent.text !== body.consent.text ||
            JSON.stringify(existing.statementSelection ?? []) !== JSON.stringify(body.statementSelection)) {
          return error(res, 409, "Idempotency key was already used for a different checkout");
        }
        if (!existing.providerIntentRef && ["created", "requires_action", "processing"].includes(existing.status)) {
          const metadata = existing.metadata && typeof existing.metadata === "object" ? existing.metadata as Record<string, unknown> : {};
          const retryMethodRef = typeof metadata.paymentMethodRef === "string" ? metadata.paymentMethodRef : undefined;
          const retryTypes = Array.isArray(metadata.paymentTypes) ? metadata.paymentTypes.filter((x): x is string => typeof x === "string") : ["card"];
          const retryCustomer = retryMethodRef
            ? (await storage.ledger.gatewayCustomers.get(existing.entityType, existing.entityId, existing.gatewayConfigId))?.customerRef
            : existing.saveMethod
              ? await ensureCustomer(existing.entityType, existing.entityId, loaded.resolved)
              : undefined;
          if (retryMethodRef && !retryCustomer) return error(res, 409, "Payment customer is not configured");
          const retry = await loaded.resolved.plugin.createPaymentSession!(loaded.resolved.context, {
            sessionId: existing.id, amountMinor: Math.round(Number(existing.amount) * 100),
            currency: existing.currency, customerRef: retryCustomer,
            savedMethodRef: retryMethodRef, saveMethod: existing.saveMethod,
            paymentTypes: retryTypes, description: "Ledger payment",
            metadata: { attemptId: existing.id, entityType: existing.entityType, entityId: existing.entityId },
          });
          const retried = await storage.ledger.paymentAttempts.updateStatus(existing.id, retry.status, { providerIntentRef: retry.providerRef });
          return res.json(safeAttempt(retried ?? existing, { clientSecret: retry.clientSecret, publicConfig: safePublicConfig(retry.publicConfig), providerRef: retry.providerRef }));
        }
        const intent = existing.providerIntentRef ? await loaded.resolved.plugin.retrievePayment!(loaded.resolved.context, existing.providerIntentRef) : undefined;
        return res.json(safeAttempt(existing, { clientSecret: intent?.clientSecret ?? null, providerRef: existing.providerIntentRef }));
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
      const configuredTypes = Array.isArray((loaded.resolved.config.data as any)?.paymentTypes)
        ? (loaded.resolved.config.data as any).paymentTypes.filter((x: unknown): x is string => typeof x === "string") : [];
      const supportedTypes = (loaded.resolved.plugin.supportedPaymentTypes ?? []).map((x) => x.id);
      const paymentTypes = (loaded.settings.paymentTypes ?? ["card", "us_bank_account"])
        .filter((type) => configuredTypes.length === 0 || configuredTypes.includes(type))
        .filter((type) => supportedTypes.length === 0 || supportedTypes.includes(type));
      if (paymentTypes.length === 0) return error(res, 409, "No compatible payment types are configured");
      if (savedMethod) {
        const summary = await loaded.resolved.plugin.getMethodSummary(loaded.resolved.context, savedMethod.providerMethodRef);
        if (!paymentTypes.includes(summary.type as typeof paymentTypes[number])) return error(res, 400, "Saved payment method type is not enabled");
      }
      const auth = await storage.variables.getByName(ONLINE_PAYMENT_AUTHORIZATION_VARIABLE);
      const texts = onlinePaymentAuthorizationTextsSchema.safeParse(auth?.value);
      const selectedText = texts.success ? texts.data[req.params.entityType === "worker" ? "consumer" : "business"] : null;
      if (!selectedText || body.consent.version !== selectedText.version || body.consent.text !== selectedText.text) return error(res, 400, "Current payment authorization must be accepted");
      const savedCustomer = savedMethod
        ? await storage.ledger.gatewayCustomers.get(req.params.entityType, req.params.entityId, loaded.account.gatewayConfigId!)
        : undefined;
      if (savedMethod && !savedCustomer) return error(res, 409, "Payment customer is not configured");
      const { dbUser } = await getEffectiveUser(req.session as any, req.user as any);
      const attempt = await runInTransaction(async () => {
        await storage.ledger.paymentAttempts.lockEa(loaded.ea.id);
        await storage.ledger.paymentAttempts.expireReservations(loaded.ea.id);
        const balance = parseStoredMoney(await storage.ledger.ea.getBalance(loaded.ea.id), "Balance");
        const reserved = parseStoredMoney(await storage.ledger.paymentAttempts.getReservedAmount(loaded.ea.id), "Reserved amount", { nonNegative: true, allowNumber: true });
        if (cents > Math.round((balance - reserved) * 100)) throw new PaymentAttemptConflictError("Payment amount exceeds the available balance");
        if (!loaded.settings.allowPartial && cents !== Math.max(0, Math.round((balance - reserved) * 100))) {
          throw new PaymentAttemptConflictError("This account requires payment of its full available balance");
        }
        return storage.ledger.paymentAttempts.create({ workerId: req.params.entityType === "worker" ? req.params.entityId : null, ledgerEaId: loaded.ea.id, gatewayConfigId: loaded.account.gatewayConfigId!, accountId: loaded.account.id, entityType: req.params.entityType, entityId: req.params.entityId, createdByUserId: dbUser?.id ?? null, createdAt: new Date(), updatedAt: new Date(), saveMethod: body.saveMethod, consent: { ...body.consent, acceptedAt: new Date().toISOString(), authorizationVersion: selectedText.version, authorizationText: selectedText.text }, statementSelection: body.statementSelection, idempotencyKey: body.idempotencyKey, amount: (cents / 100).toFixed(2), currency: loaded.account.currencyCode, status: "requires_action", reservationExpiresAt: null, metadata: { source: "online_checkout", paymentMethodRef: savedMethod?.providerMethodRef ?? null, paymentTypes, invoicePeriods: body.statementSelection.map(s => { const invoice = invoiceMap.get(s.invoiceNumber)!; return { invoiceNumber: s.invoiceNumber, statementYmd: `${invoice.year}-${String(invoice.month).padStart(2, "0")}-01` }; }) } } as any);
      });
      if ((attempt as any).__created === false) {
        // A competing request inserted the same key after our initial lookup.
        // Never return its provider secret without verifying its full intent.
        return error(res, 409, "Idempotency key was already used; retry this checkout");
      }
      const customerRef = savedCustomer?.customerRef ??
        (body.saveMethod ? await ensureCustomer(req.params.entityType, req.params.entityId, loaded.resolved) : undefined);
      const session = await loaded.resolved.plugin.createPaymentSession!(loaded.resolved.context, { sessionId: attempt.id, amountMinor: cents, currency: loaded.account.currencyCode, customerRef, savedMethodRef: savedMethod?.providerMethodRef, saveMethod: body.saveMethod, paymentTypes, description: "Ledger payment", metadata: { attemptId: attempt.id, entityType: req.params.entityType, entityId: req.params.entityId } });
      const updated = await storage.ledger.paymentAttempts.updateStatus(attempt.id, session.status, { providerIntentRef: session.providerRef });
      return res.status(201).json(safeAttempt(updated ?? attempt, { clientSecret: session.clientSecret, publicConfig: safePublicConfig(session.publicConfig), providerRef: session.providerRef }));
    } catch (e) { return error(res, e instanceof z.ZodError ? 400 : e instanceof PaymentAttemptConflictError ? 409 : 500, e instanceof Error ? e.message : "Checkout session failed"); }
  });
  const checkoutStatus = async (req: Request, res: Response, cancel: boolean) => {
    const attempt = await storage.ledger.paymentAttempts.get(req.params.attemptId);
    if (!attempt) return error(res, 404, "Payment attempt not found");
    if (cancel) {
      let actorId: string;
      try { actorId = await assertOnlinePaymentAuthority(req, attempt.entityType as "worker" | "employer", attempt.entityId, "pay"); }
      catch (e) { if (e instanceof OnlinePaymentAuthorityError) return error(res, 403, e.message); throw e; }
      if (!attempt.createdByUserId || actorId !== attempt.createdByUserId) return error(res, 403, "Only the checkout creator can cancel it");
    } else {
      const staff = await checkAccessInline(req, "staff");
      if (!staff.granted) {
        try {
          const actor = await assertOnlinePaymentAuthority(req, attempt.entityType as "worker" | "employer", attempt.entityId, "pay");
          if (!attempt.createdByUserId || actor !== attempt.createdByUserId) return error(res, 403, "Only the checkout creator can view this payment");
        }
        catch (e) { if (e instanceof OnlinePaymentAuthorityError) return error(res, 403, e.message); throw e; }
      }
    }
    try {
      const resolved = await resolveGateway(attempt.gatewayConfigId);
      if (cancel) {
        if (!attempt.providerIntentRef || !resolved.plugin.cancelPayment) return error(res, 409, "Payment cannot be canceled");
        const result = await resolved.plugin.cancelPayment(resolved.context, attempt.providerIntentRef);
        await processPaymentEvidence(attempt.id, attempt.gatewayConfigId, evidenceFromPayment(result));
      } else if (attempt.providerIntentRef && resolved.plugin.retrievePayment) {
        const result = await resolved.plugin.retrievePayment(resolved.context, attempt.providerIntentRef);
        await processPaymentEvidence(attempt.id, attempt.gatewayConfigId, evidenceFromPayment(result));
      }
      return res.json(safeAttempt(await storage.ledger.paymentAttempts.get(attempt.id)));
    } catch (e) {
      if (e instanceof PaymentCancellationError) return error(res, 409, e.message);
      return error(res, 502, "Payment provider could not be reconciled");
    }
  };
  app.get("/api/ledger/checkout/sessions/:attemptId", requireAuth, (req, res) => checkoutStatus(req, res, false));
  app.post("/api/ledger/checkout/sessions/:attemptId/cancel", requireAuth, (req, res) => checkoutStatus(req, res, true));

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