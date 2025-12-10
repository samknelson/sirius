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
import { type WorkerWshStorage, createWorkerWshStorage, workerWshLoggingConfig } from "./worker-wsh";
import { type WorkerHoursStorage, createWorkerHoursStorage, workerHoursLoggingConfig } from "./worker-hours";
import { type PolicyStorage, createPolicyStorage, policyLoggingConfig } from "./policies";
import { type EmployerPolicyHistoryStorage, createEmployerPolicyHistoryStorage, employerPolicyHistoryLoggingConfig } from "./employer-policy-history";
import { type WmbScanQueueStorage, createWmbScanQueueStorage } from "./wmb-scan-queue";
import { type CardcheckDefinitionStorage, createCardcheckDefinitionStorage, cardcheckDefinitionLoggingConfig } from "./cardcheck-definitions";
import { type CardcheckStorage, createCardcheckStorage, cardcheckLoggingConfig } from "./cardchecks";
import { type EsigStorage, createEsigStorage, esigLoggingConfig } from "./esigs";
import { type SessionStorage, createSessionStorage, sessionLoggingConfig } from "./sessions";
import { type FloodStorage, createFloodStorage } from "./flood";
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
  workerWsh: WorkerWshStorage;
  workerHours: WorkerHoursStorage;
  policies: PolicyStorage;
  employerPolicyHistory: EmployerPolicyHistoryStorage;
  wmbScanQueue: WmbScanQueueStorage;
  cardcheckDefinitions: CardcheckDefinitionStorage;
  cardchecks: CardcheckStorage;
  esigs: EsigStorage;
  sessions: SessionStorage;
  flood: FloodStorage;
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
  workerWsh: WorkerWshStorage;
  workerHours: WorkerHoursStorage;
  policies: PolicyStorage;
  employerPolicyHistory: EmployerPolicyHistoryStorage;
  wmbScanQueue: WmbScanQueueStorage;
  cardcheckDefinitions: CardcheckDefinitionStorage;
  cardchecks: CardcheckStorage;
  esigs: EsigStorage;
  sessions: SessionStorage;
  flood: FloodStorage;

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
    
    // No logging for wmb scan queue - high-volume internal state changes
    // Actual benefit changes are logged via the benefits-scan service
    this.wmbScanQueue = createWmbScanQueueStorage();
    
    this.workerWsh = withStorageLogging(
      createWorkerWshStorage(
        this.workers.updateWorkerStatus.bind(this.workers),
        async (workerId: string) => {
          await this.wmbScanQueue.invalidateWorkerScans(workerId);
        }
      ),
      workerWshLoggingConfig
    );
    this.workerHours = withStorageLogging(
      createWorkerHoursStorage(
        async (workerId: string) => {
          await this.wmbScanQueue.invalidateWorkerScans(workerId);
        }
      ),
      workerHoursLoggingConfig
    );
    this.policies = withStorageLogging(
      createPolicyStorage(),
      policyLoggingConfig
    );
    this.employerPolicyHistory = withStorageLogging(
      createEmployerPolicyHistoryStorage(this.employers.updateEmployerPolicy.bind(this.employers)),
      employerPolicyHistoryLoggingConfig
    );
    this.cardcheckDefinitions = withStorageLogging(
      createCardcheckDefinitionStorage(),
      cardcheckDefinitionLoggingConfig
    );
    this.cardchecks = withStorageLogging(
      createCardcheckStorage(),
      cardcheckLoggingConfig
    );
    this.esigs = withStorageLogging(
      createEsigStorage(),
      esigLoggingConfig
    );
    this.sessions = withStorageLogging(
      createSessionStorage(),
      sessionLoggingConfig
    );
    this.flood = createFloodStorage();
  }
}

export const storage = new DatabaseStorage();
