import { db } from "../db";
import { contacts, postalAddresses, phoneNumbers, type Contact, type PostalAddress, type InsertPostalAddress, type PhoneNumber, type InsertPhoneNumber } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";

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
}

// Combined Contacts Storage Interface
export interface ContactsStorage {
  getContact(id: string): Promise<Contact | undefined>;
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
    }
  };
}

// Create Contacts Storage with all sub-namespaces
export function createContactsStorage(): ContactsStorage {
  const contactStorage = createContactStorage();
  return {
    getContact: contactStorage.getContact,
    addresses: createAddressStorage(),
    phoneNumbers: createPhoneNumberStorage()
  };
}
