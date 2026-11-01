import type { User } from "@shared/schema";
import type { ContactsStorage } from "../storage/contacts";
import { generateDisplayName } from "@shared/schema";
import { normalizeUserEmail } from "@shared/utils/user-email";

export interface UserContactSyncService {
  ensureContactForUser(user: User, previousEmail?: string | null): Promise<void>;
}

export function createUserContactSyncService(contacts: ContactsStorage): UserContactSyncService {
  return {
    async ensureContactForUser(user: User, previousEmail?: string | null): Promise<void> {
      user = { ...user, email: normalizeUserEmail(user.email) };
      previousEmail = previousEmail?.trim() || null;
      if (!user.email) {
        return;
      }

      let existingContact = await contacts.getContactByEmail(user.email);
      
      if (!existingContact && previousEmail && previousEmail !== user.email) {
        existingContact = await contacts.getContactByEmail(previousEmail);
      }
      
      if (existingContact) {
        const needsEmailUpdate = existingContact.email?.trim().toLowerCase() !== user.email.toLowerCase();
        const needsNameUpdate = 
          (user.firstName && existingContact.given !== user.firstName) ||
          (user.lastName && existingContact.family !== user.lastName);
        
        if (needsEmailUpdate) {
          await contacts.updateEmail(existingContact.id, user.email);
        }
        
        if (needsNameUpdate) {
          await contacts.updateNameComponents(existingContact.id, {
            given: user.firstName || existingContact.given || undefined,
            family: user.lastName || existingContact.family || undefined,
          });
        }
      } else {
        const displayName = generateDisplayName({
          given: user.firstName || null,
          family: user.lastName || null,
        });

        await contacts.createContact({
          displayName: displayName || user.email,
          email: user.email,
          given: user.firstName || null,
          family: user.lastName || null,
        });
      }
    },
  };
}
