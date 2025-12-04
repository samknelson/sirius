import { type VariableStorage, createVariableStorage, variableLoggingConfig } from "./variables";
import { type UserStorage, createUserStorage, userLoggingConfig } from "./users";
import { type WorkerStorage, createWorkerStorage, workerLoggingConfig } from "./workers";
import { type EmployerStorage, createEmployerStorage, employerLoggingConfig } from "./employers";
import { type ContactsStorage, createContactsStorage, type AddressStorage, type PhoneNumberStorage, contactLoggingConfig, addressLoggingConfig, phoneNumberLoggingConfig } from "./contacts";
import { type OptionsStorage, createOptionsStorage, createEmployerContactTypeStorage, type EmployerContactTypeStorage, employerContactTypeLoggingConfig } from "./options";
import { type TrustBenefitStorage, createTrustBenefitStorage, trustBenefitLoggingConfig } from "./trust-benefits";
import { type TrustProviderStorage, createTrustProviderStorage } from "./trust-providers";
import { type TrustProviderContactStorage, createTrustProviderContactStorage, trustProviderContactLoggingConfig } from "./trust-provider-contacts";
import { type WorkerIdStorage, createWorkerIdStorage, workerIdLoggingConfig } from "./worker-ids";
import { type BookmarkStorage, createBookmarkStorage } from "./bookmarks";
import { type LedgerStorage, createLedgerStorage, ledgerAccountLoggingConfig, stripePaymentMethodLoggingConfig } from "./ledger";
import { type EmployerContactStorage, createEmployerContactStorage, employerContactLoggingConfig } from "./employer-contacts";
import { type WizardStorage, createWizardStorage, wizardLoggingConfig } from "./wizards";
import { type WizardFeedMappingStorage, createWizardFeedMappingStorage } from "./wizard_feed_mappings";
import { type WizardEmployerMonthlyStorage, createWizardEmployerMonthlyStorage } from "./wizard_employer_monthly";
import { type FileStorage, createFileStorage, fileLoggingConfig } from "./files";
import { type CronJobStorage, createCronJobStorage, type CronJobRunStorage, createCronJobRunStorage } from "./cron_jobs";
import { type ChargePluginConfigStorage, createChargePluginConfigStorage } from "./charge-plugins";
import { type LogsStorage, createLogsStorage } from "./logs";
import { withStorageLogging, type StorageLoggingConfig } from "./middleware/logging";
import { db } from "../db";
import { optionsEmploymentStatus, employers, workers, contacts } from "@shared/schema";
import { eq } from "drizzle-orm";

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
  logs: LogsStorage;
}

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
  logs: LogsStorage;

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
    this.logs = createLogsStorage();
  }
}

export const storage = new DatabaseStorage();
