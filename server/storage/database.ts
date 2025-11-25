import { type VariableStorage, createVariableStorage } from "./variables";
import { type UserStorage, createUserStorage } from "./users";
import { type WorkerStorage, createWorkerStorage, workerLoggingConfig } from "./workers";
import { type EmployerStorage, createEmployerStorage } from "./employers";
import { type ContactsStorage, createContactsStorage, type AddressStorage, type PhoneNumberStorage } from "./contacts";
import { type OptionsStorage, createOptionsStorage, createEmployerContactTypeStorage, type EmployerContactTypeStorage } from "./options";
import { type TrustBenefitStorage, createTrustBenefitStorage } from "./trust-benefits";
import { type TrustProviderStorage, createTrustProviderStorage } from "./trust-providers";
import { type TrustProviderContactStorage, createTrustProviderContactStorage, trustProviderContactLoggingConfig } from "./trust-provider-contacts";
import { type WorkerIdStorage, createWorkerIdStorage } from "./worker-ids";
import { type BookmarkStorage, createBookmarkStorage } from "./bookmarks";
import { type LedgerStorage, createLedgerStorage } from "./ledger";
import { type EmployerContactStorage, createEmployerContactStorage, employerContactLoggingConfig } from "./employer-contacts";
import { type WizardStorage, createWizardStorage } from "./wizards";
import { type WizardFeedMappingStorage, createWizardFeedMappingStorage } from "./wizard_feed_mappings";
import { type WizardEmployerMonthlyStorage, createWizardEmployerMonthlyStorage } from "./wizard_employer_monthly";
import { type FileStorage, createFileStorage, fileLoggingConfig } from "./files";
import { type CronJobStorage, createCronJobStorage, type CronJobRunStorage, createCronJobRunStorage } from "./cron_jobs";
import { type ChargePluginConfigStorage, createChargePluginConfigStorage } from "./charge-plugins";
import { withStorageLogging, type StorageLoggingConfig } from "./middleware/logging";
import { db } from "../db";
import { optionsWorkerIdType, optionsEmploymentStatus, employers, workers, contacts, trustProviderContacts, employerContacts } from "@shared/schema";
import { eq } from "drizzle-orm";
import { wizardRegistry } from "../wizards";

export interface IStorage {
  variables: VariableStorage;
  users: UserStorage;
  workers: WorkerStorage;
  employers: EmployerStorage;
  contacts: ContactsStorage;
  options: OptionsStorage;
  trustBenefits: TrustBenefitStorage;
  trustProviders: TrustProviderStorage;
  trustProviderContacts: TrustProviderContactStorage;
  workerIds: WorkerIdStorage;
  bookmarks: BookmarkStorage;
  ledger: LedgerStorage;
  employerContacts: EmployerContactStorage;
  wizards: WizardStorage;
  wizardFeedMappings: WizardFeedMappingStorage;
  wizardEmployerMonthly: WizardEmployerMonthlyStorage;
  files: FileStorage;
  cronJobs: CronJobStorage;
  cronJobRuns: CronJobRunStorage;
  chargePluginConfigs: ChargePluginConfigStorage;
}

/**
 * Logging configuration for variable storage operations
 * 
 * Logs all create/update/delete operations with full argument capture and change tracking.
 * 
 * Log output includes:
 * - createVariable: Arguments + created result
 * - updateVariable: Arguments + before/after states + diff of what changed
 * - deleteVariable: Arguments + before state (what was deleted)
 * 
 * To add logging to other storage modules, follow this pattern:
 * 1. Define a StorageLoggingConfig<YourStorage> with the module name
 * 2. For each method to log, specify:
 *    - enabled: true
 *    - getEntityId: Extract a human-readable ID from args/result
 *    - before: Capture state before operation (for updates/deletes)
 *    - after: Capture state after operation (for creates/updates)
 * 3. Wrap the storage factory: withStorageLogging(createYourStorage(), config)
 */
