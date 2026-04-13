import type { IStorage } from "../storage/database";
import { BULK_TOKEN_DICTIONARY, getTokenDictionary } from "../../shared/bulk-token-dictionary";

export interface TokenContext {
  contactId: string;
  firstName?: string | null;
  lastName?: string | null;
  displayName?: string | null;
  email?: string | null;
  phone?: string | null;
}

export function getAvailableTokens() {
  return getTokenDictionary();
}

export function replaceTokens(content: string, context: TokenContext): string {
  let result = content;
  for (const tokenDef of BULK_TOKEN_DICTIONARY) {
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
  phone = (primary || active)?.phoneNumber || null;

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
