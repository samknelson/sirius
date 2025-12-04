import { db } from "../db";
import { contacts, contactPostal, phoneNumbers, optionsGender, trustProviderContacts, employerContacts, type Contact, type InsertContact, type ContactPostal, type InsertContactPostal, type PhoneNumber, type InsertPhoneNumber } from "@shared/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { withStorageLogging, type StorageLoggingConfig } from "./middleware/logging";

// Address Storage Interface
export interface AddressStorage {
  getAllContactPostal(): Promise<ContactPostal[]>;
  getContactPostal(id: string): Promise<ContactPostal | undefined>;
  getContactPostalByContact(contactId: string): Promise<ContactPostal[]>;
  createContactPostal(address: InsertContactPostal): Promise<ContactPostal>;
  updateContactPostal(id: string, address: Partial<InsertContactPostal>): Promise<ContactPostal | undefined>;
  deleteContactPostal(id: string): Promise<boolean>;
  setAddressAsPrimary(addressId: string, contactId: string): Promise<ContactPostal | undefined>;
}

// Phone Number Storage Interface
export interface PhoneNumberStorage {
  getAllPhoneNumbers(): Promise<PhoneNumber[]>;
  getPhoneNumber(id: string): Promise<PhoneNumber | undefined>;
  getPhoneNumbersByContact(contactId: string): Promise<PhoneNumber[]>;
  createPhoneNumber(phoneNumber: InsertPhoneNumber): Promise<PhoneNumber>;
  updatePhoneNumber(id: string, phoneNumber: Partial<InsertPhoneNumber>): Promise<PhoneNumber | undefined>;
  deletePhoneNumber(id: string): Promise<boolean>;
  setPhoneNumberAsPrimary(phoneNumberId: string, contactId: string): Promise<PhoneNumber | undefined>;
}

// Contact Storage Interface
export interface ContactStorage {
  getContact(id: string): Promise<Contact | undefined>;
  getContactByEmail(email: string): Promise<Contact | undefined>;
  createContact(contact: InsertContact): Promise<Contact>;
  updateName(contactId: string, name: string): Promise<Contact | undefined>;
  updateNameComponents(contactId: string, components: {
    title?: string;
    given?: string;
    middle?: string;
    family?: string;
    generational?: string;
    credentials?: string;
  }): Promise<Contact | undefined>;
  updateEmail(contactId: string, email: string): Promise<Contact | undefined>;
  updateBirthDate(contactId: string, birthDate: string | null): Promise<Contact | undefined>;
  updateGender(contactId: string, gender: string | null, genderNota: string | null): Promise<Contact | undefined>;
  deleteContact(id: string): Promise<boolean>;
}

// Combined Contacts Storage Interface
export interface ContactsStorage {
  getContact(id: string): Promise<Contact | undefined>;
  getContactByEmail(email: string): Promise<Contact | undefined>;
  createContact(contact: InsertContact): Promise<Contact>;
  updateName(contactId: string, name: string): Promise<Contact | undefined>;
  updateNameComponents(contactId: string, components: {
    title?: string;
    given?: string;
    middle?: string;
    family?: string;
    generational?: string;
    credentials?: string;
  }): Promise<Contact | undefined>;
  updateEmail(contactId: string, email: string): Promise<Contact | undefined>;
  updateBirthDate(contactId: string, birthDate: string | null): Promise<Contact | undefined>;
  updateGender(contactId: string, gender: string | null, genderNota: string | null): Promise<Contact | undefined>;
  deleteContact(id: string): Promise<boolean>;
  addresses: AddressStorage;
  phoneNumbers: PhoneNumberStorage;
}

