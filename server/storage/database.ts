import { type VariableStorage, createVariableStorage } from "./variables";
import { type UserStorage, createUserStorage } from "./users";
import { type WorkerStorage, createWorkerStorage } from "./workers";
import { type EmployerStorage, createEmployerStorage } from "./employers";
import { type ContactsStorage, createContactsStorage, type AddressStorage, type PhoneNumberStorage } from "./contacts";
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

/**
 * Logging configuration for address storage operations
 * 
 * Logs all postal address mutations with full argument capture and change tracking.
 */
export const addressLoggingConfig: StorageLoggingConfig<AddressStorage> = {
  module: 'contacts.addresses',
  methods: {
    createPostalAddress: {
      enabled: true,
      getEntityId: (args) => args[0]?.contactId || 'new address',
      after: async (args, result, storage) => {
        return result; // Capture created address
      }
    },
    updatePostalAddress: {
      enabled: true,
      getEntityId: (args) => args[0], // Address ID
      before: async (args, storage) => {
        return await storage.getPostalAddress(args[0]); // Current state
      },
      after: async (args, result, storage) => {
        return result; // New state (diff auto-calculated)
      }
    },
    deletePostalAddress: {
      enabled: true,
      getEntityId: (args) => args[0], // Address ID
      before: async (args, storage) => {
        return await storage.getPostalAddress(args[0]); // Capture what's being deleted
      }
    },
    setAddressAsPrimary: {
      enabled: true,
      getEntityId: (args) => args[0], // Address ID
      before: async (args, storage) => {
        return await storage.getPostalAddress(args[0]); // Current state
      },
      after: async (args, result, storage) => {
        return result; // New state (diff auto-calculated)
      }
    }
  }
};

/**
 * Logging configuration for phone number storage operations
 * 
 * Logs all phone number mutations with full argument capture and change tracking.
 */
export const phoneNumberLoggingConfig: StorageLoggingConfig<PhoneNumberStorage> = {
  module: 'contacts.phoneNumbers',
  methods: {
    createPhoneNumber: {
      enabled: true,
      getEntityId: (args) => args[0]?.contactId || 'new phone',
      after: async (args, result, storage) => {
        return result; // Capture created phone number
      }
    },
    updatePhoneNumber: {
      enabled: true,
      getEntityId: (args) => args[0], // Phone number ID
      before: async (args, storage) => {
        return await storage.getPhoneNumber(args[0]); // Current state
      },
      after: async (args, result, storage) => {
        return result; // New state (diff auto-calculated)
      }
    },
    deletePhoneNumber: {
      enabled: true,
      getEntityId: (args) => args[0], // Phone number ID
      before: async (args, storage) => {
        return await storage.getPhoneNumber(args[0]); // Capture what's being deleted
      }
    },
    setPhoneNumberAsPrimary: {
      enabled: true,
      getEntityId: (args) => args[0], // Phone number ID
      before: async (args, storage) => {
        return await storage.getPhoneNumber(args[0]); // Current state
      },
      after: async (args, result, storage) => {
        return result; // New state (diff auto-calculated)
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
      after: async (args, result, storage) => {
        return result; // Capture created employer
      }
    },
    updateEmployer: {
      enabled: true,
      getEntityId: (args) => args[0], // Employer ID
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
      before: async (args, storage) => {
        return await storage.getEmployer(args[0]); // Capture what's being deleted
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
      after: async (args, result, storage) => {
        return result; // Capture created user
      }
    },
    updateUser: {
      enabled: true,
      getEntityId: (args) => args[0], // User ID
      before: async (args, storage) => {
        return await storage.getUser(args[0]); // Current state
      },
      after: async (args, result, storage) => {
        return result; // New state (diff auto-calculated)
      }
    },
    deleteUser: {
      enabled: true,
      getEntityId: (args) => args[0], // User ID
      before: async (args, storage) => {
        return await storage.getUser(args[0]); // Capture what's being deleted
      }
    },
    linkReplitAccount: {
      enabled: true,
      getEntityId: (args) => args[0], // User ID
      before: async (args, storage) => {
        return await storage.getUser(args[0]); // Current state
      },
      after: async (args, result, storage) => {
        return result; // New state (diff auto-calculated)
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
      after: async (args, result, storage) => {
        return result; // Capture role assignment
      }
    },
    unassignRoleFromUser: {
      enabled: true,
      getEntityId: (args) => args[0], // User ID
      before: async (args, storage) => {
        // Capture the roles before removal
        const roles = await storage.getUserRoles(args[0]);
        return { userId: args[0], roleId: args[1], roles };
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
    this.users = withStorageLogging(createUserStorage(), userLoggingConfig);
    this.contacts = withStorageLogging(
      createContactsStorage(addressLoggingConfig, phoneNumberLoggingConfig), 
      contactLoggingConfig
    );
    this.workers = createWorkerStorage(this.contacts);
    this.employers = withStorageLogging(createEmployerStorage(), employerLoggingConfig);
    this.options = createOptionsStorage();
    this.trustBenefits = createTrustBenefitStorage();
    this.workerIds = createWorkerIdStorage();
    this.bookmarks = createBookmarkStorage();
    this.ledger = createLedgerStorage(ledgerAccountLoggingConfig, stripePaymentMethodLoggingConfig);
  }
}

export const storage = new DatabaseStorage();