const variableLoggingConfig: StorageLoggingConfig<VariableStorage> = {
  module: 'variables',
  methods: {
    create: {
      enabled: true,
      getEntityId: (args) => args[0]?.name, // Variable name
      after: async (args, result, storage) => {
        return result; // Capture created variable
      }
    },
    update: {
      enabled: true,
      getEntityId: (args) => args[0], // Variable ID
      before: async (args, storage) => {
        return await storage.get(args[0]); // Current state
      },
      after: async (args, result, storage) => {
        return result; // New state (diff auto-calculated)
      }
    },
    delete: {
      enabled: true,
      getEntityId: (args) => args[0], // Variable ID
      before: async (args, storage) => {
        return await storage.get(args[0]); // Capture what's being deleted
      }
    }
  }
};

/**
 * Logging configuration for contact storage operations
 * 
 * Logs all contact mutations with full argument capture and change tracking.
 */
const contactLoggingConfig: StorageLoggingConfig<ContactsStorage> = {
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
 * Logging configuration for address storage operations
 * 
 * Logs all postal address mutations with full argument capture and change tracking.
 * Associates logs with parent entity (trust provider or employer) when applicable.
 */
export const addressLoggingConfig: StorageLoggingConfig<AddressStorage> = {
  module: 'contacts.addresses',
  methods: {
    createPostalAddress: {
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
    updatePostalAddress: {
      enabled: true,
      getEntityId: (args) => args[0], // Address ID
      getHostEntityId: async (args, result, beforeState) => {
        const contactId = result?.contactId || beforeState?.contactId;
        return await getParentEntityForContact(contactId);
      },
      before: async (args, storage) => {
        return await storage.getPostalAddress(args[0]); // Current state
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
    deletePostalAddress: {
      enabled: true,
      getEntityId: (args) => args[0], // Address ID
      getHostEntityId: async (args, result, beforeState) => {
        const contactId = beforeState?.contactId;
        return await getParentEntityForContact(contactId);
      },
      before: async (args, storage) => {
        return await storage.getPostalAddress(args[0]); // Capture what's being deleted
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
        return await storage.getPostalAddress(args[0]); // Current state
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

/**
 * Logging configuration for employer storage operations
 * 
 * Logs all employer mutations with full argument capture and change tracking.
 */
const employerLoggingConfig: StorageLoggingConfig<EmployerStorage> = {
  module: 'employers',
  methods: {
    createEmployer: {
      enabled: true,
      getEntityId: (args, result) => result?.id || args[0]?.name || 'new employer',
      getHostEntityId: (args, result) => result?.id, // Employer ID is the host
      after: async (args, result, storage) => {
        return result; // Capture created employer
      }
    },
    updateEmployer: {
      enabled: true,
      getEntityId: (args) => args[0], // Employer ID
      getHostEntityId: (args) => args[0], // Employer ID is the host
      before: async (args, storage) => {
        return await storage.getEmployer(args[0]); // Current state
      },
      after: async (args, result, storage) => {
        return result; // New state (diff auto-calculated)
      }
    },
    deleteEmployer: {
      enabled: true,
      getEntityId: (args) => args[0], // Employer ID
      getHostEntityId: (args, result, beforeState) => beforeState?.id || args[0], // Employer ID is the host
      before: async (args, storage) => {
        return await storage.getEmployer(args[0]); // Capture what's being deleted
      }
    }
  }
};

/**
 * Logging configuration for worker ID storage operations
 * 
 * Logs all worker ID mutations with full argument capture and change tracking.
 */
const workerIdLoggingConfig: StorageLoggingConfig<WorkerIdStorage> = {
  module: 'workerIds',
  methods: {
    createWorkerId: {
      enabled: true,
      getEntityId: (args) => args[0]?.workerId || 'new worker ID',
      getHostEntityId: (args, result) => result?.workerId || args[0]?.workerId, // Worker ID is the host
      after: async (args, result, storage) => {
        return result; // Capture created worker ID
      },
      getDescription: async (args, result, beforeState, afterState, storage) => {
        const workerId = result;
        
        // Get the type name directly from the database
        const typeId = workerId?.typeId;
        let typeName = 'Unknown type';
        if (typeId) {
          const [type] = await db.select().from(optionsWorkerIdType).where(eq(optionsWorkerIdType.id, typeId));
          typeName = type?.name || 'Unknown type';
        }
        
        // Get the value
        const value = workerId?.value || 'unknown';
        
        return `Created ${typeName} with value "${value}"`;
      }
    },
    updateWorkerId: {
      enabled: true,
      getEntityId: (args) => args[0], // Worker ID record ID
      getHostEntityId: (args, result, beforeState) => result?.workerId || beforeState?.workerId, // Worker ID is the host
      before: async (args, storage) => {
        return await storage.getWorkerId(args[0]); // Current state
      },
      after: async (args, result, storage) => {
        return result; // New state (diff auto-calculated)
      },
      getDescription: async (args, result, beforeState, afterState, storage) => {
        const updates = args[1];
        const workerId = result;
        
        // Get the type name directly from the database
        const typeId = workerId?.typeId;
        let typeName = 'Unknown type';
        if (typeId) {
          const [type] = await db.select().from(optionsWorkerIdType).where(eq(optionsWorkerIdType.id, typeId));
          typeName = type?.name || 'Unknown type';
        }
        
        // Get the new value
        const newValue = updates?.value || workerId?.value || 'unknown';
        
        return `Updated ${typeName} to "${newValue}"`;
      }
    },
    deleteWorkerId: {
      enabled: true,
      getEntityId: (args) => args[0], // Worker ID record ID
      getHostEntityId: (args, result, beforeState) => beforeState?.workerId, // Worker ID is the host
      before: async (args, storage) => {
        return await storage.getWorkerId(args[0]); // Capture what's being deleted
      },
      getDescription: async (args, result, beforeState, afterState, storage) => {
        const workerId = beforeState;
        
        // Get the type name directly from the database
        const typeId = workerId?.typeId;
        let typeName = 'Unknown type';
        if (typeId) {
          const [type] = await db.select().from(optionsWorkerIdType).where(eq(optionsWorkerIdType.id, typeId));
          typeName = type?.name || 'Unknown type';
        }
        
        // Get the value
        const value = workerId?.value || 'unknown';
        
        return `Deleted ${typeName} with value "${value}"`;
      }
    }
  }
};

/**
 * Logging configuration for ledger account storage operations
 * 
 * Logs all ledger account mutations with full argument capture and change tracking.
 */
const ledgerAccountLoggingConfig: StorageLoggingConfig<import('./ledger').LedgerAccountStorage> = {
  module: 'ledger.accounts',
  methods: {
    create: {
      enabled: true,
      getEntityId: (args, result) => result?.id || args[0]?.name || 'new account',
      after: async (args, result, storage) => {
        return result; // Capture created account
      }
    },
    update: {
      enabled: true,
      getEntityId: (args) => args[0], // Account ID
      before: async (args, storage) => {
        return await storage.get(args[0]); // Current state
      },
      after: async (args, result, storage) => {
        return result; // New state (diff auto-calculated)
      }
    },
    delete: {
      enabled: true,
      getEntityId: (args) => args[0], // Account ID
      before: async (args, storage) => {
        return await storage.get(args[0]); // Capture what's being deleted
      }
    }
  }
};

/**
 * Logging configuration for Stripe payment method storage operations
 * 
 * Logs all Stripe payment method mutations with full argument capture and change tracking.
 */
const stripePaymentMethodLoggingConfig: StorageLoggingConfig<import('./ledger').StripePaymentMethodStorage> = {
  module: 'ledger.stripePaymentMethods',
  methods: {
    create: {
      enabled: true,
      getEntityId: (args, result) => result?.id || 'new payment method',
      after: async (args, result, storage) => {
        return result; // Capture created payment method
      }
    },
    update: {
      enabled: true,
      getEntityId: (args) => args[0], // Payment method ID
      before: async (args, storage) => {
        return await storage.get(args[0]); // Current state
      },
      after: async (args, result, storage) => {
        return result; // New state (diff auto-calculated)
      }
    },
    delete: {
      enabled: true,
      getEntityId: (args) => args[0], // Payment method ID
      before: async (args, storage) => {
        return await storage.get(args[0]); // Capture what's being deleted
      }
    },
    setAsDefault: {
      enabled: true,
      getEntityId: (args) => args[0], // Payment method ID
      before: async (args, storage) => {
        return await storage.get(args[0]); // Current state
      },
      after: async (args, result, storage) => {
        return result; // New state (diff auto-calculated)
      }
    }
  }
};

/**
 * Logging configuration for user storage operations
 * 
 * Logs all user, role, and permission management operations with full argument capture and change tracking.
 */
const userLoggingConfig: StorageLoggingConfig<UserStorage> = {
  module: 'users',
  methods: {
    createUser: {
      enabled: true,
      getEntityId: (args) => args[0]?.email || 'new user',
      getHostEntityId: (args, result) => result?.id, // User ID is the host
      after: async (args, result, storage) => {
        return result; // Capture created user
      }
    },
    updateUser: {
      enabled: true,
      getEntityId: (args) => args[0], // User ID
      getHostEntityId: (args) => args[0], // User ID is the host
      before: async (args, storage) => {
        return await storage.getUser(args[0]); // Current state
      },
      after: async (args, result, storage) => {
        return result; // New state (diff auto-calculated)
      },
      getDescription: async (args, result, beforeState, afterState) => {
        const user = afterState || beforeState;
        if (!user) return `Updated user ${args[0]}`;
        const userName = user.firstName && user.lastName
          ? `${user.firstName} ${user.lastName}`
          : user.email;
        
        // Calculate what changed
        const changes: string[] = [];
        if (beforeState && afterState) {
          const allKeys = Array.from(new Set([...Object.keys(beforeState), ...Object.keys(afterState)]));
          for (const key of allKeys) {
            if (JSON.stringify(beforeState[key]) !== JSON.stringify(afterState[key])) {
              changes.push(key);
            }
          }
        }
        
        if (changes.length === 0) {
          return `Updated user "${userName}" (no changes detected)`;
        }
        
        return `Updated user "${userName}" (changed: ${changes.join(', ')})`;
      }
    },
    deleteUser: {
      enabled: true,
      getEntityId: (args) => args[0], // User ID
      getHostEntityId: (args, result, beforeState) => beforeState?.id || args[0], // User ID is the host
      before: async (args, storage) => {
        return await storage.getUser(args[0]); // Capture what's being deleted
      },
      getDescription: async (args, result, beforeState) => {
        const user = beforeState;
        if (!user) return `Deleted user ${args[0]}`;
        const userName = user.firstName && user.lastName
          ? `${user.firstName} ${user.lastName}`
          : user.email;
        return `Deleted user "${userName}"`;
      }
    },
    linkReplitAccount: {
      enabled: true,
      getEntityId: (args) => args[0], // User ID
      getHostEntityId: (args) => args[0], // User ID is the host
      before: async (args, storage) => {
        return await storage.getUser(args[0]); // Current state
      },
      after: async (args, result, storage) => {
        return result; // New state (diff auto-calculated)
      },
      getDescription: async (args, result, beforeState, afterState) => {
        const user = afterState || beforeState;
        if (!user) return `Linked Replit account for user ${args[0]}`;
        const userName = user.firstName && user.lastName
          ? `${user.firstName} ${user.lastName}`
          : user.email;
        return `Linked Replit account for "${userName}"`;
      }
    },
    createRole: {
      enabled: true,
      getEntityId: (args) => args[0]?.name || 'new role',
      after: async (args, result, storage) => {
        return result; // Capture created role
      }
    },
    updateRole: {
      enabled: true,
      getEntityId: (args) => args[0], // Role ID
      before: async (args, storage) => {
        return await storage.getRole(args[0]); // Current state
      },
      after: async (args, result, storage) => {
        return result; // New state (diff auto-calculated)
      }
    },
    deleteRole: {
      enabled: true,
      getEntityId: (args) => args[0], // Role ID
      before: async (args, storage) => {
        return await storage.getRole(args[0]); // Capture what's being deleted
      }
    },
    updateRoleSequence: {
      enabled: true,
      getEntityId: (args) => args[0], // Role ID
      before: async (args, storage) => {
        return await storage.getRole(args[0]); // Current state
      },
      after: async (args, result, storage) => {
        return result; // New state (diff auto-calculated)
      }
    },
    assignRoleToUser: {
      enabled: true,
      getEntityId: (args) => args[0]?.userId || 'user',
      getHostEntityId: (args, result) => result?.userId || args[0]?.userId, // User ID is the host
      after: async (args, result, storage) => {
        return result; // Capture role assignment
      },
      getDescription: async (args, result, beforeState, afterState, storage) => {
        const assignment = args[0];
        const user = await storage.getUser(assignment.userId);
        const role = await storage.getRole(assignment.roleId);
        const userName = user ? `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email : 'Unknown user';
        const roleName = role?.name || 'Unknown role';
        return `Assigned "${roleName}" to ${userName}`;
      }
    },
    unassignRoleFromUser: {
      enabled: true,
      getEntityId: (args) => args[0], // User ID
      getHostEntityId: (args) => args[0], // User ID is the host
      before: async (args, storage) => {
        // Capture the roles before removal
        const roles = await storage.getUserRoles(args[0]);
        return { userId: args[0], roleId: args[1], roles };
      },
      getDescription: async (args, result, beforeState, afterState, storage) => {
        const userId = args[0];
        const roleId = args[1];
        const user = await storage.getUser(userId);
        const role = await storage.getRole(roleId);
        const userName = user ? `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email : 'Unknown user';
        const roleName = role?.name || 'Unknown role';
        return `Unassigned "${roleName}" from ${userName}`;
      }
    },
    assignPermissionToRole: {
      enabled: true,
      getEntityId: (args) => args[0]?.roleId || 'role',
      after: async (args, result, storage) => {
        return result; // Capture permission assignment
      }
    },
    unassignPermissionFromRole: {
      enabled: true,
      getEntityId: (args) => args[0], // Role ID
      before: async (args, storage) => {
        // Capture the permissions before removal
        const permissions = await storage.getRolePermissions(args[0]);
        return { roleId: args[0], permissionKey: args[1], permissions };
      }
    }
  }
};

/**
 * Logging configuration for employer contact type storage operations
 * 
 * Logs all create/update/delete operations on employer contact types with full argument capture and change tracking.
 */
const employerContactTypeLoggingConfig: StorageLoggingConfig<EmployerContactTypeStorage> = {
  module: 'options.employerContactTypes',
  methods: {
    create: {
      enabled: true,
      getEntityId: (args) => args[0]?.name || 'new employer contact type',
      after: async (args, result, storage) => {
        return result; // Capture created contact type
      }
    },
    update: {
      enabled: true,
      getEntityId: (args) => args[0], // Contact type ID
      before: async (args, storage) => {
        return await storage.get(args[0]); // Current state
      },
      after: async (args, result, storage) => {
        return result; // New state (diff auto-calculated)
      }
    },
    delete: {
      enabled: true,
      getEntityId: (args) => args[0], // Contact type ID
      before: async (args, storage) => {
        return await storage.get(args[0]); // Capture what's being deleted
      }
    }
  }
};

/**
 * Logging configuration for trust benefits storage operations
 * 
 * Logs all create/update/delete operations on trust benefits with full
 * argument capture and change tracking.
 */
const trustBenefitLoggingConfig: StorageLoggingConfig<TrustBenefitStorage> = {
  module: 'trustBenefits',
  methods: {
    createTrustBenefit: {
      enabled: true,
      getEntityId: (args) => args[0]?.name || 'new trust benefit',
      after: async (args, result, storage) => {
        return result; // Capture created trust benefit
      }
    },
    updateTrustBenefit: {
      enabled: true,
      getEntityId: (args) => args[0], // Trust benefit ID
      before: async (args, storage) => {
        return await storage.getTrustBenefit(args[0]); // Current state
      },
      after: async (args, result, storage) => {
        return result; // New state (diff auto-calculated)
      }
    },
    deleteTrustBenefit: {
      enabled: true,
      getEntityId: (args) => args[0], // Trust benefit ID
      before: async (args, storage) => {
        return await storage.getTrustBenefit(args[0]); // Capture what's being deleted
      }
    }
  }
};

const wizardLoggingConfig: StorageLoggingConfig<WizardStorage> = {
  module: 'wizards',
  methods: {
    create: {
      enabled: true,
      getEntityId: (args) => args[0]?.type || 'new wizard',
      getHostEntityId: (args, result) => {
        return result?.entityId || null;
      },
      getDescription: async (args, result) => {
        const wizard = result;
        const wizardType = wizardRegistry.get(wizard?.type);
        const displayName = wizardType?.displayName || wizard?.type || 'Unknown wizard';
        const date = wizard?.date ? new Date(wizard.date).toISOString() : 'unknown date';
        return `${displayName}, ${date}`;
      },
      after: async (args, result, storage) => {
        return result;
      }
    },
    update: {
      enabled: true,
      getEntityId: (args) => args[0],
      getHostEntityId: (args, result, beforeState) => {
        return result?.entityId ?? beforeState?.entityId ?? null;
      },
      getDescription: async (args, result, beforeState) => {
        const wizard = result ?? beforeState;
        const wizardType = wizardRegistry.get(wizard?.type);
        const displayName = wizardType?.displayName || wizard?.type || 'Unknown wizard';
        const date = wizard?.date ? new Date(wizard.date).toISOString() : 'unknown date';
        return `${displayName}, ${date}`;
      },
      before: async (args, storage) => {
        return await storage.getById(args[0]);
      },
      after: async (args, result, storage) => {
        return result;
      }
    },
    delete: {
      enabled: true,
      getEntityId: (args) => args[0],
      getHostEntityId: (args, result, beforeState) => {
        return beforeState?.entityId ?? null;
      },
      getDescription: async (args, result, beforeState) => {
        const wizard = beforeState;
        const wizardType = wizardRegistry.get(wizard?.type);
        const displayName = wizardType?.displayName || wizard?.type || 'Unknown wizard';
        const date = wizard?.date ? new Date(wizard.date).toISOString() : 'unknown date';
        return `${displayName}, ${date}`;
      },
      before: async (args, storage) => {
        return await storage.getById(args[0]);
      }
    }
  }
};

export class DatabaseStorage implements IStorage {
  variables: VariableStorage;
  users: UserStorage;
  workers: WorkerStorage;
  employers: EmployerStorage;
  contacts: ContactsStorage;
  options: OptionsStorage;
  trustBenefits: TrustBenefitStorage;
  trustProviders: TrustProviderStorage;
  trustProviderContacts: TrustProviderContactStorage;
  workerIds: WorkerIdStorage;
  bookmarks: BookmarkStorage;
  ledger: LedgerStorage;
  employerContacts: EmployerContactStorage;
  wizards: WizardStorage;
  wizardFeedMappings: WizardFeedMappingStorage;
  wizardEmployerMonthly: WizardEmployerMonthlyStorage;
  files: FileStorage;
  cronJobs: CronJobStorage;
  cronJobRuns: CronJobRunStorage;
  chargePluginConfigs: ChargePluginConfigStorage;

  constructor() {
    this.variables = withStorageLogging(createVariableStorage(), variableLoggingConfig);
    this.users = withStorageLogging(createUserStorage(), userLoggingConfig);
    this.contacts = withStorageLogging(
      createContactsStorage(addressLoggingConfig, phoneNumberLoggingConfig), 
      contactLoggingConfig
    );
    this.workers = withStorageLogging(
      createWorkerStorage(this.contacts),
      workerLoggingConfig
    );
    this.employers = withStorageLogging(createEmployerStorage(), employerLoggingConfig);
    
    // Create options storage with logged employer contact types
    const optionsStorage = createOptionsStorage();
    optionsStorage.employerContactTypes = withStorageLogging(
      createEmployerContactTypeStorage(),
      employerContactTypeLoggingConfig
    );
    this.options = optionsStorage;
    
    this.trustBenefits = withStorageLogging(
      createTrustBenefitStorage(),
      trustBenefitLoggingConfig
    );
    this.trustProviders = createTrustProviderStorage();
    this.trustProviderContacts = withStorageLogging(createTrustProviderContactStorage(this.contacts), trustProviderContactLoggingConfig);
    this.workerIds = withStorageLogging(createWorkerIdStorage(), workerIdLoggingConfig);
    this.bookmarks = createBookmarkStorage();
    this.ledger = createLedgerStorage(ledgerAccountLoggingConfig, stripePaymentMethodLoggingConfig);
    this.employerContacts = withStorageLogging(createEmployerContactStorage(this.contacts), employerContactLoggingConfig);
    this.wizards = withStorageLogging(createWizardStorage(), wizardLoggingConfig);
    this.wizardFeedMappings = createWizardFeedMappingStorage();
    this.wizardEmployerMonthly = createWizardEmployerMonthlyStorage();
    this.files = withStorageLogging(createFileStorage(), fileLoggingConfig);
    this.cronJobs = createCronJobStorage();
    this.cronJobRuns = createCronJobRunStorage();
    this.chargePluginConfigs = createChargePluginConfigStorage();
  }
}

export const storage = new DatabaseStorage();
