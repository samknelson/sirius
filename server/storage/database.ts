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
    this.variables = createVariableStorage();
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