// Create Address Storage implementation
export function createAddressStorage(): AddressStorage {
  return {
    async getAllContactPostal(): Promise<ContactPostal[]> {
      return await db.select().from(contactPostal);
    },

    async getContactPostal(id: string): Promise<ContactPostal | undefined> {
      const [address] = await db.select().from(contactPostal).where(eq(contactPostal.id, id));
      return address || undefined;
    },

    async getContactPostalByContact(contactId: string): Promise<ContactPostal[]> {
      return await db.select().from(contactPostal).where(eq(contactPostal.contactId, contactId)).orderBy(desc(contactPostal.isPrimary));
    },

    async createContactPostal(insertContactPostal: InsertContactPostal): Promise<ContactPostal> {
      // Validation: Prevent creating an inactive primary address
      if (insertContactPostal.isPrimary && insertContactPostal.isActive === false) {
        throw new Error("Cannot create an inactive address as primary. Either activate the address or don't set it as primary.");
      }

      // If creating a primary address, first unset any existing primary addresses for this contact
      if (insertContactPostal.isPrimary) {
        await db
          .update(contactPostal)
          .set({ isPrimary: false })
          .where(eq(contactPostal.contactId, insertContactPostal.contactId));
      }
      
      const [address] = await db
        .insert(contactPostal)
        .values(insertContactPostal)
        .returning();
      return address;
    },

    async updateContactPostal(id: string, addressUpdate: Partial<InsertContactPostal>): Promise<ContactPostal | undefined> {
      // Get the current address to perform validation checks
      const [currentAddress] = await db.select().from(contactPostal).where(eq(contactPostal.id, id));
      if (!currentAddress) {
        throw new Error("Address not found");
      }

      // Validation: Prevent making a primary address inactive
      if (currentAddress.isPrimary && addressUpdate.isActive === false) {
        throw new Error("Cannot deactivate a primary address. Set another address as primary first.");
      }

      // Validation: Prevent making an inactive address primary
      if (!currentAddress.isActive && addressUpdate.isPrimary === true) {
        throw new Error("Cannot set an inactive address as primary. Activate the address first.");
      }

      // If setting as primary, unset any existing primary addresses for this contact
      if (addressUpdate.isPrimary) {
        await db
          .update(contactPostal)
          .set({ isPrimary: false })
          .where(eq(contactPostal.contactId, currentAddress.contactId));
      }
      
      const [address] = await db
        .update(contactPostal)
        .set(addressUpdate)
        .where(eq(contactPostal.id, id))
        .returning();
      
      return address || undefined;
    },

    async deleteContactPostal(id: string): Promise<boolean> {
      const result = await db.delete(contactPostal).where(eq(contactPostal.id, id)).returning();
      return result.length > 0;
    },

    async setAddressAsPrimary(addressId: string, contactId: string): Promise<ContactPostal | undefined> {
      // Get the current address to validate it can be set as primary
      const [currentAddress] = await db.select().from(contactPostal).where(eq(contactPostal.id, addressId));
      if (!currentAddress) {
        throw new Error("Address not found");
      }

      // Validation: Prevent setting an inactive address as primary
      if (!currentAddress.isActive) {
        throw new Error("Cannot set an inactive address as primary. Activate the address first.");
      }

      // First, unset all primary addresses for this contact
      await db
        .update(contactPostal)
        .set({ isPrimary: false })
        .where(eq(contactPostal.contactId, contactId));
      
      // Then set the specified address as primary
      const [address] = await db
        .update(contactPostal)
        .set({ isPrimary: true })
        .where(and(eq(contactPostal.id, addressId), eq(contactPostal.contactId, contactId)))
        .returning();
      
      return address || undefined;
    }
  };
}

