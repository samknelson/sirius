import type { Express } from "express";
import { createHash } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { ledger, ledgerPayments, ledgerEa, ledgerAccounts, ledgerPaymentAttempts, optionsLedgerPaymentType, pluginConfigs, pluginConfigsCharge, winstonLogs } from "@shared/schema";
import type { PaymentTypeCorrectionPreview, PaymentTypeCorrectionResult } from "@shared/payment-type-correction";
import { getClient, runInTransaction } from "../../storage/transaction-context";
import { requireAccess } from "../../services/access-policy-evaluator";
import { requireComponent } from "../components";
import { getRequestContext } from "../../middleware/request-context";
import { triggerPaymentChargePlugins, validateProposedAllocation } from "./payments";
import { dateToYmd } from "@shared/utils/date";

const owner = "payment-simple-allocation";
export class CorrectionConflict extends Error {}

// Canonical JSON covers nested JSONB too (object insertion order is not data).
export function correctionSnapshot(value: unknown): string {
  const canonical = (v: any): any => v instanceof Date ? v.toISOString()
    : Array.isArray(v) ? v.map(canonical)
    : v && typeof v === "object"
      ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

export interface CorrectionInventory {
  type: typeof optionsLedgerPaymentType.$inferSelect;
  payments: (typeof ledgerPayments.$inferSelect)[];
  entries: (typeof ledger.$inferSelect)[];
  eas: (typeof ledgerEa.$inferSelect)[];
  accounts: (typeof ledgerAccounts.$inferSelect)[];
  attempts: (typeof ledgerPaymentAttempts.$inferSelect)[];
  configs: Array<{ config: typeof pluginConfigs.$inferSelect; charge: typeof pluginConfigsCharge.$inferSelect | null }>;
}

export function buildCorrectionPreview(data: CorrectionInventory): PaymentTypeCorrectionPreview {
  const blockers: string[] = [];
  if (data.type.direction !== "credit") blockers.push("Only Credit types can be corrected to Charge. Reload the payment types.");
  const payments = data.payments.map(payment => {
    const reasons: string[] = [];
    const entries = data.entries.filter(e => e.referenceId === payment.id);
    const details = payment.details as Record<string, unknown> | null;
    if (details && Object.keys(details).some(k => k !== "proposedAllocation")) {
      reasons.push("Payment has additional source details requiring manual review.");
    }
    if (details?.baoUploadSource) reasons.push("Upload-source allocations require a separate reviewed correction.");
    if (data.attempts.some(a => a.ledgerPaymentId === payment.id) ||
        (details && Object.keys(details).some(k => /gateway|provider|online|attempt/i.test(k)))) {
      reasons.push("Online settlement payments cannot be corrected here.");
    }
    const primary = data.eas.find(e => e.id === payment.ledgerEaId);
    const account = data.accounts.find(a => a.id === primary?.accountId);
    // Also exclude gateway-connected accounts: changing this type would change
    // future online settlement semantics even if the candidate was entered manually.
    if (account?.gatewayConfigId) reasons.push("Gateway-connected accounts cannot be corrected here.");
    const configs = data.configs.filter(c => c.config.pluginId === owner && c.config.enabled &&
      c.charge?.scope === "global" && c.charge.account === primary?.accountId);
    if (!primary || !account || account.currencyCode !== data.type.currencyCode) reasons.push("Missing account or incompatible currency.");
    if (configs.length !== 1) reasons.push("Exactly one enabled global simple-allocation owner is required.");
    const validation = validateProposedAllocation(details, payment.amount);
    if (!validation.valid) reasons.push(validation.error || "Invalid allocation.");
    const proposed = validation.allocations;
    const allocations = proposed?.length ? proposed : [{ eaId: payment.ledgerEaId, amount: payment.amount, statementYmd: "" }];
    const effectiveDate = payment.dateReceived || payment.dateCleared;
    if (!effectiveDate || !Number.isFinite(new Date(effectiveDate).getTime())) reasons.push("Payment has no valid posting date.");
    const expected = allocations.map(a => {
      const ea = data.eas.find(e => e.id === a.eaId);
      if (!ea || ea.accountId !== primary?.accountId) reasons.push("Allocation account is missing or differs from the payment account.");
      const suffix = a.statementYmd ? `:${a.statementYmd}` : "";
      return {
        key: `${configs[0]?.config.id}:${payment.id}${proposed?.length ? `:${a.eaId}` : ""}${suffix}`,
        eaId: a.eaId, amount: Number(a.amount),
        statementYmd: a.statementYmd || (effectiveDate ? dateToYmd(effectiveDate) : ""),
        date: effectiveDate,
        // These are exactly the persisted fields produced by simple allocation
        // and createLedgerEntries. The direction-derived description is NOT the
        // ledger memo: that executor uses transaction.memo whenever defined,
        // including null, and this plugin always supplies payment.memo || null.
        memo: payment.memo || null,
        data: {
          pluginId: owner,
          pluginConfigId: configs[0]?.config.id,
          paymentId: payment.id,
          originalAmount: a.amount,
          ledgerEaId: a.eaId,
          allocationId: proposed?.length ? `${a.eaId}:${a.statementYmd || ""}` : null,
        },
      };
    });
    if (entries.length !== expected.length) reasons.push("Missing or extra historical allocation entries.");
    for (const entry of entries) {
      const match = expected.find(e => e.key === entry.chargePluginKey);
      if (entry.chargePlugin !== owner || entry.chargePluginConfigId !== configs[0]?.config.id ||
          !match || match.eaId !== entry.eaId || match.statementYmd !== entry.statementYmd ||
          !Number.isFinite(match.amount) || match.amount <= 0 || Number(entry.amount) !== -match.amount) {
        reasons.push(`Entry ${entry.id} is not an exact, owned Credit allocation; manual review is required.`);
      }
      if (match && (
        correctionSnapshot(entry.date) !== correctionSnapshot(match.date) ||
        entry.memo !== match.memo ||
        correctionSnapshot(entry.data) !== correctionSnapshot(match.data)
      )) {
        reasons.push(`Entry ${entry.id} has a historical date, memo, or metadata that differs from its owning allocation. Correcting it would overwrite provenance; manual review is required.`);
      }
    }
    return { id: payment.id, amount: payment.amount, blockers: [...new Set(reasons)],
      entries: entries.map(e => ({ id: e.id, amount: e.amount, proposedAmount: (-Number(e.amount)).toFixed(2),
        eaId: e.eaId, key: e.chargePluginKey, plugin: e.chargePlugin })) };
  });
  return { paymentTypeId: data.type.id, paymentTypeName: data.type.name,
    currentDirection: data.type.direction, targetDirection: "charge", snapshot: correctionSnapshot(data),
    eligible: blockers.length === 0 && payments.every(p => p.blockers.length === 0),
    blockers, payments, paymentCount: payments.length, entryCount: payments.reduce((n, p) => n + p.entries.length, 0) };
}

async function lockInventory(applying: boolean) {
  const client = getClient();
  await client.execute(sql`SET LOCAL lock_timeout = '5s'`);
  // This rare administrative operation deliberately uses table locks, not only
  // candidate row locks: new payments, status flips, new entries/configs and
  // settlement links must not appear between snapshot comparison and commit.
  // SHARE ROW EXCLUSIVE also serializes competing confirmations. Preview uses
  // SHARE, does not write, and releases its consistent inventory immediately.
  await client.execute(applying
    ? sql`LOCK TABLE options_ledger_payment_type, ledger_payments, ledger, ledger_ea, ledger_accounts, ledger_payment_attempts, plugin_configs, plugin_configs_charge IN SHARE ROW EXCLUSIVE MODE`
    : sql`LOCK TABLE options_ledger_payment_type, ledger_payments, ledger, ledger_ea, ledger_accounts, ledger_payment_attempts, plugin_configs, plugin_configs_charge IN SHARE MODE`);
}

async function readInventory(id: string): Promise<CorrectionInventory> {
  const client = getClient();
  const [type] = await client.select().from(optionsLedgerPaymentType).where(eq(optionsLedgerPaymentType.id, id));
  if (!type) throw new CorrectionConflict("Payment type not found.");
  const payments = (await client.select().from(ledgerPayments).where(eq(ledgerPayments.paymentType, id)))
    .filter(p => p.status === "cleared").sort((a, b) => a.id.localeCompare(b.id));
  const ids = new Set(payments.map(p => p.id));
  const entries = (ids.size ? await client.select().from(ledger)
    .where(and(eq(ledger.referenceType, "payment"), inArray(ledger.referenceId, [...ids]))) : [])
    .filter(e => e.referenceType === "payment" && ids.has(e.referenceId!))
    .sort((a, b) => a.id.localeCompare(b.id));
  const eas = (await client.select().from(ledgerEa)).sort((a, b) => a.id.localeCompare(b.id));
  const accounts = (await client.select().from(ledgerAccounts)).sort((a, b) => a.id.localeCompare(b.id));
  const attempts = (ids.size ? await client.select().from(ledgerPaymentAttempts)
    .where(inArray(ledgerPaymentAttempts.ledgerPaymentId, [...ids])) : []).filter(a => ids.has(a.ledgerPaymentId!))
    .sort((a, b) => a.id.localeCompare(b.id));
  const configs = (await client.select({ config: pluginConfigs, charge: pluginConfigsCharge }).from(pluginConfigs)
    .leftJoin(pluginConfigsCharge, eq(pluginConfigs.id, pluginConfigsCharge.id))).sort((a, b) => a.config.id.localeCompare(b.config.id));
  return { type, payments, entries, eas, accounts, attempts, configs };
}

export async function previewPaymentTypeCorrection(id: string) {
  return runInTransaction(async () => {
    await lockInventory(false);
    return buildCorrectionPreview(await readInventory(id));
  });
}

export async function confirmPaymentTypeCorrection(id: string, body: unknown): Promise<PaymentTypeCorrectionResult> {
  const input = body as { snapshot?: unknown; confirmed?: unknown } | null;
  if (input?.confirmed !== true || typeof input.snapshot !== "string" || !/^[a-f0-9]{64}$/.test(input.snapshot)) {
    throw new CorrectionConflict("Explicit confirmation and the exact preview snapshot are required.");
  }
  return runInTransaction(async () => {
    await lockInventory(true);
    const before = await readInventory(id);
    const preview = buildCorrectionPreview(before);
    if (preview.snapshot !== input.snapshot) throw new CorrectionConflict("Data changed since preview. Review a new preview; nothing was changed.");
    if (!preview.eligible) throw new CorrectionConflict("Unsupported historical allocations. Resolve the preview blockers or create a new Charge type; nothing was changed.");
    await getClient().update(optionsLedgerPaymentType).set({ direction: "charge" }).where(eq(optionsLedgerPaymentType.id, id));
    // Do not trust a request-local config cache populated before the locks.
    getRequestContext()?.chargeConfigCache?.clear();
    for (const payment of before.payments) {
      await triggerPaymentChargePlugins(payment, { onlyPluginIds: [owner], suppressSavedEvent: true });
    }
    const after = await readInventory(id);
    if (after.type.direction !== "charge" ||
        correctionSnapshot(after.payments) !== correctionSnapshot(before.payments) ||
        after.entries.length !== before.entries.length || before.entries.some(old => {
      const entry = after.entries.find(e => e.id === old.id);
      // Compare the ENTIRE persisted row, not just its identity. The only
      // reviewed mutation is amount; date, memo, metadata and every provenance
      // field must survive the owning plugin's upsert byte-for-byte in JSON.
      return !entry || correctionSnapshot(entry) !== correctionSnapshot({
        ...old, amount: (-Number(old.amount)).toFixed(2),
      });
    })) throw new CorrectionConflict("Reconciliation did not preserve the reviewed allocation identities, provenance and amounts. All changes rolled back.");
    const context = getRequestContext();
    // Await the durable audit insert in the SAME transaction (not a best-effort
    // logger write or inherited deferred callback).
    await getClient().insert(winstonLogs).values({
      level: "info", source: "storage", module: "options.ledgerPaymentTypes", operation: "correctCreditToCharge",
      entityId: id, message: "Reviewed payment type Credit to Charge correction",
      userId: context?.userId, userEmail: context?.userEmail, ipAddress: context?.ipAddress,
      meta: { snapshot: preview.snapshot, beforeDirection: "credit", afterDirection: "charge",
        payments: preview.payments, afterEntries: after.entries },
    });
    return { paymentTypeId: id, direction: "charge", paymentCount: preview.paymentCount, entryCount: preview.entryCount };
  });
}

export function registerPaymentTypeCorrectionRoutes(app: Express) {
  for (const operation of ["preview", "confirm"] as const) {
    app.post(`/api/options/ledger-payment-type/:id/charge-correction/${operation}`,
      requireAccess("admin"), requireComponent("ledger"), async (req, res) => {
        try {
          res.json(operation === "preview" ? await previewPaymentTypeCorrection(req.params.id)
            : await confirmPaymentTypeCorrection(req.params.id, req.body));
        } catch (error) {
          res.status(error instanceof CorrectionConflict ? 409 : 500).json({
            message: error instanceof CorrectionConflict ? error.message
              : "Correction could not complete safely. Nothing was changed. Retry with a new preview.",
          });
        }
      });
  }
}