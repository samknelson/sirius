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
    createVariable: {
      enabled: true,
      getEntityId: (args) => args[0]?.name, // Variable name
      after: async (args, result, storage) => {
        return result; // Capture created variable
      }
    },
    updateVariable: {
      enabled: true,
      getEntityId: (args) => args[0], // Variable ID
      before: async (args, storage) => {
        return await storage.getVariable(args[0]); // Current state
      },
      after: async (args, result, storage) => {
        return result; // New state (diff auto-calculated)
      }
    },
    deleteVariable: {
      enabled: true,
      getEntityId: (args) => args[0], // Variable ID
      before: async (args, storage) => {
        return await storage.getVariable(args[0]); // Capture what's being deleted
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
    this.workers = createWorkerStorage();
    this.employers = createEmployerStorage();
    this.contacts = createContactsStorage();
    this.options = createOptionsStorage();
    this.trustBenefits = createTrustBenefitStorage();
    this.workerIds = createWorkerIdStorage();
    this.bookmarks = createBookmarkStorage();
    this.ledger = createLedgerStorage();
  }
}

export const storage = new DatabaseStorage();