// Create Phone Number Storage implementation
export function createPhoneNumberStorage(): PhoneNumberStorage {
  return {
    async getAllPhoneNumbers(): Promise<PhoneNumber[]> {
      return await db.select().from(phoneNumbers);
    },

    async getPhoneNumber(id: string): Promise<PhoneNumber | undefined> {
      const [phoneNumber] = await db.select().from(phoneNumbers).where(eq(phoneNumbers.id, id));
      return phoneNumber || undefined;
    },

    async getPhoneNumbersByContact(contactId: string): Promise<PhoneNumber[]> {
      return await db.select().from(phoneNumbers).where(eq(phoneNumbers.contactId, contactId)).orderBy(desc(phoneNumbers.isPrimary));
    },

    async createPhoneNumber(insertPhoneNumber: InsertPhoneNumber): Promise<PhoneNumber> {
      // Validation: Prevent creating an inactive primary phone number
      if (insertPhoneNumber.isPrimary && insertPhoneNumber.isActive === false) {
        throw new Error("Cannot create an inactive phone number as primary. Either activate the phone number or don't set it as primary.");
      }

      // If creating a primary phone number, first unset any existing primary phone numbers for this contact
      if (insertPhoneNumber.isPrimary) {
        await db
          .update(phoneNumbers)
          .set({ isPrimary: false })
          .where(eq(phoneNumbers.contactId, insertPhoneNumber.contactId));
      }
      
      const [phoneNumber] = await db
        .insert(phoneNumbers)
        .values(insertPhoneNumber)
        .returning();
      return phoneNumber;
    },

    async updatePhoneNumber(id: string, phoneNumberUpdate: Partial<InsertPhoneNumber>): Promise<PhoneNumber | undefined> {
      // Get the current phone number to perform validation checks
      const [currentPhoneNumber] = await db.select().from(phoneNumbers).where(eq(phoneNumbers.id, id));
      if (!currentPhoneNumber) {
        throw new Error("Phone number not found");
      }

      // Validation: Prevent making a primary phone number inactive
      if (currentPhoneNumber.isPrimary && phoneNumberUpdate.isActive === false) {
        throw new Error("Cannot deactivate a primary phone number. Set another phone number as primary first.");
      }

      // Validation: Prevent making an inactive phone number primary
      if (!currentPhoneNumber.isActive && phoneNumberUpdate.isPrimary === true) {
        throw new Error("Cannot set an inactive phone number as primary. Activate the phone number first.");
      }

      // If setting as primary, unset any existing primary phone numbers for this contact
      if (phoneNumberUpdate.isPrimary) {
        await db
          .update(phoneNumbers)
          .set({ isPrimary: false })
          .where(eq(phoneNumbers.contactId, currentPhoneNumber.contactId));
      }
      
      const [phoneNumber] = await db
        .update(phoneNumbers)
        .set(phoneNumberUpdate)
        .where(eq(phoneNumbers.id, id))
        .returning();
      
      return phoneNumber || undefined;
    },

    async deletePhoneNumber(id: string): Promise<boolean> {
      const result = await db.delete(phoneNumbers).where(eq(phoneNumbers.id, id)).returning();
      return result.length > 0;
    },

    async setPhoneNumberAsPrimary(phoneNumberId: string, contactId: string): Promise<PhoneNumber | undefined> {
      // Get the current phone number to validate it can be set as primary
      const [currentPhoneNumber] = await db.select().from(phoneNumbers).where(eq(phoneNumbers.id, phoneNumberId));
      if (!currentPhoneNumber) {
        throw new Error("Phone number not found");
      }

      // Validation: Prevent setting an inactive phone number as primary
      if (!currentPhoneNumber.isActive) {
        throw new Error("Cannot set an inactive phone number as primary. Activate the phone number first.");
      }

      // First, unset all primary phone numbers for this contact
      await db
        .update(phoneNumbers)
        .set({ isPrimary: false })
        .where(eq(phoneNumbers.contactId, contactId));
      
      // Then set the specified phone number as primary
      const [phoneNumber] = await db
        .update(phoneNumbers)
        .set({ isPrimary: true })
        .where(and(eq(phoneNumbers.id, phoneNumberId), eq(phoneNumbers.contactId, contactId)))
        .returning();
      
      return phoneNumber || undefined;
    }
  };
}

/**
 * Canonicalize a name component by capitalizing the first letter and making the rest lowercase
 * Examples: "JOE" -> "Joe", "joe" -> "Joe", "SMITH" -> "Smith"
 */
function canonicalizeName(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase();
}

/**
 * Trim a name component but preserve its original capitalization
 * Examples: "III" -> "III", "Ph.D." -> "Ph.D.", "Jr." -> "Jr."
 */
function trimName(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed;
}

