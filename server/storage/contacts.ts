import { db } from "../db";
import { contacts, postalAddresses, phoneNumbers, optionsGender, type Contact, type InsertContact, type PostalAddress, type InsertPostalAddress, type PhoneNumber, type InsertPhoneNumber } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { withStorageLogging, type StorageLoggingConfig } from "./middleware/logging";

// Address Storage Interface
export interface AddressStorage {
  getAllPostalAddresses(): Promise<PostalAddress[]>;
  getPostalAddress(id: string): Promise<PostalAddress | undefined>;
  getPostalAddressesByContact(contactId: string): Promise<PostalAddress[]>;
  createPostalAddress(address: InsertPostalAddress): Promise<PostalAddress>;
  updatePostalAddress(id: string, address: Partial<InsertPostalAddress>): Promise<PostalAddress | undefined>;
  deletePostalAddress(id: string): Promise<boolean>;
  setAddressAsPrimary(addressId: string, contactId: string): Promise<PostalAddress | undefined>;
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
    async getAllPostalAddresses(): Promise<PostalAddress[]> {
      return await db.select().from(postalAddresses);
    },

    async getPostalAddress(id: string): Promise<PostalAddress | undefined> {
      const [address] = await db.select().from(postalAddresses).where(eq(postalAddresses.id, id));
      return address || undefined;
    },

    async getPostalAddressesByContact(contactId: string): Promise<PostalAddress[]> {
      return await db.select().from(postalAddresses).where(eq(postalAddresses.contactId, contactId)).orderBy(desc(postalAddresses.isPrimary));
    },

    async createPostalAddress(insertPostalAddress: InsertPostalAddress): Promise<PostalAddress> {
      // Validation: Prevent creating an inactive primary address
      if (insertPostalAddress.isPrimary && insertPostalAddress.isActive === false) {
        throw new Error("Cannot create an inactive address as primary. Either activate the address or don't set it as primary.");
      }

      // If creating a primary address, first unset any existing primary addresses for this contact
      if (insertPostalAddress.isPrimary) {
        await db
          .update(postalAddresses)
          .set({ isPrimary: false })
          .where(eq(postalAddresses.contactId, insertPostalAddress.contactId));
      }
      
      const [address] = await db
        .insert(postalAddresses)
        .values(insertPostalAddress)
        .returning();
      return address;
    },

    async updatePostalAddress(id: string, addressUpdate: Partial<InsertPostalAddress>): Promise<PostalAddress | undefined> {
      // Get the current address to perform validation checks
      const [currentAddress] = await db.select().from(postalAddresses).where(eq(postalAddresses.id, id));
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
          .update(postalAddresses)
          .set({ isPrimary: false })
          .where(eq(postalAddresses.contactId, currentAddress.contactId));
      }
      
      const [address] = await db
        .update(postalAddresses)
        .set(addressUpdate)
        .where(eq(postalAddresses.id, id))
        .returning();
      
      return address || undefined;
    },

    async deletePostalAddress(id: string): Promise<boolean> {
      const result = await db.delete(postalAddresses).where(eq(postalAddresses.id, id)).returning();
      return result.length > 0;
    },

    async setAddressAsPrimary(addressId: string, contactId: string): Promise<PostalAddress | undefined> {
      // Get the current address to validate it can be set as primary
      const [currentAddress] = await db.select().from(postalAddresses).where(eq(postalAddresses.id, addressId));
      if (!currentAddress) {
        throw new Error("Address not found");
      }

      // Validation: Prevent setting an inactive address as primary
      if (!currentAddress.isActive) {
        throw new Error("Cannot set an inactive address as primary. Activate the address first.");
      }

      // First, unset all primary addresses for this contact
      await db
        .update(postalAddresses)
        .set({ isPrimary: false })
        .where(eq(postalAddresses.contactId, contactId));
      
      // Then set the specified address as primary
      const [address] = await db
        .update(postalAddresses)
        .set({ isPrimary: true })
        .where(and(eq(postalAddresses.id, addressId), eq(postalAddresses.contactId, contactId)))
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

// Create Contact Storage implementation
export function createContactStorage(): ContactStorage {
  return {
    async getContact(id: string): Promise<Contact | undefined> {
      const [contact] = await db.select().from(contacts).where(eq(contacts.id, id));
      return contact || undefined;
    },

    async createContact(insertContact: InsertContact): Promise<Contact> {
      const [contact] = await db
        .insert(contacts)
        .values(insertContact)
        .returning();
      return contact;
    },

    async updateName(contactId: string, name: string): Promise<Contact | undefined> {
      // For simple name input, parse into given/family names
      const nameParts = name.trim().split(' ');
      const given = nameParts[0] || '';
      const family = nameParts.slice(1).join(' ') || '';
      
      // Update the contact's name components
      const [contact] = await db
        .update(contacts)
        .set({
          given: given || null,
          family: family || null,
          displayName: name,
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
      
      // Generate display name from components
      const displayName = generateDisplayName(components);
      
      // Update the contact's name components
      const [contact] = await db
        .update(contacts)
        .set({
          title: components.title?.trim() || null,
          given: components.given?.trim() || null,
          middle: components.middle?.trim() || null,
          family: components.family?.trim() || null,
          generational: components.generational?.trim() || null,
          credentials: components.credentials?.trim() || null,
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
