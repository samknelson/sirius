import { storage } from "../../storage";
import {
  emailMessageDefaultsSchema, postalMessageDefaultsSchema,
  type EmailMessageDefaults, type PostalMessageDefaults,
} from "@shared/message-defaults";
import { escapeHtml, htmlToPlainText, normalizeTemplateHtml } from "@shared/utils/html";

export const messageDefaultsKey = (medium: "email" | "postal") => `message_defaults:${medium}`;

function clean(html: string): string {
  return normalizeTemplateHtml(html, { preserveTokens: false }).trim();
}

export function validateEmailDefaults(value: unknown): EmailMessageDefaults {
  const parsed = emailMessageDefaultsSchema.parse(value);
  return { letterheadHtml: clean(parsed.letterheadHtml) };
}

export function validatePostalDefaults(value: unknown): PostalMessageDefaults {
  const parsed = postalMessageDefaultsSchema.parse(value);
  return { ...parsed, letterheadHtml: clean(parsed.letterheadHtml), footerHtml: clean(parsed.footerHtml) };
}

// Deliberately not cached: queued sends and other server processes must see a
// successful settings save on their next delivery. Never use provider settings.
export async function getEmailDefaults(): Promise<EmailMessageDefaults> {
  const row = await storage.variables.getByName(messageDefaultsKey("email"));
  return validateEmailDefaults(row?.value ?? {});
}

export async function getPostalDefaults(): Promise<PostalMessageDefaults> {
  const row = await storage.variables.getByName(messageDefaultsKey("postal"));
  return validatePostalDefaults(row?.value ?? {});
}

export function prepareEmailContent(
  source: { bodyHtml?: string; bodyText?: string },
  defaults: EmailMessageDefaults,
): { html?: string; text?: string } {
  const body = source.bodyHtml === undefined ? undefined : clean(source.bodyHtml);
  // Validate source BEFORE branding: a letterhead cannot make a blank message
  // deliverable. Plain-text-only system callers are escaped, never parsed.
  if (!(body ?? source.bodyText ?? "").trim()) throw new Error("A message body is required.");
  if (!defaults.letterheadHtml) {
    return { html: body, text: body === undefined ? source.bodyText : htmlToPlainText(body) };
  }
  const html = `${defaults.letterheadHtml}\n<div>${body ?? escapeHtml(source.bodyText ?? "").replace(/\r?\n/g, "<br>")}</div>`;
  return { html, text: htmlToPlainText(html) };
}
