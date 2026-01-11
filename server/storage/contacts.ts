import { getClient } from './transaction-context';
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
  updateEmail(contactId: string, email: string | null): Promise<Contact | undefined>;
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
  updateEmail(contactId: string, email: string | null): Promise<Contact | undefined>;
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
      const client = getClient();
      return await client.select().from(contactPostal);
    },

    async getContactPostal(id: string): Promise<ContactPostal | undefined> {
      const client = getClient();
      const [address] = await client.select().from(contactPostal).where(eq(contactPostal.id, id));
      return address || undefined;
    },

    async getContactPostalByContact(contactId: string): Promise<ContactPostal[]> {
      const client = getClient();
      return await client.select().from(contactPostal).where(eq(contactPostal.contactId, contactId)).orderBy(desc(contactPostal.isPrimary));
    },

    async createContactPostal(insertContactPostal: InsertContactPostal): Promise<ContactPostal> {
      const client = getClient();
      // Validation: Prevent creating an inactive primary address
      if (insertContactPostal.isPrimary && insertContactPostal.isActive === false) {
        throw new Error("Cannot create an inactive address as primary. Either activate the address or don't set it as primary.");
      }

      // If creating a primary address, first unset any existing primary addresses for this contact
      if (insertContactPostal.isPrimary) {
        await client
          .update(contactPostal)
          .set({ isPrimary: false })
          .where(eq(contactPostal.contactId, insertContactPostal.contactId));
      }
      
      const [address] = await client
        .insert(contactPostal)
        .values(insertContactPostal)
        .returning();
      return address;
    },

    async updateContactPostal(id: string, addressUpdate: Partial<InsertContactPostal>): Promise<ContactPostal | undefined> {
      const client = getClient();
      // Get the current address to perform validation checks
      const [currentAddress] = await client.select().from(contactPostal).where(eq(contactPostal.id, id));
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
        await client
          .update(contactPostal)
          .set({ isPrimary: false })
          .where(eq(contactPostal.contactId, currentAddress.contactId));
      }
      
      const [address] = await client
        .update(contactPostal)
        .set(addressUpdate)
        .where(eq(contactPostal.id, id))
        .returning();
      
      return address || undefined;
    },

    async deleteContactPostal(id: string): Promise<boolean> {
      const client = getClient();
      const result = await client.delete(contactPostal).where(eq(contactPostal.id, id)).returning();
      return result.length > 0;
    },

    async setAddressAsPrimary(addressId: string, contactId: string): Promise<ContactPostal | undefined> {
      const client = getClient();
      // Get the current address to validate it can be set as primary
      const [currentAddress] = await client.select().from(contactPostal).where(eq(contactPostal.id, addressId));
      if (!currentAddress) {
        throw new Error("Address not found");
      }

      // Validation: Prevent setting an inactive address as primary
      if (!currentAddress.isActive) {
        throw new Error("Cannot set an inactive address as primary. Activate the address first.");
      }

      // First, unset all primary addresses for this contact
      await client
        .update(contactPostal)
        .set({ isPrimary: false })
        .where(eq(contactPostal.contactId, contactId));
      
      // Then set the specified address as primary
      const [address] = await client
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
      const client = getClient();
      return await client.select().from(phoneNumbers);
    },

    async getPhoneNumber(id: string): Promise<PhoneNumber | undefined> {
      const client = getClient();
      const [phoneNumber] = await client.select().from(phoneNumbers).where(eq(phoneNumbers.id, id));
      return phoneNumber || undefined;
    },

    async getPhoneNumbersByContact(contactId: string): Promise<PhoneNumber[]> {
      const client = getClient();
      return await client.select().from(phoneNumbers).where(eq(phoneNumbers.contactId, contactId)).orderBy(desc(phoneNumbers.isPrimary));
    },

    async createPhoneNumber(insertPhoneNumber: InsertPhoneNumber): Promise<PhoneNumber> {
      const client = getClient();
      // Validation: Prevent creating an inactive primary phone number
      if (insertPhoneNumber.isPrimary && insertPhoneNumber.isActive === false) {
        throw new Error("Cannot create an inactive phone number as primary. Either activate the phone number or don't set it as primary.");
      }

      // If creating a primary phone number, first unset any existing primary phone numbers for this contact
      if (insertPhoneNumber.isPrimary) {
        await client
          .update(phoneNumbers)
          .set({ isPrimary: false })
          .where(eq(phoneNumbers.contactId, insertPhoneNumber.contactId));
      }
      
      const [phoneNumber] = await client
        .insert(phoneNumbers)
        .values(insertPhoneNumber)
        .returning();
      return phoneNumber;
    },

    async updatePhoneNumber(id: string, phoneNumberUpdate: Partial<InsertPhoneNumber>): Promise<PhoneNumber | undefined> {
      const client = getClient();
      // Get the current phone number to perform validation checks
      const [currentPhoneNumber] = await client.select().from(phoneNumbers).where(eq(phoneNumbers.id, id));
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
        await client
          .update(phoneNumbers)
          .set({ isPrimary: false })
          .where(eq(phoneNumbers.contactId, currentPhoneNumber.contactId));
      }
      
      const [phoneNumber] = await client
        .update(phoneNumbers)
        .set(phoneNumberUpdate)
        .where(eq(phoneNumbers.id, id))
        .returning();
      
      return phoneNumber || undefined;
    },

    async deletePhoneNumber(id: string): Promise<boolean> {
      const client = getClient();
      const result = await client.delete(phoneNumbers).where(eq(phoneNumbers.id, id)).returning();
      return result.length > 0;
    },

    async setPhoneNumberAsPrimary(phoneNumberId: string, contactId: string): Promise<PhoneNumber | undefined> {
      const client = getClient();
      // Get the current phone number to validate it can be set as primary
      const [currentPhoneNumber] = await client.select().from(phoneNumbers).where(eq(phoneNumbers.id, phoneNumberId));
      if (!currentPhoneNumber) {
        throw new Error("Phone number not found");
      }

      // Validation: Prevent setting an inactive phone number as primary
      if (!currentPhoneNumber.isActive) {
        throw new Error("Cannot set an inactive phone number as primary. Activate the phone number first.");
      }

      // First, unset all primary phone numbers for this contact
      await client
        .update(phoneNumbers)
        .set({ isPrimary: false })
        .where(eq(phoneNumbers.contactId, contactId));
      
      // Then set the specified phone number as primary
      const [phoneNumber] = await client
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
      const client = getClient();
      const [contact] = await client.select().from(contacts).where(eq(contacts.id, id));
      return contact || undefined;
    },

    async getContactByEmail(email: string): Promise<Contact | undefined> {
      const client = getClient();
      const [contact] = await client
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
      const client = getClient();
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
      
      const [contact] = await client
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
      const client = getClient();
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
      const [contact] = await client
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
      const client = getClient();
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
      const [contact] = await client
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

    async updateEmail(contactId: string, email: string | null): Promise<Contact | undefined> {
      const client = getClient();
      const cleanEmail = email?.trim() ?? "";
      
      // Basic email validation
      if (cleanEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
        throw new Error("Invalid email format");
      }
      
      // Update the contact's email
      const [contact] = await client
        .update(contacts)
        .set({ email: cleanEmail || null })
        .where(eq(contacts.id, contactId))
        .returning();
      
      return contact || undefined;
    },

    async updateBirthDate(contactId: string, birthDate: string | null): Promise<Contact | undefined> {
      const client = getClient();
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
      const [contact] = await client
        .update(contacts)
        .set({ birthDate: birthDate || null })
        .where(eq(contacts.id, contactId))
        .returning();
      
      return contact || undefined;
    },

    async updateGender(contactId: string, gender: string | null, genderNota: string | null): Promise<Contact | undefined> {
      const client = getClient();
      // If clearing gender, clear all gender fields
      if (!gender) {
        const [contact] = await client
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
      const [genderOption] = await client.select().from(optionsGender).where(eq(optionsGender.id, gender));
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
      const [contact] = await client
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
      const client = getClient();
      const result = await client.delete(contacts).where(eq(contacts.id, id)).returning();
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
  
  return parts.length > 0 ? parts.join(', ') : 'No address details';
}

/**
 * Logging configuration for address storage operations
 */
export const addressLoggingConfig: StorageLoggingConfig<AddressStorage> = {
  module: 'contacts.addresses',
  methods: {
    createContactPostal: {
      enabled: true,
      getEntityId: (args) => args[0]?.contactId || 'new address',
      getHostEntityId: (args, result) => result?.contactId,
      after: async (args, result) => {
        return result;
      },
      getDescription: async (args, result) => {
        const address = result;
        return `Created address: ${formatAddressForLog(address)}`;
      }
    },
    updateContactPostal: {
      enabled: true,
      getEntityId: (args) => args[0],
      getHostEntityId: async (args, result, beforeState) => {
        return result?.contactId || beforeState?.contactId;
      },
      before: async (args, storage) => {
        return await storage.getContactPostal(args[0]);
      },
      after: async (args, result) => {
        return result;
      },
      getDescription: async (args, result, beforeState, afterState) => {
        const address = afterState || beforeState;
        const changes: string[] = [];
        
        if (beforeState && afterState) {
          if (beforeState.isPrimary !== afterState.isPrimary) {
            changes.push(afterState.isPrimary ? 'set as primary' : 'unset as primary');
          }
          if (beforeState.isActive !== afterState.isActive) {
            changes.push(afterState.isActive ? 'activated' : 'deactivated');
          }
        }
        
        if (changes.length > 0) {
          return `Updated address (${changes.join(', ')}): ${formatAddressForLog(address)}`;
        }
        return `Updated address: ${formatAddressForLog(address)}`;
      }
    },
    deleteContactPostal: {
      enabled: true,
      getEntityId: (args) => args[0],
      getHostEntityId: async (args, result, beforeState) => {
        return beforeState?.contactId;
      },
      before: async (args, storage) => {
        return await storage.getContactPostal(args[0]);
      },
      getDescription: async (args, result, beforeState) => {
        return `Deleted address: ${formatAddressForLog(beforeState)}`;
      }
    },
    setAddressAsPrimary: {
      enabled: true,
      getEntityId: (args) => args[0],
      getHostEntityId: (args) => args[1],
      before: async (args, storage) => {
        return await storage.getContactPostal(args[0]);
      },
      after: async (args, result) => {
        return result;
      },
      getDescription: async (args, result) => {
        return `Set address as primary: ${formatAddressForLog(result)}`;
      }
    }
  }
};

/**
 * Helper function to format phone number for display in logs
 */
function formatPhoneNumberForLog(phoneNumber: any): string {
  if (!phoneNumber) return 'Unknown';
  
  const parts: string[] = [];
  
  if (phoneNumber.phoneNumber) {
    parts.push(phoneNumber.phoneNumber);
  }
  
  if (phoneNumber.label) {
    parts.push(`(${phoneNumber.label})`);
  }
  
  return parts.length > 0 ? parts.join(' ') : 'No phone number details';
}

/**
 * Logging configuration for phone number storage operations
 */
export const phoneNumberLoggingConfig: StorageLoggingConfig<PhoneNumberStorage> = {
  module: 'contacts.phoneNumbers',
  methods: {
    createPhoneNumber: {
      enabled: true,
      getEntityId: (args) => args[0]?.contactId || 'new phone number',
      getHostEntityId: (args, result) => result?.contactId,
      after: async (args, result) => {
        return result;
      },
      getDescription: async (args, result) => {
        return `Created phone number: ${formatPhoneNumberForLog(result)}`;
      }
    },
    updatePhoneNumber: {
      enabled: true,
      getEntityId: (args) => args[0],
      getHostEntityId: async (args, result, beforeState) => {
        return result?.contactId || beforeState?.contactId;
      },
      before: async (args, storage) => {
        return await storage.getPhoneNumber(args[0]);
      },
      after: async (args, result) => {
        return result;
      },
      getDescription: async (args, result, beforeState, afterState) => {
        const phoneNumber = afterState || beforeState;
        const changes: string[] = [];
        
        if (beforeState && afterState) {
          if (beforeState.isPrimary !== afterState.isPrimary) {
            changes.push(afterState.isPrimary ? 'set as primary' : 'unset as primary');
          }
          if (beforeState.isActive !== afterState.isActive) {
            changes.push(afterState.isActive ? 'activated' : 'deactivated');
          }
        }
        
        if (changes.length > 0) {
          return `Updated phone number (${changes.join(', ')}): ${formatPhoneNumberForLog(phoneNumber)}`;
        }
        return `Updated phone number: ${formatPhoneNumberForLog(phoneNumber)}`;
      }
    },
    deletePhoneNumber: {
      enabled: true,
      getEntityId: (args) => args[0],
      getHostEntityId: async (args, result, beforeState) => {
        return beforeState?.contactId;
      },
      before: async (args, storage) => {
        return await storage.getPhoneNumber(args[0]);
      },
      getDescription: async (args, result, beforeState) => {
        return `Deleted phone number: ${formatPhoneNumberForLog(beforeState)}`;
      }
    },
    setPhoneNumberAsPrimary: {
      enabled: true,
      getEntityId: (args) => args[0],
      getHostEntityId: (args) => args[1],
      before: async (args, storage) => {
        return await storage.getPhoneNumber(args[0]);
      },
      after: async (args, result) => {
        return result;
      },
      getDescription: async (args, result) => {
        return `Set phone number as primary: ${formatPhoneNumberForLog(result)}`;
      }
    }
  }
};

export const contactLoggingConfig: StorageLoggingConfig<ContactStorage> = {
  module: 'contacts',
  methods: {
    createContact: {
      enabled: true,
      getEntityId: (args, result) => result?.id || 'new contact',
      getHostEntityId: (args, result) => result?.id,
      after: async (args, result) => {
        return result;
      },
      getDescription: async (args, result) => {
        return `Created contact: ${result?.displayName || result?.email || 'Unknown'}`;
      }
    },
    updateName: {
      enabled: true,
      getEntityId: (args) => args[0],
      getHostEntityId: (args) => args[0],
      before: async (args, storage) => {
        return await storage.getContact(args[0]);
      },
      after: async (args, result) => {
        return result;
      },
      getDescription: async (args, result, beforeState) => {
        const oldName = beforeState?.displayName || 'Unknown';
        const newName = result?.displayName || args[1] || 'Unknown';
        return `Updated contact name: ${oldName} -> ${newName}`;
      }
    },
    updateNameComponents: {
      enabled: true,
      getEntityId: (args) => args[0],
      getHostEntityId: (args) => args[0],
      before: async (args, storage) => {
        return await storage.getContact(args[0]);
      },
      after: async (args, result) => {
        return result;
      },
      getDescription: async (args, result, beforeState) => {
        const oldName = beforeState?.displayName || 'Unknown';
        const newName = result?.displayName || 'Unknown';
        return `Updated contact name components: ${oldName} -> ${newName}`;
      }
    },
    updateEmail: {
      enabled: true,
      getEntityId: (args) => args[0],
      getHostEntityId: (args) => args[0],
      before: async (args, storage) => {
        return await storage.getContact(args[0]);
      },
      after: async (args, result) => {
        return result;
      },
      getDescription: async (args, result, beforeState) => {
        const oldEmail = beforeState?.email || 'none';
        const newEmail = result?.email || args[1] || 'none';
        return `Updated contact email: ${oldEmail} -> ${newEmail}`;
      }
    },
    updateBirthDate: {
      enabled: true,
      getEntityId: (args) => args[0],
      getHostEntityId: (args) => args[0],
      before: async (args, storage) => {
        return await storage.getContact(args[0]);
      },
      after: async (args, result) => {
        return result;
      },
      getDescription: async (args, result) => {
        return `Updated contact birth date for: ${result?.displayName || 'Unknown'}`;
      }
    },
    updateGender: {
      enabled: true,
      getEntityId: (args) => args[0],
      getHostEntityId: (args) => args[0],
      before: async (args, storage) => {
        return await storage.getContact(args[0]);
      },
      after: async (args, result) => {
        return result;
      },
      getDescription: async (args, result) => {
        return `Updated contact gender for: ${result?.displayName || 'Unknown'}`;
      }
    },
    deleteContact: {
      enabled: true,
      getEntityId: (args) => args[0],
      getHostEntityId: async (args, result, beforeState) => beforeState?.id || args[0],
      before: async (args, storage) => {
        return await storage.getContact(args[0]);
      },
      getDescription: async (args, result, beforeState) => {
        return `Deleted contact: ${beforeState?.displayName || 'Unknown'}`;
      }
    }
  }
};
