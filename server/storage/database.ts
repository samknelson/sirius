import { type VariableStorage, createVariableStorage } from "./variables";
import { type UserStorage, createUserStorage } from "./users";
import { type WorkerStorage, createWorkerStorage } from "./workers";
import { type EmployerStorage, createEmployerStorage } from "./employers";
import { type ContactsStorage, createContactsStorage } from "./contacts";
import { type OptionsStorage, createOptionsStorage } from "./options";
import { type TrustBenefitStorage, createTrustBenefitStorage } from "./trust-benefits";
import { type WorkerIdStorage, createWorkerIdStorage } from "./worker-ids";
import { type BookmarkStorage, createBookmarkStorage } from "./bookmarks";
import { type LedgerStorage, createLedgerStorage } from "./ledger";
import { withStorageLogging, type StorageLoggingConfig } from "./middleware/logging";

export interface IStorage {
  variables: VariableStorage;
  users: UserStorage;
  workers: WorkerStorage;
  employers: EmployerStorage;
  contacts: ContactsStorage;
  options: OptionsStorage;
  trustBenefits: TrustBenefitStorage;
  workerIds: WorkerIdStorage;
  bookmarks: BookmarkStorage;
  ledger: LedgerStorage;
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
      after: async (args, result, storage) => {
        return result; // Capture created contact
      }
    },
    updateName: {
      enabled: true,
      getEntityId: (args) => args[0], // Contact ID
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
      before: async (args, storage) => {
        return await storage.getContact(args[0]); // Capture what's being deleted
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
  workerIds: WorkerIdStorage;
  bookmarks: BookmarkStorage;
  ledger: LedgerStorage;

  constructor() {
    this.variables = withStorageLogging(createVariableStorage(), variableLoggingConfig);
    this.users = createUserStorage();
    this.contacts = withStorageLogging(createContactsStorage(), contactLoggingConfig);
    this.workers = createWorkerStorage(this.contacts);
    this.employers = createEmployerStorage();
    this.options = createOptionsStorage();
    this.trustBenefits = createTrustBenefitStorage();
    this.workerIds = createWorkerIdStorage();
    this.bookmarks = createBookmarkStorage();
    this.ledger = createLedgerStorage();
  }
}

export const storage = new DatabaseStorage();
