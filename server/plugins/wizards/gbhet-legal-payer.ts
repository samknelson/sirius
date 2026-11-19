import { randomUUID } from "node:crypto";
import type { LegalChargeGroup, LegalPayer, LegalPayerHandoff } from "@shared/legal-payment";
import { escapeHtml } from "@shared/utils/html/escape";
import { storage } from "../../storage";
import { createCommEmailOptinStorage } from "../../storage/comm";
import { checkAccessInline } from "../../services/access-policy-evaluator";
import { getEffectiveUser } from "../../modules/masquerade";
import { onAfterCommit, runOutsideTransaction } from "../../storage/transaction-context";
import { getPublicBaseUrl } from "../../services/comm/callback-handlers/url-builder";
import { sendEmail } from "../../services/comm/senders/email";
import { logger } from "../../logger";
import type { WizardStepContext } from "./types";

const emailOptins = createCommEmailOptinStorage();
export async function getLegalPayerOptions(ctx: WizardStepContext) {
  const view = await checkAccessInline(ctx.req, "employer.steward.view", ctx.wizard.entityId!);
  const manage = await checkAccessInline(ctx.req, "employer.manage", ctx.wizard.entityId!);
  const contacts = view.granted ? await storage.employerContacts.listByEmployer(ctx.wizard.entityId!) : [];
  return {
    canSavePayerContact: manage.granted,
    payerContacts: await Promise.all(contacts.map(async ({ contact }) => ({
      contactId: contact.id, name: contact.displayName, email: contact.email,
      optedIn: !!contact.email && !!(await emailOptins.getEmailOptinByEmail(contact.email))?.optin,
    }))),
  };
}

// This is a notification, not a remittance: no payment or allocation is created.
export async function queueLegalPayer(ctx: WizardStepContext, group: LegalChargeGroup, payer: LegalPayer) {
  const employerId = ctx.wizard.entityId!;
  const data = (ctx.wizard.data ?? {}) as Record<string, any>;
  const view = await checkAccessInline(ctx.req, "employer.steward.view", employerId);
  if (!view.granted) throw new Error("You cannot select payment contacts for this employer.");
  const linked = await storage.employerContacts.listByEmployer(employerId);
  let contact = payer.source === "contact"
    ? linked.find(row => row.contactId === payer.contactId)?.contact
    : undefined;
  if (payer.source === "contact" && !contact) throw new Error("Select a contact linked to this upload's employer.");
  const name = payer.source === "new" ? payer.name : contact!.displayName;
  const email = (payer.source === "new" ? payer.email : contact!.email)?.trim().toLowerCase();
  if (!email) throw new Error("This employer contact has no email address. Choose another contact or enter their name and email.");
  if (payer.source === "new" && payer.saveContact) {
    const manage = await checkAccessInline(ctx.req, "employer.manage", employerId);
    if (!manage.granted) throw new Error("You do not have permission to save employer contacts. You can notify without saving.");
  }
  const { dbUser } = await getEffectiveUser((ctx.req as any).session, (ctx.req as any).user);
  if (!dbUser) throw new Error("Your user account could not be resolved.");
  const previous: LegalPayerHandoff | undefined = data.legalPayerHandoffs?.[group.eaId];
  // A double click or a request retry must not send another notification.
  if (previous?.email === email && (previous.status === "sent" ||
    (previous.status === "queued" && Date.now() - Date.parse(previous.requestedAt) < 120_000))) return {};

  const optedIn = !!(await emailOptins.getEmailOptinByEmail(email))?.optin;
  if (payer.source === "new") {
    contact = linked.find(row => row.contact.email?.trim().toLowerCase() === email)?.contact;
    const existing = contact ?? await storage.contacts.getContactByEmail(email);
    // Never expose/link another employer's existing contact through this form.
    if (!contact && existing && payer.saveContact) {
      throw new Error("This email is already used by a contact outside this employer. Ask staff to link the correct contact, or notify without saving.");
    }
    contact = existing;
    if (!contact && (payer.saveContact || optedIn)) {
      contact = await storage.contacts.createContact({ displayName: name, email });
    }
    if (payer.saveContact && contact && !linked.some(row => row.contactId === contact!.id)) {
      await storage.employerContacts.create({ employerId, contactId: contact.id });
    }
  }
  const baseUrl = getPublicBaseUrl();
  const handoff: LegalPayerHandoff = {
    attemptId: previous?.email === email && previous.status === "queued" ? previous.attemptId : randomUUID(),
    name, email, contactId: contact?.id ?? null,
    savedContact: !!contact && (linked.some(row => row.contactId === contact!.id) || (payer.source === "new" && payer.saveContact)),
    requestedAt: new Date().toISOString(), status: "queued",
    message: "Invoice notification queued. No payment has been submitted or credited.",
  };
  if (!optedIn) {
    handoff.status = "blocked";
    handoff.message = "Email not sent: this address has not opted in. Ask authorized staff to manage email opt-in, then retry. Saving a contact does not opt them in.";
  } else if (!baseUrl) {
    handoff.status = "blocked";
    handoff.message = "Email not sent: the site's public URL is not configured. Ask staff to configure it, then retry.";
  } else {
    const contactId = contact!.id;
    const invoiceUrl = new URL(`/ea/${encodeURIComponent(group.eaId)}/invoices`, baseUrl).href;
    // The wizard dispatcher commits this handoff before any external send.
    // Deferred work must not inherit its now-committed transaction.
    onAfterCommit(() => runOutsideTransaction(() => {
      void deliverLegalPayer(ctx.wizardId, group, handoff, contactId, invoiceUrl, dbUser.id)
        .catch(error => logger.error("Legal payer notification failed", {
          service: "legal-payer", error: error instanceof Error ? error.message : String(error),
        }));
    }));
  }
  return { data: { legalPayerHandoffs: { ...data.legalPayerHandoffs, [group.eaId]: handoff } } };
}

