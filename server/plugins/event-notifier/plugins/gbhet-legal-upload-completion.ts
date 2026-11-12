import { EventType, type LegalUploadCompletedPayload } from "../../../services/event-bus";
import { storage } from "../../../storage";
import { registerEventNotifier } from "../registry";
import { templatesSchemaBlock } from "../template-schema";
import type { EventNotifierPlugin, NotifierRecipient } from "../types";
import { legalCompletionSendKey, legalUploadTokenRow } from "../legal-upload-message";
import "../../tokens/plugins/legal-upload";

export const gbhetLegalUploadCompletionNotifier: EventNotifierPlugin = {
  id: "gbhet-legal-upload-completion",
  name: "Legal Upload Completion",
  description: "Notify the captured uploader and this employer's contacts of selected types after Legal processing finishes.",
  requiredComponent: "sitespecific.gbhet.legal",
  notifySelf: true,
  subscribedEvents: [EventType.GBHET_LEGAL_UPLOAD_COMPLETED_AFTER],
  supportedMedia: ["email", "sms", "inapp"],
  configSchema: {
    type: "object",
    properties: {
      contactTypeIds: {
        type: "array", title: "Employer contact types",
        description: "The uploader is always included when a contact is available. With no types selected, notify only the uploader.",
        items: { type: "string" }, "x-options-resource": "employer-contact-type",
      },
      templates: templatesSchemaBlock({ exampleTokens: [
        '{{wizards.field(name="summary")}}', "{{wizards.invoice_links}}",
        '{{wizards.field(name="results_url")}}',
      ] }),
    },
  },
  tokenTemplates: {
    roots: [{
      name: "wizards", kind: "wizards", label: "Legal upload",
      async build(ctx) {
        return { kind: "wizards", row: legalUploadTokenRow(ctx.payload as LegalUploadCompletedPayload) };
      },
    }],
    defaultTemplates: () => ({
      email: {
        subject: 'Legal upload: {{wizards.field(name="period")}} — {{wizards.field(name="outcome")}}',
        bodyHtml: '<p>{{wizards.field(name="summary")}}</p>{{wizards.invoice_links}}<p><a href="{{wizards.field(name="results_url")}}">View upload results</a></p>',
      },
      sms: { body: '{{wizards.field(name="summary")}} {{wizards.field(name="invoice_urls")}} Results: {{wizards.field(name="results_url")}}' },
      inapp: {
        title: 'Legal upload: {{wizards.field(name="period")}}',
        body: '{{wizards.field(name="summary")}} {{wizards.field(name="invoice_urls")}}',
        linkUrl: '{{wizards.field(name="results_path")}}', linkLabel: "View upload results",
      },
    }),
  },
  getSendKey: ctx => legalCompletionSendKey((ctx.payload as LegalUploadCompletedPayload).uploadId),
  async getRecipients(ctx, configData) {
    const payload = ctx.payload as LegalUploadCompletedPayload;
    const configured = (configData as { contactTypeIds?: unknown })?.contactTypeIds;
    const types = new Set(Array.isArray(configured) ? configured.filter((value): value is string => typeof value === "string") : []);
    const recipients = new Map<string, NotifierRecipient>();
    if (payload.submitter?.contactId && await storage.contacts.getContact(payload.submitter.contactId)) {
      recipients.set(payload.submitter.contactId, { contactId: payload.submitter.contactId, userId: payload.submitter.userId });
    }
    if (types.size) {
      const contacts = await storage.employerContacts.listByEmployer(payload.employerId);
      for (const link of contacts) {
        if (!link.contactTypeId || !types.has(link.contactTypeId)) continue;
        if (recipients.has(link.contactId)) continue;
        const user = link.contact.email ? await storage.users.getUserByEmail(link.contact.email) : null;
        recipients.set(link.contactId, { contactId: link.contactId, userId: user?.id });
      }
    }
    return [...recipients.values()];
  },
};

registerEventNotifier(gbhetLegalUploadCompletionNotifier);