// Create Contact Storage implementation
export function createContactStorage(): ContactStorage {
  return {
    async getContact(id: string): Promise<Contact | undefined> {
      const [contact] = await db.select().from(contacts).where(eq(contacts.id, id));
      return contact || undefined;
    },

    async getContactByEmail(email: string): Promise<Contact | undefined> {
      const [contact] = await db
        .select()
        .from(contacts)
        .where(
          and(
            sql`${contacts.email} IS NOT NULL`,
            sql`LOWER(${contacts.email}) = LOWER(${email})`
          )
        );
      return contact || undefined;
    },

    async createContact(insertContact: InsertContact): Promise<Contact> {
      // Import the generateDisplayName function
      const { generateDisplayName } = await import("@shared/schema");
      
      // Canonicalize name components (capitalize first letter, rest lowercase)
      // EXCEPT generational suffix and credentials which preserve original capitalization
      const canonicalized = {
        title: canonicalizeName(insertContact.title),
        given: canonicalizeName(insertContact.given),
        middle: canonicalizeName(insertContact.middle),
        family: canonicalizeName(insertContact.family),
        generational: trimName(insertContact.generational),
        credentials: trimName(insertContact.credentials),
      };
      
      // Generate display name from canonicalized components (or use provided displayName)
      const displayName = insertContact.displayName || generateDisplayName(canonicalized);
      
      const [contact] = await db
        .insert(contacts)
        .values({
          ...insertContact,
          title: canonicalized.title,
          given: canonicalized.given,
          middle: canonicalized.middle,
          family: canonicalized.family,
          generational: canonicalized.generational,
          credentials: canonicalized.credentials,
          displayName,
        })
        .returning();
      return contact;
    },

    async updateName(contactId: string, name: string): Promise<Contact | undefined> {
      // For simple name input, parse into given/family names
      const nameParts = name.trim().split(' ');
      const given = nameParts[0] || '';
      const family = nameParts.slice(1).join(' ') || '';
      
      // Canonicalize the parsed name components
      const canonicalizedGiven = canonicalizeName(given);
      const canonicalizedFamily = canonicalizeName(family);
      
      // Generate display name from canonicalized components
      const displayName = [canonicalizedGiven, canonicalizedFamily].filter(Boolean).join(' ');
      
      // Update the contact's name components
      const [contact] = await db
        .update(contacts)
        .set({
          given: canonicalizedGiven,
          family: canonicalizedFamily,
          displayName,
        })
        .where(eq(contacts.id, contactId))
        .returning();
      
      return contact || undefined;
    },

    async updateNameComponents(
      contactId: string,
      components: {
        title?: string;
        given?: string;
        middle?: string;
        family?: string;
        generational?: string;
        credentials?: string;
      }
    ): Promise<Contact | undefined> {
      // Import the generateDisplayName function
      const { generateDisplayName } = await import("@shared/schema");
      
      // Canonicalize name components (capitalize first letter, rest lowercase)
      // EXCEPT generational suffix and credentials which preserve original capitalization
      const canonicalized = {
        title: canonicalizeName(components.title),
        given: canonicalizeName(components.given),
        middle: canonicalizeName(components.middle),
        family: canonicalizeName(components.family),
        generational: trimName(components.generational),
        credentials: trimName(components.credentials),
      };
      
      // Generate display name from canonicalized components
      const displayName = generateDisplayName(canonicalized);
      
      // Update the contact's name components
      const [contact] = await db
        .update(contacts)
        .set({
          title: canonicalized.title,
          given: canonicalized.given,
          middle: canonicalized.middle,
          family: canonicalized.family,
          generational: canonicalized.generational,
          credentials: canonicalized.credentials,
          displayName,
        })
        .where(eq(contacts.id, contactId))
        .returning();
      
      return contact || undefined;
    },

    async updateEmail(contactId: string, email: string): Promise<Contact | undefined> {
      const cleanEmail = email.trim();
      
      // Basic email validation
      if (cleanEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
        throw new Error("Invalid email format");
      }
      
      // Update the contact's email
      const [contact] = await db
        .update(contacts)
        .set({ email: cleanEmail || null })
        .where(eq(contacts.id, contactId))
        .returning();
      
      return contact || undefined;
    },

    async updateBirthDate(contactId: string, birthDate: string | null): Promise<Contact | undefined> {
      // Validate birth date format if provided
      if (birthDate) {
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        if (!dateRegex.test(birthDate)) {
          throw new Error("Invalid date format. Expected YYYY-MM-DD");
        }
        
        // Parse and validate calendar date
        const [yearStr, monthStr, dayStr] = birthDate.split('-');
        const year = parseInt(yearStr, 10);
        const month = parseInt(monthStr, 10);
        const day = parseInt(dayStr, 10);
        
        // Validate month range
        if (month < 1 || month > 12) {
          throw new Error("Invalid month. Must be between 1 and 12");
        }
        
        // Validate day range based on month
        const daysInMonth = [31, (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
        if (day < 1 || day > daysInMonth[month - 1]) {
          throw new Error(`Invalid day. Must be between 1 and ${daysInMonth[month - 1]} for the given month`);
        }
      }
      
      // Update the contact's birth date
      const [contact] = await db
        .update(contacts)
        .set({ birthDate: birthDate || null })
        .where(eq(contacts.id, contactId))
        .returning();
      
      return contact || undefined;
    },

    async updateGender(contactId: string, gender: string | null, genderNota: string | null): Promise<Contact | undefined> {
      // If clearing gender, clear all gender fields
      if (!gender) {
        const [contact] = await db
          .update(contacts)
          .set({ 
            gender: null,
            genderNota: null,
            genderCalc: null
          })
          .where(eq(contacts.id, contactId))
          .returning();
        
        return contact || undefined;
      }
      
      // Fetch the gender option to check if it's nota
      const [genderOption] = await db.select().from(optionsGender).where(eq(optionsGender.id, gender));
      if (!genderOption) {
        throw new Error("Invalid gender option");
      }
      
      // Calculate gender_calc based on whether it's nota or not
      let genderCalc: string;
      let finalGenderNota: string | null = null;
      
      if (genderOption.nota) {
        // For nota options, use the genderNota value
        const cleanGenderNota = genderNota?.trim() || "";
        if (!cleanGenderNota) {
          throw new Error("Gender specification is required for this option");
        }
        genderCalc = cleanGenderNota;
        finalGenderNota = cleanGenderNota;
      } else {
        // For regular options, use the option name
        genderCalc = genderOption.name;
      }
      
      // Update the contact's gender fields
      const [contact] = await db
        .update(contacts)
        .set({ 
          gender,
          genderNota: finalGenderNota,
          genderCalc
        })
        .where(eq(contacts.id, contactId))
        .returning();
      
      return contact || undefined;
    },

    async deleteContact(id: string): Promise<boolean> {
      const result = await db.delete(contacts).where(eq(contacts.id, id)).returning();
      return result.length > 0;
    },
  };
}

// Create Contacts Storage with all sub-namespaces
export function createContactsStorage(
  addressLoggingConfig?: StorageLoggingConfig<AddressStorage>,
  phoneNumberLoggingConfig?: StorageLoggingConfig<PhoneNumberStorage>
): ContactsStorage {
  const contactStorage = createContactStorage();
  
  // Create nested storage instances with optional logging
  const addressStorage = addressLoggingConfig 
    ? withStorageLogging(createAddressStorage(), addressLoggingConfig)
    : createAddressStorage();
    
  const phoneNumberStorage = phoneNumberLoggingConfig
    ? withStorageLogging(createPhoneNumberStorage(), phoneNumberLoggingConfig)
    : createPhoneNumberStorage();
  
  return {
    getContact: contactStorage.getContact,
    getContactByEmail: contactStorage.getContactByEmail,
    createContact: contactStorage.createContact,
    updateName: contactStorage.updateName,
    updateNameComponents: contactStorage.updateNameComponents,
    updateEmail: contactStorage.updateEmail,
    updateBirthDate: contactStorage.updateBirthDate,
    updateGender: contactStorage.updateGender,
    deleteContact: contactStorage.deleteContact,
    addresses: addressStorage,
    phoneNumbers: phoneNumberStorage
  };
}

/**
 * Helper function to format address for display in logs
 */
function formatAddressForLog(address: any): string {
  if (!address) return 'Unknown';
  
  const parts: string[] = [];
  
  // Add street address
  if (address.line1) {
    parts.push(address.line1);
  }
  if (address.line2) {
    parts.push(address.line2);
  }
  
  // Add city, state, postal code
  const cityStateZip: string[] = [];
  if (address.city) cityStateZip.push(address.city);
  if (address.state) cityStateZip.push(address.state);
  if (address.postalCode) cityStateZip.push(address.postalCode);
  
  if (cityStateZip.length > 0) {
    parts.push(cityStateZip.join(', '));
  }
  
  return parts.length > 0 ? parts.join(', ') : 'Unknown';
}

/**
 * Helper function to calculate changes between before and after address states
 */
function calculateAddressChanges(before: any, after: any): Record<string, { from: any; to: any }> {
  if (before === null || before === undefined || after === null || after === undefined) {
    return {};
  }

  if (typeof before !== 'object' || typeof after !== 'object') {
    return before !== after ? { value: { from: before, to: after } } : {};
  }

  const changes: Record<string, { from: any; to: any }> = {};
  const allKeys = Array.from(new Set([...Object.keys(before), ...Object.keys(after)]));

  for (const key of allKeys) {
    const beforeValue = before[key];
    const afterValue = after[key];

    if (JSON.stringify(beforeValue) !== JSON.stringify(afterValue)) {
      changes[key] = { from: beforeValue, to: afterValue };
    }
  }

  return changes;
}

/**
 * Helper function to find the parent entity (trust provider or employer) for a contact
 * Returns the provider/employer ID if found, otherwise returns the contact ID
 */
async function getParentEntityForContact(contactId: string): Promise<string> {
  // Check if contact belongs to a trust provider contact
  const [providerContact] = await db
    .select({ providerId: trustProviderContacts.providerId })
    .from(trustProviderContacts)
    .where(eq(trustProviderContacts.contactId, contactId))
    .limit(1);
  
  if (providerContact) {
    return providerContact.providerId;
  }
  
  // Check if contact belongs to an employer contact
  const [employerContact] = await db
    .select({ employerId: employerContacts.employerId })
    .from(employerContacts)
    .where(eq(employerContacts.contactId, contactId))
    .limit(1);
  
  if (employerContact) {
    return employerContact.employerId;
  }
  
  // Fall back to contact ID if no parent entity found
  return contactId;
}

/**
 * Helper function to format phone number for display in logs
 */
function formatPhoneNumberForLog(phoneNumber: any): string {
  if (!phoneNumber) return 'Unknown';
  
  const parts: string[] = [];
  if (phoneNumber.formattedNumber) {
    parts.push(phoneNumber.formattedNumber);
  } else if (phoneNumber.number) {
    parts.push(phoneNumber.number);
  }
  
  if (phoneNumber.friendlyName) {
    parts.push(`(${phoneNumber.friendlyName})`);
  }
  
  return parts.length > 0 ? parts.join(' ') : 'Unknown';
}

/**
 * Helper function to calculate changes between before and after states
 */
function calculatePhoneNumberChanges(before: any, after: any): Record<string, { from: any; to: any }> {
  if (before === null || before === undefined || after === null || after === undefined) {
    return {};
  }

  if (typeof before !== 'object' || typeof after !== 'object') {
    return before !== after ? { value: { from: before, to: after } } : {};
  }

  const changes: Record<string, { from: any; to: any }> = {};
  const allKeys = Array.from(new Set([...Object.keys(before), ...Object.keys(after)]));

  for (const key of allKeys) {
    const beforeValue = before[key];
    const afterValue = after[key];

    if (JSON.stringify(beforeValue) !== JSON.stringify(afterValue)) {
      changes[key] = { from: beforeValue, to: afterValue };
    }
  }

  return changes;
}

/**
 * Logging configuration for contact storage operations
 * 
 * Logs all contact mutations with full argument capture and change tracking.
 */
export const contactLoggingConfig: StorageLoggingConfig<ContactsStorage> = {
  module: 'contacts',
  methods: {
    createContact: {
      enabled: true,
      getEntityId: (args) => args[0]?.displayName || args[0]?.given || args[0]?.family || 'new contact',
      getHostEntityId: (args, result) => result?.id,
      after: async (args, result, storage) => {
        return result; // Capture created contact
      }
    },
    updateName: {
      enabled: true,
      getEntityId: (args) => args[0], // Contact ID
      getHostEntityId: (args) => args[0], // Contact ID
      before: async (args, storage) => {
        return await storage.getContact(args[0]); // Current state
      },
      after: async (args, result, storage) => {
        return result; // New state (diff auto-calculated)
      }
    },
    updateNameComponents: {
      enabled: true,
      getEntityId: (args) => args[0], // Contact ID
      getHostEntityId: (args) => args[0], // Contact ID
      before: async (args, storage) => {
        return await storage.getContact(args[0]); // Current state
      },
      after: async (args, result, storage) => {
        return result; // New state (diff auto-calculated)
      }
    },
    updateEmail: {
      enabled: true,
      getEntityId: (args) => args[0], // Contact ID
      getHostEntityId: (args) => args[0], // Contact ID
      before: async (args, storage) => {
        return await storage.getContact(args[0]); // Current state
      },
      after: async (args, result, storage) => {
        return result; // New state (diff auto-calculated)
      }
    },
    updateBirthDate: {
      enabled: true,
      getEntityId: (args) => args[0], // Contact ID
      getHostEntityId: (args) => args[0], // Contact ID
      before: async (args, storage) => {
        return await storage.getContact(args[0]); // Current state
      },
      after: async (args, result, storage) => {
        return result; // New state (diff auto-calculated)
      }
    },
    updateGender: {
      enabled: true,
      getEntityId: (args) => args[0], // Contact ID
      getHostEntityId: (args) => args[0], // Contact ID
      before: async (args, storage) => {
        return await storage.getContact(args[0]); // Current state
      },
      after: async (args, result, storage) => {
        return result; // New state (diff auto-calculated)
      }
    },
    deleteContact: {
      enabled: true,
      getEntityId: (args) => args[0], // Contact ID
      getHostEntityId: (args) => args[0], // Contact ID
      before: async (args, storage) => {
        return await storage.getContact(args[0]); // Capture what's being deleted
      }
    }
  }
};

/**
 * Logging configuration for address storage operations
 * 
 * Logs all postal address mutations with full argument capture and change tracking.
 * Associates logs with parent entity (trust provider or employer) when applicable.
 */
export const addressLoggingConfig: StorageLoggingConfig<AddressStorage> = {
  module: 'contacts.addresses',
  methods: {
    createContactPostal: {
      enabled: true,
      getEntityId: (args) => args[0]?.contactId || 'new address',
      getHostEntityId: async (args, result) => {
        const contactId = result?.contactId || args[0]?.contactId;
        return await getParentEntityForContact(contactId);
      },
      after: async (args, result, storage) => {
        return result; // Capture created address
      },
      getDescription: (args, result, beforeState, afterState) => {
        const addressDisplay = formatAddressForLog(afterState);
        return `Created address "${addressDisplay}"`;
      }
    },
    updateContactPostal: {
      enabled: true,
      getEntityId: (args) => args[0], // Address ID
      getHostEntityId: async (args, result, beforeState) => {
        const contactId = result?.contactId || beforeState?.contactId;
        return await getParentEntityForContact(contactId);
      },
      before: async (args, storage) => {
        return await storage.getContactPostal(args[0]); // Current state
      },
      after: async (args, result, storage) => {
        return result; // New state (diff auto-calculated)
      },
      getDescription: (args, result, beforeState, afterState) => {
        const addressDisplay = formatAddressForLog(afterState || beforeState);
        const changes = calculateAddressChanges(beforeState, afterState);
        const changedFields = Object.keys(changes);
        
        if (changedFields.length === 0) {
          return `Updated address "${addressDisplay}" (no changes detected)`;
        }
        
        const fieldList = changedFields.join(', ');
        return `Updated address "${addressDisplay}" (changed: ${fieldList})`;
      }
    },
    deleteContactPostal: {
      enabled: true,
      getEntityId: (args) => args[0], // Address ID
      getHostEntityId: async (args, result, beforeState) => {
        const contactId = beforeState?.contactId;
        return await getParentEntityForContact(contactId);
      },
      before: async (args, storage) => {
        return await storage.getContactPostal(args[0]); // Capture what's being deleted
      },
      getDescription: (args, result, beforeState, afterState) => {
        const addressDisplay = formatAddressForLog(beforeState);
        return `Deleted address "${addressDisplay}"`;
      }
    },
    setAddressAsPrimary: {
      enabled: true,
      getEntityId: (args) => args[0], // Address ID
      getHostEntityId: async (args, result, beforeState) => {
        const contactId = result?.contactId || beforeState?.contactId;
        return await getParentEntityForContact(contactId);
      },
      before: async (args, storage) => {
        return await storage.getContactPostal(args[0]); // Current state
      },
      after: async (args, result, storage) => {
        return result; // New state (diff auto-calculated)
      },
      getDescription: (args, result, beforeState, afterState) => {
        const addressDisplay = formatAddressForLog(afterState || beforeState);
        return `Set address "${addressDisplay}" as primary`;
      }
    }
  }
};

/**
 * Logging configuration for phone number storage operations
 * 
 * Logs all phone number mutations with full argument capture and change tracking.
 * Associates logs with parent entity (trust provider or employer) when applicable.
 */
export const phoneNumberLoggingConfig: StorageLoggingConfig<PhoneNumberStorage> = {
  module: 'contacts.phoneNumbers',
  methods: {
    createPhoneNumber: {
      enabled: true,
      getEntityId: (args) => args[0]?.contactId || 'new phone',
      getHostEntityId: async (args, result) => {
        const contactId = result?.contactId || args[0]?.contactId;
        return await getParentEntityForContact(contactId);
      },
      after: async (args, result, storage) => {
        return result; // Capture created phone number
      },
      getDescription: (args, result, beforeState, afterState) => {
        const phoneDisplay = formatPhoneNumberForLog(afterState);
        return `Created phone number "${phoneDisplay}"`;
      }
    },
    updatePhoneNumber: {
      enabled: true,
      getEntityId: (args) => args[0], // Phone number ID
      getHostEntityId: async (args, result, beforeState) => {
        const contactId = result?.contactId || beforeState?.contactId;
        return await getParentEntityForContact(contactId);
      },
      before: async (args, storage) => {
        return await storage.getPhoneNumber(args[0]); // Current state
      },
      after: async (args, result, storage) => {
        return result; // New state (diff auto-calculated)
      },
      getDescription: (args, result, beforeState, afterState) => {
        const phoneDisplay = formatPhoneNumberForLog(afterState || beforeState);
        const changes = calculatePhoneNumberChanges(beforeState, afterState);
        const changedFields = Object.keys(changes);
        
        if (changedFields.length === 0) {
          return `Updated phone number "${phoneDisplay}" (no changes detected)`;
        }
        
        const fieldList = changedFields.join(', ');
        return `Updated phone number "${phoneDisplay}" (changed: ${fieldList})`;
      }
    },
    deletePhoneNumber: {
      enabled: true,
      getEntityId: (args) => args[0], // Phone number ID
      getHostEntityId: async (args, result, beforeState) => {
        const contactId = beforeState?.contactId;
        return await getParentEntityForContact(contactId);
      },
      before: async (args, storage) => {
        return await storage.getPhoneNumber(args[0]); // Capture what's being deleted
      },
      getDescription: (args, result, beforeState, afterState) => {
        const phoneDisplay = formatPhoneNumberForLog(beforeState);
        return `Deleted phone number "${phoneDisplay}"`;
      }
    },
    setPhoneNumberAsPrimary: {
      enabled: true,
      getEntityId: (args) => args[0], // Phone number ID
      getHostEntityId: async (args, result, beforeState) => {
        const contactId = result?.contactId || beforeState?.contactId;
        return await getParentEntityForContact(contactId);
      },
      before: async (args, storage) => {
        return await storage.getPhoneNumber(args[0]); // Current state
      },
      after: async (args, result, storage) => {
        return result; // New state (diff auto-calculated)
      },
      getDescription: (args, result, beforeState, afterState) => {
        const phoneDisplay = formatPhoneNumberForLog(afterState || beforeState);
        return `Set phone number "${phoneDisplay}" as primary`;
      }
    }
  }
};
