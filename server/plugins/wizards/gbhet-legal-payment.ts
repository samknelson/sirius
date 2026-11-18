import { z } from "zod";
import { storage } from "../../storage";
import { createUnifiedOptionsStorage } from "../../storage/unified-options";
import { checkAccessInline } from "../../services/access-policy-evaluator";
import { getEffectiveUser } from "../../modules/masquerade";
import { isValidYmd } from "@shared/utils/date";
import { EMPLOYER_SUBMITTED, ledgerMinor, ledgerDecimal, legalPaymentMinor, legalRemittanceSchema, type LegalConfirmationData, type LegalChargeGroup } from "@shared/legal-payment";
import type { WizardStepContext, WizardStepHandler } from "./types";

const options = createUnifiedOptionsStorage();
const legalTypes = new Set(["gbhet_legal_workers_monthly", "gbhet_legal_workers_corrections"]);
function isCompleted(wizard: WizardStepContext["wizard"]) {
  return ["completed", "completed_with_errors", "complete"].includes(wizard.status) && !!(wizard.data as any)?.processResults;
}
function configuredMethod(type: { data: unknown }): "check" | "wire" | null {
  const method = (type.data as any)?.legalRemittanceMethod;
  return method === "check" || method === "wire" ? method : null;
}
async function assertAccountAccess(ctx: WizardStepContext, eaId: string) {
  const ea = await storage.ledger.ea.get(eaId);
  if (!ea || ea.entityType !== "employer" || ea.entityId !== ctx.wizard.entityId) {
    throw new Error("This account does not belong to this upload's employer.");
  }
  const gate = await checkAccessInline(ctx.req, "ledger.ea.view", ea.entityId, { entityType: ea.entityType, entityId: ea.entityId });
  if (!gate.granted) throw new Error("You do not have access to this employer account.");
  return ea;
}

async function getConfirmation(ctx: WizardStepContext): Promise<LegalConfirmationData> {
  const data = (ctx.wizard.data ?? {}) as any;
  const snapshot = data.legalCompletion;
  const payments = await storage.ledger.payments.getByUpload(ctx.wizardId);
  const types = await options.list("ledger-payment-type");
  const accounts: LegalConfirmationData["accounts"] = [];
  for (const group of (snapshot?.chargeGroups ?? []) as LegalChargeGroup[]) {
    const ea = await assertAccountAccess(ctx, group.eaId);
    const account = await storage.ledger.accounts.get(ea.accountId);
    let balance: string | null = null;
    let error: string | undefined;
    const currencyMatches = !!account && account.isActive && account.currencyCode === group.currency;
    try {
      if (!currencyMatches) throw new Error("Account configuration changed");
      balance = await storage.ledger.ea.getBalance(group.eaId); ledgerMinor(balance);
    } catch {
      balance = null; error = "The current outstanding balance is unavailable. Refresh or ask staff to check the account.";
    }
    const payment = payments.find(p => p.ledgerEaId === group.eaId);
    accounts.push({
      ...group, balance, error, invoiceSummaryPath: `/ea/${group.eaId}/invoices`,
      methods: types.flatMap(type => {
        const method = configuredMethod(type);
        return currencyMatches && method && type.category === "financial" && type.currencyCode === group.currency
          ? [{ id: type.id, name: type.name, method }] : [];
      }),
      draft: data.legalRemittances?.[group.eaId] ?? null,
      payment: payment ? { id: payment.id, status: payment.status, amount: payment.amount, paymentType: payment.paymentType, details: payment.details } : null,
    });
  }
  return {
    completed: isCompleted(ctx.wizard), historical: isCompleted(ctx.wizard) && snapshot?.version !== 2,
    population: snapshot?.population ?? null, totals: snapshot?.totals ?? null, accounts,
  };
}

