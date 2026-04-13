import type { IStorage } from "../storage/database";

export interface TokenContext {
  contactId: string;
  firstName?: string | null;
  lastName?: string | null;
  displayName?: string | null;
  email?: string | null;
  phone?: string | null;
}

const SUPPORTED_TOKENS = [
  { pattern: /\[FirstName\]/gi, key: "firstName" },
  { pattern: /\[LastName\]/gi, key: "lastName" },
  { pattern: /\[DisplayName\]/gi, key: "displayName" },
  { pattern: /\[Email\]/gi, key: "email" },
  { pattern: /\[Phone\]/gi, key: "phone" },
] as const;

export function getAvailableTokens(): Array<{ token: string; description: string }> {
  return [
    { token: "[FirstName]", description: "Contact's first name" },
    { token: "[LastName]", description: "Contact's last name" },
    { token: "[DisplayName]", description: "Contact's display name" },
    { token: "[Email]", description: "Contact's email address" },
    { token: "[Phone]", description: "Contact's primary phone number" },
  ];
}

export function replaceTokens(content: string, context: TokenContext): string {
  let result = content;
  for (const tokenDef of SUPPORTED_TOKENS) {
    const value = context[tokenDef.key as keyof TokenContext] as string | null | undefined;
    result = result.replace(tokenDef.pattern, value || "");
  }
  return result;
}

export async function resolveTokenContext(
  storage: IStorage,
  contactId: string,
): Promise<TokenContext> {
  const contact = await storage.contacts.getContact(contactId);
  if (!contact) {
    return { contactId };
  }

  let phone: string | null = null;
  const phones = await storage.contacts.phoneNumbers.getPhoneNumbersByContact(contactId);
  const primary = phones.find(p => p.isPrimary && p.isActive);
  const active = phones.find(p => p.isActive);
  phone = (primary || active)?.number || null;

  return {
    contactId,
    firstName: contact.given || null,
    lastName: contact.family || null,
    displayName: contact.displayName || null,
    email: contact.email || null,
    phone,
  };
}

export async function resolveAndReplace(
  storage: IStorage,
  contactId: string,
  content: string,
): Promise<string> {
  const context = await resolveTokenContext(storage, contactId);
  return replaceTokens(content, context);
}