async function deliverLegalPayer(wizardId: string, group: LegalChargeGroup, handoff: LegalPayerHandoff, contactId: string, invoiceUrl: string, userId: string) {
  let result: Pick<LegalPayerHandoff, "status" | "message" | "commId">;
  try {
    const sent = await sendEmail({
      contactId, toEmail: handoff.email, toName: handoff.name, userId,
      sendKey: `legal-payer:${wizardId}:${group.eaId}:${handoff.attemptId}`,
      subject: `Invoice ready for payment: ${group.accountName}`,
      bodyHtml: `<p>Hello ${escapeHtml(handoff.name)},</p><p>Your employer has asked us to notify you that a Legal upload invoice is ready for payment.</p><p>Account: ${escapeHtml(group.accountName)}<br>Upload charges: ${escapeHtml(group.amount)} ${escapeHtml(group.currency)}</p><p><a href="${escapeHtml(invoiceUrl)}">View account invoices</a></p><p>Sign in with an authorized employer account. This email does not grant access or create an account. If you cannot view the invoice, contact your employer or the Trust.</p><p>This notification does not initiate a payment or confirm that funds were received.</p>`,
    });
    // "Already sent" can also refer to a failed/sending claim: never report it
    // as successful merely because the at-most-once key was spent.
    const accepted = sent.success || (sent.alreadySent && ["sent", "delivered"].includes(sent.comm?.status ?? ""));
    const uncertain = sent.alreadySent && sent.comm?.status === "sending";
    result = {
      status: accepted ? "sent" : uncertain ? "queued" : "failed",
      message: accepted ? "Invoice email sent. No payment has been submitted or credited." : uncertain
        ? "An earlier send is still unconfirmed. Ask staff to check communication history; another email has not been sent."
        : `Email not sent: ${sent.error ?? "The provider did not confirm the send."}`,
      ...(sent.comm ? { commId: sent.comm.id } : {}),
    };
  } catch {
    result = { status: "failed", message: "The invoice email could not be sent. Check the communication history or contact staff before retrying." };
  }
  await storage.wizards.withLocked(wizardId, async wizard => {
    const data = (wizard.data ?? {}) as Record<string, any>;
    if (data.legalPayerHandoffs?.[group.eaId]?.attemptId !== handoff.attemptId) return;
    await storage.wizards.update(wizardId, { data: {
      ...data, legalPayerHandoffs: { ...data.legalPayerHandoffs, [group.eaId]: { ...handoff, ...result } },
    } });
  });
}