export function buildLegalConfirmationStep(): WizardStepHandler {
  return {
    id: "confirmation", name: "Confirmation and Payment",
    description: "Review actual upload results and tell us how you will pay",
    kind: "custom", component: "Confirmation", requiredComponent: "ledger",
    serializeSubmit: true,
    getState: wizard => isCompleted(wizard) ? "completed" : "pending",
    getData: async ctx => ({ ...await getConfirmation(ctx) }),
    submit: async ctx => {
      // Dispatcher also enforces the Legal component + employer ownership and
      // serializes this action AND its returned form state in one wizard tx.
      if (!legalTypes.has(ctx.wizard.type) || !isCompleted(ctx.wizard)) throw new Error("Finish processing this Legal upload before entering payment information.");
      const data = (ctx.wizard.data ?? {}) as any;
      if (data.legalCompletion?.version !== 2 || data.legalCompletion?.totals?.chargeReadFailed ||
        !Array.isArray(data.legalCompletion?.chargeGroups)) {
        throw new Error("Actual account charges are unavailable for this upload. Ask staff to record payment through Ledger.");
      }
      const input = z.object({
        eaId: z.string().min(1), action: z.enum(["save", "submit"]), remittance: legalRemittanceSchema,
      }).strict().parse(ctx.input);
      const group = (data.legalCompletion.chargeGroups as LegalChargeGroup[]).find(g => g.eaId === input.eaId);
      if (!group) throw new Error("Select an account charged by this upload.");
      const ea = await assertAccountAccess(ctx, input.eaId);
      const account = await storage.ledger.accounts.get(ea.accountId);
      if (!account || !account.isActive || account.currencyCode !== group.currency) throw new Error("The account configuration changed. Ask staff to review its currency and availability.");
      const remittance = input.remittance;
      if (remittance.amount) {
        try {
          const minor = legalPaymentMinor(remittance.amount, account.currencyCode);
          if (minor <= 0n) throw new Error("The payment amount must be positive before submitting for review.");
          remittance.amount = ledgerDecimal(minor);
        } catch (error) {
          if (input.action === "submit") throw error;
        }
      }
      const linked = (await storage.ledger.payments.getByUpload(ctx.wizardId)).find(p => p.ledgerEaId === ea.id);
      if (linked && (linked.status !== EMPLOYER_SUBMITTED || linked.dateCleared)) {
        const previous = data.legalRemittances?.[ea.id] ?? {};
        if (Object.keys({ ...previous, ...remittance }).some(key =>
          (previous[key] ?? "") !== ((remittance as any)[key] ?? ""))) {
          throw new Error("Staff have started reviewing this payment. Contact them to change it.");
        }
        return {};
      }
      if (remittance.paymentDate) {
        const parsed = new Date(`${remittance.paymentDate}T12:00:00Z`);
        if (!isValidYmd(remittance.paymentDate) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== remittance.paymentDate) {
          throw new Error("Enter a valid planned or sent date.");
        }
      }
      // A saved draft never creates a zero payment or changes a submitted receipt.
      if (input.action === "submit") {
        if (!remittance.amount || ledgerMinor(remittance.amount) <= 0n) throw new Error("Enter a positive payment amount before submitting for review.");
        const type = (await options.list("ledger-payment-type")).find(t => t.id === remittance.paymentType);
        if (!type || type.category !== "financial" || type.currencyCode !== account.currencyCode ||
          !remittance.method || configuredMethod(type) !== remittance.method) {
          throw new Error("Choose a configured financial Check or Wire payment type in this account's currency. Staff can set Legal remittance method on Payment Types; select the appropriate type explicitly.");
        }
        const { dbUser } = await getEffectiveUser((ctx.req as any).session, (ctx.req as any).user);
        if (!dbUser) throw new Error("Your user account could not be resolved.");
        const priorDetails = (linked?.details ?? {}) as Record<string, unknown>;
        const details = {
          ...priorDetails, ...remittance,
          uploadId: ctx.wizardId, uploadType: ctx.wizard.type,
          uploadPath: `/wizards/${ctx.wizardId}`,
          submittedBy: priorDetails.submittedBy ?? dbUser.id,
          submittedAt: priorDetails.submittedAt ?? new Date().toISOString(),
          proposedAllocation: [{ eaId: ea.id, amount: remittance.amount, statementYmd: "" }],
        };
        if (linked) await storage.ledger.payments.updateEmployerSubmission(linked.id, {
          amount: remittance.amount, paymentType: type.id, details,
        });
        else await storage.ledger.payments.createForUpload(ctx.wizardId, {
          ledgerEaId: ea.id, amount: remittance.amount, paymentType: type.id,
          details, status: EMPLOYER_SUBMITTED, memo: `Legal upload ${ctx.wizardId}`,
          dateReceived: null, dateCleared: null, allocated: false,
        });
      }
      return { data: { legalRemittances: { ...data.legalRemittances, [ea.id]: remittance } } };
    },
  };
}
