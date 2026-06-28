import { runInTransaction } from "./transaction-context";
import { type VariableStorage, createVariableStorage, variableLoggingConfig } from "./system/variables";
import { type UserStorage, createUserStorage, userLoggingConfig } from "./users";
import { type WorkerStorage, createWorkerStorage, workerLoggingConfig } from "./workers";
import { type EmployerStorage, createEmployerStorage, employerLoggingConfig } from "./employers/employers";
import { type ContactsStorage, createContactsStorage, type AddressStorage, type PhoneNumberStorage, contactLoggingConfig, addressLoggingConfig, phoneNumberLoggingConfig } from "./contacts";
import { type TrustBenefitStorage, createTrustBenefitStorage, trustBenefitLoggingConfig } from "./trust/benefits";
import { type TrustProviderStorage, createTrustProviderStorage } from "./trust/providers";
import { type TrustWmbStorage, createTrustWmbStorage, trustWmbLoggingConfig } from "./trust/wmb";
import { type TrustProviderContactStorage, createTrustProviderContactStorage, trustProviderContactLoggingConfig } from "./trust/provider/contacts";
import { type WorkerIdStorage, createWorkerIdStorage, workerIdLoggingConfig } from "./workers/ids";
import { type BookmarkStorage, createBookmarkStorage } from "./bookmarks";
import {
  type LedgerStorage,
  createLedgerStorage,
  ledgerAccountLoggingConfig,
  ledgerPaymentLoggingConfig,
  ledgerPaymentBatchLoggingConfig,
} from "./ledger";
import {
  type PaymentMethodStorage,
  createPaymentMethodStorage,
  paymentMethodLoggingConfig,
} from "./ledger/payment_methods";
import {
  createGatewayCustomerStorage,
  gatewayCustomerLoggingConfig,
} from "./ledger/gateway_customers";

type LedgerStorageWithPaymentMethods = LedgerStorage & {
  paymentMethods: PaymentMethodStorage;
  gatewayCustomers: ReturnType<typeof createGatewayCustomerStorage>;
};
import {
  type EmployerContactStorage,
  createEmployerContactStorage,
  employerContactLoggingConfig,
} from "./employers/contacts";
import {
  type WizardStorage,
  createWizardStorage,
  wizardLoggingConfig,
} from "./wizards";
import {
  type WizardFeedMappingStorage,
  createWizardFeedMappingStorage,
} from "./wizard_feed_mappings";
import {
  type WizardEmployerMonthlyStorage,
  createWizardEmployerMonthlyStorage,
} from "./wizard_employer_monthly";
import {
  type WizardEmploymentStatusMappingStorage,
  createWizardEmploymentStatusMappingStorage,
} from "./wizard-employment-status-mappings";
import {
  type FileStorage,
  createFileStorage,
  fileLoggingConfig,
} from "./files";
import {
  type CronJobRunStorage,
  createCronJobRunStorage,
} from "./system/cron";
import {
  type PluginConfigStorage,
  createPluginConfigStorage,
} from "./plugin-configs";
import {
  type DenormStorage,
  createDenormStorage,
} from "./system/denorm";
import {
  type WorkerMshDenormStorage,
  createWorkerMshDenormStorage,
} from "./system/worker-msh-denorm";
import {
  type WorkerEmploymentDenormStorage,
  createWorkerEmploymentDenormStorage,
} from "./system/worker-employment-denorm";
import {
  type WorkerWshDenormStorage,
  createWorkerWshDenormStorage,
} from "./system/worker-wsh-denorm";
import { type LogsStorage, createLogsStorage } from "./system/logs";
import { type WorkerWshStorage, createWorkerWshStorage, workerWshLoggingConfig } from "./worker-wsh";
import { type WorkerMshStorage, createWorkerMshStorage, workerMshLoggingConfig } from "./worker-msh";
import { type WorkerHoursStorage, createWorkerHoursStorage, workerHoursLoggingConfig } from "./worker-hours";
import { type PolicyStorage, createPolicyStorage, policyLoggingConfig } from "./policies";
import { type BargainingUnitStorage, createBargainingUnitStorage, bargainingUnitLoggingConfig } from "./bargaining-units";
import { type SftpClientDestinationStorage, createSftpClientDestinationStorage, sftpClientDestinationLoggingConfig } from "./sftp-client-destinations";
import { type TrustProviderEdiStorage, createTrustProviderEdiStorage, trustProviderEdiLoggingConfig } from "./trust/provider/edi";
import { type BulkMessageStorage, createBulkMessageStorage, bulkMessageLoggingConfig } from "./bulk/messages";
import { type BulkMessagesEmailStorage, createBulkMessagesEmailStorage, bulkMessagesEmailLoggingConfig } from "./bulk/messages/email";
import { type BulkMessagesSmsStorage, createBulkMessagesSmsStorage, bulkMessagesSmsLoggingConfig } from "./bulk/messages/sms";
import { type BulkMessagesPostalStorage, createBulkMessagesPostalStorage, bulkMessagesPostalLoggingConfig } from "./bulk/messages/postal";
import { type BulkMessagesInappStorage, createBulkMessagesInappStorage, bulkMessagesInappLoggingConfig } from "./bulk/messages/inapp";
import { type BulkParticipantStorage, createBulkParticipantStorage, bulkParticipantLoggingConfig } from "./bulk/participants";
import { type BulkTokensStorage, createBulkTokensStorage } from "./bulk/tokens";
import { type EmployerPolicyHistoryStorage, createEmployerPolicyHistoryStorage, employerPolicyHistoryLoggingConfig } from "./employers/policy-history";
import { type WmbScanQueueStorage, createWmbScanQueueStorage } from "./wmb-scan-queue";
import { type CardcheckDefinitionStorage, createCardcheckDefinitionStorage, cardcheckDefinitionLoggingConfig } from "./cardcheck-definitions";
import { type CardcheckStorage, createCardcheckStorage, cardcheckLoggingConfig, setCardcheckStorageDeps } from "./cardchecks";
import { type EsigStorage, createEsigStorage, esigLoggingConfig } from "./esigs";
import { type SessionStorage, createSessionStorage, sessionLoggingConfig } from "./system/sessions";
import { type FloodStorage, createFloodStorage } from "./system/flood";
import { type EventStorage, createEventStorage, eventLoggingConfig, type EventOccurrenceStorage, createEventOccurrenceStorage, eventOccurrenceLoggingConfig, type EventParticipantStorage, createEventParticipantStorage, eventParticipantLoggingConfig } from "./events";
import { type DispatchJobStorage, createDispatchJobStorage, dispatchJobLoggingConfig } from "./dispatch/jobs";
import { type DispatchJobGroupStorage, createDispatchJobGroupStorage, dispatchJobGroupLoggingConfig } from "./dispatch/job-groups";
import { type FacilityStorage, createFacilityStorage, facilityLoggingConfig } from "./facility/facilities";
import { type GbhetPensionStorage, createGbhetPensionStorage } from "./sitespecific/gbhet/pension";
import { type DispatchStorage, createDispatchStorage, dispatchLoggingConfig } from "./dispatch/dispatches";
import { type WorkerStewardAssignmentStorage, createWorkerStewardAssignmentStorage, workerStewardAssignmentLoggingConfig } from "./worker-steward-assignments";
import { type BtuCsgStorage, createBtuCsgStorage, btuCsgLoggingConfig } from "./sitespecific/btu/csg";
import { type BtuEmployerMapStorage, createBtuEmployerMapStorage, btuEmployerMapLoggingConfig } from "./sitespecific/btu/employer-map";
import { type BtuTerritoriesStorage, createBtuTerritoriesStorage } from "./sitespecific/btu/territories";
import { type FreemanCrewleadsStorage, createFreemanCrewleadsStorage, freemanCrewleadsLoggingConfig } from "./sitespecific/freeman/crewleads";
import { type BtuSchoolTypesStorage, createBtuSchoolTypesStorage } from "./sitespecific/btu/school-types";
import { type BtuRegionsStorage, createBtuRegionsStorage } from "./sitespecific/btu/regions";
import { type BtuSchoolAttributesStorage, createBtuSchoolAttributesStorage } from "./sitespecific/btu/school-attributes";
import { type BaoImmediateEligibilityStorage, createBaoImmediateEligibilityStorage, baoImmediateEligibilityLoggingConfig } from "./sitespecific/bao/immediate-eligibility";
import { type BaoBeneficiariesStorage, createBaoBeneficiariesStorage, baoBeneficiariesLoggingConfig } from "./sitespecific/bao/beneficiaries";
import { type WorkerBanStorage, createWorkerBanStorage, workerBanLoggingConfig } from "./worker-bans";
import { type WorkerDispatchDncStorage, createWorkerDispatchDncStorage, workerDispatchDncLoggingConfig } from "./dispatch/worker-dnc";
import { type WorkerSkillStorage, createWorkerSkillStorage, workerSkillLoggingConfig } from "./workers/skills";
import { type WorkerTosStorage, createWorkerTosStorage, workerTosLoggingConfig } from "./workers/tos";
import { type WorkerCertificationStorage, createWorkerCertificationStorage, workerCertificationLoggingConfig } from "./workers/certifications";
import { type WorkerRatingStorage, createWorkerRatingStorage, workerRatingLoggingConfig } from "./workers/ratings";
import { type WorkerRelationsStorage, createWorkerRelationsStorage, workerRelationsLoggingConfig } from "./workers/relations";
import { type WorkerTrustElectionsStorage, createWorkerTrustElectionsStorage, workerTrustElectionsLoggingConfig } from "./trust/elections";
import { type TrustBenefitEligibilityExemptionsStorage, createTrustBenefitEligibilityExemptionsStorage, trustBenefitEligibilityExemptionsLoggingConfig } from "./trust/eligibility-exemptions";
import { type EdlsSheetsStorage, createEdlsSheetsStorage, edlsSheetsLoggingConfig } from "./edls/sheets";
import { type EdlsCrewsStorage, createEdlsCrewsStorage, edlsCrewsLoggingConfig } from "./edls/crews";
import { type EdlsAssignmentsStorage, createEdlsAssignmentsStorage, edlsAssignmentsLoggingConfig } from "./edls/assignments";
import { type WorkerEdlsStorage, createWorkerEdlsStorage, workerEdlsLoggingConfig } from "./edls/workers";
import { type AuthIdentitiesStorage, createAuthIdentitiesStorage } from "./auth-identities";
import { type WorkerDispatchEligDenormStorage, createWorkerDispatchEligDenormStorage } from "./dispatch/worker-elig-denorm";
import { type RawSqlStorage, createRawSqlStorage } from "./raw-sql";
import { type ReadOnlyStorage, createReadOnlyStorage } from "./read-only";
import { type BtuPoliticalStorage, createBtuPoliticalStorage, btuPoliticalLoggingConfig } from "./sitespecific/btu/political";
import { type WsBundleStorage, type WsClientStorage, type WsClientCredentialStorage, type WsClientIpRuleStorage, createWsBundleStorage, createWsClientStorage, createWsClientCredentialStorage, createWsClientIpRuleStorage } from "./webservices";
import { type CompanyStorage, createCompanyStorage, companyLoggingConfig, type EmployerCompanyStorage, createEmployerCompanyStorage, employerCompanyLoggingConfig } from "./employers/companies";
import { type ContactLinkStorage, createContactLinkStorage } from "./contact-links";
import { type CommTagsStorage, createCommTagsStorage, commTagsLoggingConfig } from "./comm-tags";
import { type CommStorage, createCommStorage, commLoggingConfig } from "./comm";
import { type GrievanceStorage, createGrievanceStorage, grievanceLoggingConfig } from "./grievances/grievances";
import {
  type GrievanceTimelineTemplateStorage,
  createGrievanceTimelineTemplateStorage,
  grievanceTimelineTemplateLoggingConfig,
} from "./grievances/grievance-timeline-templates";
import { withStorageLogging, type StorageLoggingConfig } from "./middleware/logging";
import { db } from "./db";
import { employers, workers, contacts } from "@shared/schema";
import { eq } from "drizzle-orm";

export interface IStorage {
  variables: VariableStorage;
  users: UserStorage;
  workers: WorkerStorage;
  employers: EmployerStorage;
  contacts: ContactsStorage;
  trustBenefits: TrustBenefitStorage;
  trustProviders: TrustProviderStorage;
  trustProviderContacts: TrustProviderContactStorage;
  trust: { wmb: TrustWmbStorage };
  workerIds: WorkerIdStorage;
  bookmarks: BookmarkStorage;
  ledger: LedgerStorageWithPaymentMethods;
  employerContacts: EmployerContactStorage;
  wizards: WizardStorage;
  wizardFeedMappings: WizardFeedMappingStorage;
  wizardEmployerMonthly: WizardEmployerMonthlyStorage;
  wizardEmploymentStatusMappings: WizardEmploymentStatusMappingStorage;
  files: FileStorage;
  cronJobRuns: CronJobRunStorage;
  pluginConfigs: PluginConfigStorage;
  denorm: DenormStorage;
  workerMshDenorm: WorkerMshDenormStorage;
  workerWshDenorm: WorkerWshDenormStorage;
  workerEmploymentDenorm: WorkerEmploymentDenormStorage;
  logs: LogsStorage;
  workerWsh: WorkerWshStorage;
  workerMsh: WorkerMshStorage;
  workerHours: WorkerHoursStorage;
  policies: PolicyStorage;
  bargainingUnits: BargainingUnitStorage;
  employerPolicyHistory: EmployerPolicyHistoryStorage;
  wmbScanQueue: WmbScanQueueStorage;
  cardcheckDefinitions: CardcheckDefinitionStorage;
  cardchecks: CardcheckStorage;
  esigs: EsigStorage;
  sessions: SessionStorage;
  flood: FloodStorage;
  events: EventStorage;
  eventOccurrences: EventOccurrenceStorage;
  eventParticipants: EventParticipantStorage;
  dispatchJobs: DispatchJobStorage;
  dispatchJobGroups: DispatchJobGroupStorage;
  dispatches: DispatchStorage;
  workerStewardAssignments: WorkerStewardAssignmentStorage;
  btuCsg: BtuCsgStorage;
  btuEmployerMap: BtuEmployerMapStorage;
  btuTerritories: BtuTerritoriesStorage;
  btuSchoolTypes: BtuSchoolTypesStorage;
  btuRegions: BtuRegionsStorage;
  btuSchoolAttributes: BtuSchoolAttributesStorage;
  baoImmediateEligibility: BaoImmediateEligibilityStorage;
  baoBeneficiaries: BaoBeneficiariesStorage;
  freemanCrewleads: FreemanCrewleadsStorage;
  workerBans: WorkerBanStorage;
  workerDispatchDnc: WorkerDispatchDncStorage;
  workerSkills: WorkerSkillStorage;
  workerTos: WorkerTosStorage;
  workerCertifications: WorkerCertificationStorage;
  workerRatings: WorkerRatingStorage;
  workerRelations: WorkerRelationsStorage;
  workerTrustElections: WorkerTrustElectionsStorage;
  trustBenefitEligibilityExemptions: TrustBenefitEligibilityExemptionsStorage;
  edlsSheets: EdlsSheetsStorage;
  edlsCrews: EdlsCrewsStorage;
  edlsAssignments: EdlsAssignmentsStorage;
  workerEdls: WorkerEdlsStorage;
  authIdentities: AuthIdentitiesStorage;
  workerDispatchEligDenorm: WorkerDispatchEligDenormStorage;
  rawSql: RawSqlStorage;
  readOnly: ReadOnlyStorage;
  wsBundles: WsBundleStorage;
  wsClients: WsClientStorage;
  wsClientCredentials: WsClientCredentialStorage;
  wsClientIpRules: WsClientIpRuleStorage;
  btuPolitical: BtuPoliticalStorage;
  companies: CompanyStorage;
  employerCompanies: EmployerCompanyStorage;
  sftpClientDestinations: SftpClientDestinationStorage;
  trustProviderEdi: TrustProviderEdiStorage;
  bulkMessages: BulkMessageStorage;
  bulkMessagesEmail: BulkMessagesEmailStorage;
  bulkMessagesSms: BulkMessagesSmsStorage;
  bulkMessagesPostal: BulkMessagesPostalStorage;
  bulkMessagesInapp: BulkMessagesInappStorage;
  bulkParticipants: BulkParticipantStorage;
  bulkTokens: BulkTokensStorage;
  facilities: FacilityStorage;
  gbhetPension: GbhetPensionStorage;
  contactLinks: ContactLinkStorage;
  commTags: CommTagsStorage;
  comm: CommStorage;
  grievances: GrievanceStorage;
  grievanceTimelineTemplates: GrievanceTimelineTemplateStorage;
}

export class DatabaseStorage implements IStorage {
  variables: VariableStorage;
  users: UserStorage;
  workers: WorkerStorage;
  employers: EmployerStorage;
  contacts: ContactsStorage;
  trustBenefits: TrustBenefitStorage;
  trustProviders: TrustProviderStorage;
  trustProviderContacts: TrustProviderContactStorage;
  trust: { wmb: TrustWmbStorage };
  workerIds: WorkerIdStorage;
  bookmarks: BookmarkStorage;
  ledger: LedgerStorageWithPaymentMethods;
  employerContacts: EmployerContactStorage;
  wizards: WizardStorage;
  wizardFeedMappings: WizardFeedMappingStorage;
  wizardEmployerMonthly: WizardEmployerMonthlyStorage;
  wizardEmploymentStatusMappings: WizardEmploymentStatusMappingStorage;
  files: FileStorage;
  cronJobRuns: CronJobRunStorage;
  pluginConfigs: PluginConfigStorage;
  denorm: DenormStorage;
  workerMshDenorm: WorkerMshDenormStorage;
  workerWshDenorm: WorkerWshDenormStorage;
  workerEmploymentDenorm: WorkerEmploymentDenormStorage;
  logs: LogsStorage;
  workerWsh: WorkerWshStorage;
  workerMsh: WorkerMshStorage;
  workerHours: WorkerHoursStorage;
  policies: PolicyStorage;
  bargainingUnits: BargainingUnitStorage;
  employerPolicyHistory: EmployerPolicyHistoryStorage;
  wmbScanQueue: WmbScanQueueStorage;
  cardcheckDefinitions: CardcheckDefinitionStorage;
  cardchecks: CardcheckStorage;
  esigs: EsigStorage;
  sessions: SessionStorage;
  flood: FloodStorage;
  events: EventStorage;
  eventOccurrences: EventOccurrenceStorage;
  eventParticipants: EventParticipantStorage;
  dispatchJobs: DispatchJobStorage;
  dispatchJobGroups: DispatchJobGroupStorage;
  dispatches: DispatchStorage;
  workerStewardAssignments: WorkerStewardAssignmentStorage;
  btuCsg: BtuCsgStorage;
  btuEmployerMap: BtuEmployerMapStorage;
  btuTerritories: BtuTerritoriesStorage;
  btuSchoolTypes: BtuSchoolTypesStorage;
  btuRegions: BtuRegionsStorage;
  btuSchoolAttributes: BtuSchoolAttributesStorage;
  baoImmediateEligibility: BaoImmediateEligibilityStorage;
  baoBeneficiaries: BaoBeneficiariesStorage;
  freemanCrewleads: FreemanCrewleadsStorage;
  workerBans: WorkerBanStorage;
  workerDispatchDnc: WorkerDispatchDncStorage;
  workerSkills: WorkerSkillStorage;
  workerTos: WorkerTosStorage;
  workerCertifications: WorkerCertificationStorage;
  workerRatings: WorkerRatingStorage;
  workerRelations: WorkerRelationsStorage;
  workerTrustElections: WorkerTrustElectionsStorage;
  trustBenefitEligibilityExemptions: TrustBenefitEligibilityExemptionsStorage;
  edlsSheets: EdlsSheetsStorage;
  edlsCrews: EdlsCrewsStorage;
  edlsAssignments: EdlsAssignmentsStorage;
  workerEdls: WorkerEdlsStorage;
  authIdentities: AuthIdentitiesStorage;
  workerDispatchEligDenorm: WorkerDispatchEligDenormStorage;
  rawSql: RawSqlStorage;
  readOnly: ReadOnlyStorage;
  wsBundles: WsBundleStorage;
  wsClients: WsClientStorage;
  wsClientCredentials: WsClientCredentialStorage;
  wsClientIpRules: WsClientIpRuleStorage;
  btuPolitical: BtuPoliticalStorage;
  companies: CompanyStorage;
  employerCompanies: EmployerCompanyStorage;
  sftpClientDestinations: SftpClientDestinationStorage;
  trustProviderEdi: TrustProviderEdiStorage;
  bulkMessages: BulkMessageStorage;
  bulkMessagesEmail: BulkMessagesEmailStorage;
  bulkMessagesSms: BulkMessagesSmsStorage;
  bulkMessagesPostal: BulkMessagesPostalStorage;
  bulkMessagesInapp: BulkMessagesInappStorage;
  bulkParticipants: BulkParticipantStorage;
  bulkTokens: BulkTokensStorage;
  facilities: FacilityStorage;
  gbhetPension: GbhetPensionStorage;
  contactLinks: ContactLinkStorage;
  commTags: CommTagsStorage;
  comm: CommStorage;
  grievances: GrievanceStorage;
  grievanceTimelineTemplates: GrievanceTimelineTemplateStorage;

  constructor() {
    this.variables = withStorageLogging(
      createVariableStorage(),
      variableLoggingConfig,
    );
    // Create contacts storage with logging for sub-storages
    const contactsBase = createContactsStorage(addressLoggingConfig, phoneNumberLoggingConfig);
    // Apply logging to contact methods and preserve sub-storages
    const contactsWithLogging = withStorageLogging(contactsBase, contactLoggingConfig);
    this.contacts = {
      ...contactsWithLogging,
      addresses: contactsBase.addresses,
      phoneNumbers: contactsBase.phoneNumbers,
    };
    this.users = withStorageLogging(createUserStorage(this.contacts), userLoggingConfig);
    this.workers = withStorageLogging(
      createWorkerStorage(this.contacts),
      workerLoggingConfig,
    );
    this.employers = withStorageLogging(createEmployerStorage(), employerLoggingConfig);
    
    this.trustBenefits = withStorageLogging(
      createTrustBenefitStorage(),
      trustBenefitLoggingConfig,
    );
    this.trustProviders = createTrustProviderStorage();
    this.trust = {
      wmb: withStorageLogging(createTrustWmbStorage(), trustWmbLoggingConfig),
    };
    this.trustProviderContacts = withStorageLogging(
      createTrustProviderContactStorage(this.contacts),
      trustProviderContactLoggingConfig,
    );
    this.workerIds = withStorageLogging(
      createWorkerIdStorage(),
      workerIdLoggingConfig,
    );
    this.bookmarks = createBookmarkStorage();
    this.ledger = {
      ...createLedgerStorage(
        ledgerAccountLoggingConfig,
        undefined,
        ledgerPaymentLoggingConfig,
        undefined,
        ledgerPaymentBatchLoggingConfig,
      ),
      paymentMethods: withStorageLogging(
        createPaymentMethodStorage(),
        paymentMethodLoggingConfig,
      ),
      gatewayCustomers: withStorageLogging(
        createGatewayCustomerStorage(),
        gatewayCustomerLoggingConfig,
      ),
    };
    this.employerContacts = withStorageLogging(
      createEmployerContactStorage(this.contacts),
      employerContactLoggingConfig,
    );
    this.wizards = withStorageLogging(
      createWizardStorage(),
      wizardLoggingConfig,
    );
    this.wizardFeedMappings = createWizardFeedMappingStorage();
    this.wizardEmployerMonthly = createWizardEmployerMonthlyStorage();
    this.wizardEmploymentStatusMappings = createWizardEmploymentStatusMappingStorage();
    this.files = withStorageLogging(createFileStorage(), fileLoggingConfig);
    this.cronJobRuns = createCronJobRunStorage();
    this.pluginConfigs = createPluginConfigStorage();
    // No logging for denorm - high-volume internal workflow state churn.
    this.denorm = createDenormStorage();
    this.workerMshDenorm = createWorkerMshDenormStorage();
    this.workerWshDenorm = createWorkerWshDenormStorage();
    this.workerEmploymentDenorm = createWorkerEmploymentDenormStorage();
    this.logs = createLogsStorage();

    // No logging for wmb scan queue - high-volume internal state changes
    // Actual benefit changes are logged via the benefits-scan service
    this.wmbScanQueue = createWmbScanQueueStorage();

    this.workerWsh = withStorageLogging(
      createWorkerWshStorage(
        async (workerId: string) => {
          await this.wmbScanQueue.invalidateWorkerScans(workerId);
        },
      ),
      workerWshLoggingConfig,
    );
    this.workerMsh = withStorageLogging(
      createWorkerMshStorage(
        async (workerId: string) => {
          await this.wmbScanQueue.invalidateWorkerScans(workerId);
        }
      ),
      workerMshLoggingConfig
    );
    this.workerHours = withStorageLogging(
      createWorkerHoursStorage(
        async (workerId: string) => {
          await this.wmbScanQueue.invalidateWorkerScans(workerId);
        },
      ),
      workerHoursLoggingConfig,
    );

    this.policies = withStorageLogging(
      createPolicyStorage(),
      policyLoggingConfig,
    );
    this.bargainingUnits = withStorageLogging(
      createBargainingUnitStorage(),
      bargainingUnitLoggingConfig,
    );
    this.employerPolicyHistory = withStorageLogging(
      createEmployerPolicyHistoryStorage(
        this.employers.updateEmployerPolicy.bind(this.employers),
      ),
      employerPolicyHistoryLoggingConfig,
    );
    this.cardcheckDefinitions = withStorageLogging(
      createCardcheckDefinitionStorage(),
      cardcheckDefinitionLoggingConfig,
    );
    this.cardchecks = withStorageLogging(
      createCardcheckStorage(),
      cardcheckLoggingConfig,
    );
    this.esigs = withStorageLogging(
      createEsigStorage(),
      esigLoggingConfig,
    );
    setCardcheckStorageDeps({
      getFileById: this.files.getById.bind(this.files),
      updateFile: this.files.update.bind(this.files),
      createEsig: this.esigs.createEsig.bind(this.esigs),
    });
    this.sessions = withStorageLogging(
      createSessionStorage(),
      sessionLoggingConfig,
    );
    this.flood = createFloodStorage();
    this.events = withStorageLogging(createEventStorage(), eventLoggingConfig);
    this.eventOccurrences = withStorageLogging(createEventOccurrenceStorage(), eventOccurrenceLoggingConfig);
    this.eventParticipants = withStorageLogging(createEventParticipantStorage(), eventParticipantLoggingConfig);
    this.dispatchJobs = withStorageLogging(createDispatchJobStorage(), dispatchJobLoggingConfig);
    this.dispatchJobGroups = withStorageLogging(createDispatchJobGroupStorage(), dispatchJobGroupLoggingConfig);
    this.dispatches = withStorageLogging(createDispatchStorage(), dispatchLoggingConfig);
    this.workerStewardAssignments = withStorageLogging(createWorkerStewardAssignmentStorage(), workerStewardAssignmentLoggingConfig);
    this.btuCsg = withStorageLogging(createBtuCsgStorage(), btuCsgLoggingConfig);
    this.btuEmployerMap = withStorageLogging(createBtuEmployerMapStorage(), btuEmployerMapLoggingConfig);
    this.btuTerritories = createBtuTerritoriesStorage();
    this.btuSchoolTypes = createBtuSchoolTypesStorage();
    this.btuRegions = createBtuRegionsStorage();
    this.btuSchoolAttributes = createBtuSchoolAttributesStorage();
    this.baoImmediateEligibility = withStorageLogging(
      createBaoImmediateEligibilityStorage(),
      baoImmediateEligibilityLoggingConfig,
    );
    this.baoBeneficiaries = withStorageLogging(
      createBaoBeneficiariesStorage(this.workers),
      baoBeneficiariesLoggingConfig,
    );
    this.freemanCrewleads = withStorageLogging(
      createFreemanCrewleadsStorage(),
      freemanCrewleadsLoggingConfig,
    );
    this.workerBans = withStorageLogging(createWorkerBanStorage(), workerBanLoggingConfig);
    this.workerDispatchDnc = withStorageLogging(createWorkerDispatchDncStorage(), workerDispatchDncLoggingConfig);
    this.workerSkills = withStorageLogging(createWorkerSkillStorage(), workerSkillLoggingConfig);
    this.workerTos = withStorageLogging(createWorkerTosStorage(), workerTosLoggingConfig);
    this.workerCertifications = withStorageLogging(
      createWorkerCertificationStorage({ workerSkills: this.workerSkills }), 
      workerCertificationLoggingConfig
    );
    this.workerRatings = withStorageLogging(createWorkerRatingStorage(), workerRatingLoggingConfig);
    this.workerRelations = withStorageLogging(createWorkerRelationsStorage(), workerRelationsLoggingConfig);
    this.workerTrustElections = withStorageLogging(createWorkerTrustElectionsStorage(), workerTrustElectionsLoggingConfig);
    this.trustBenefitEligibilityExemptions = withStorageLogging(createTrustBenefitEligibilityExemptionsStorage(), trustBenefitEligibilityExemptionsLoggingConfig);
    this.edlsSheets = withStorageLogging(createEdlsSheetsStorage(), edlsSheetsLoggingConfig);
    this.edlsCrews = withStorageLogging(createEdlsCrewsStorage(), edlsCrewsLoggingConfig);
    this.edlsAssignments = withStorageLogging(createEdlsAssignmentsStorage(), edlsAssignmentsLoggingConfig);
    this.workerEdls = withStorageLogging(createWorkerEdlsStorage(), workerEdlsLoggingConfig);
    this.authIdentities = createAuthIdentitiesStorage();
    this.workerDispatchEligDenorm = createWorkerDispatchEligDenormStorage();
    this.rawSql = createRawSqlStorage();
    this.readOnly = createReadOnlyStorage();
    this.wsBundles = createWsBundleStorage();
    this.wsClients = createWsClientStorage();
    this.wsClientCredentials = createWsClientCredentialStorage();
    this.wsClientIpRules = createWsClientIpRuleStorage();
    this.btuPolitical = withStorageLogging(createBtuPoliticalStorage(), btuPoliticalLoggingConfig);
    this.companies = withStorageLogging(createCompanyStorage(), companyLoggingConfig);
    this.employerCompanies = withStorageLogging(createEmployerCompanyStorage(), employerCompanyLoggingConfig);
    this.sftpClientDestinations = withStorageLogging(
      createSftpClientDestinationStorage(),
      sftpClientDestinationLoggingConfig
    );
    this.trustProviderEdi = withStorageLogging(
      createTrustProviderEdiStorage(),
      trustProviderEdiLoggingConfig
    );
    this.bulkMessages = withStorageLogging(
      createBulkMessageStorage(),
      bulkMessageLoggingConfig
    );
    this.bulkMessagesEmail = withStorageLogging(
      createBulkMessagesEmailStorage(),
      bulkMessagesEmailLoggingConfig
    );
    this.bulkMessagesSms = withStorageLogging(
      createBulkMessagesSmsStorage(),
      bulkMessagesSmsLoggingConfig
    );
    this.bulkMessagesPostal = withStorageLogging(
      createBulkMessagesPostalStorage(),
      bulkMessagesPostalLoggingConfig
    );
    this.bulkMessagesInapp = withStorageLogging(
      createBulkMessagesInappStorage(),
      bulkMessagesInappLoggingConfig
    );
    this.bulkParticipants = withStorageLogging(
      createBulkParticipantStorage(),
      bulkParticipantLoggingConfig
    );
    this.bulkTokens = createBulkTokensStorage();
    this.facilities = withStorageLogging(createFacilityStorage(this.contacts), facilityLoggingConfig);
    this.gbhetPension = createGbhetPensionStorage();
    this.contactLinks = createContactLinkStorage();
    this.commTags = withStorageLogging(
      createCommTagsStorage({
        resolveCommLabel: (id) => this.comm.getLogLabel(id),
      }),
      commTagsLoggingConfig,
    );
    const rawComm = createCommStorage(this.commTags);
    const baseComm = withStorageLogging(rawComm, commLoggingConfig);
    const commTags = this.commTags;
    this.comm = withStorageLogging(
      {
        ...baseComm,
        async updateWithTags(id, data, tagIds) {
          return runInTransaction(async () => {
            // Use the unwrapped rawComm here so the inner updateComm
            // does NOT emit its own log line — the orchestrator-level
            // log below is the single high-level summary for this
            // edit. Calling baseComm.updateComm would double-log.
            let updated;
            if (data && Object.keys(data).length > 0) {
              updated = await rawComm.updateComm(id, data);
            } else {
              updated = await rawComm.getComm(id);
            }
            if (!updated) return undefined;
            if (tagIds !== undefined) {
              await commTags.setTags(id, tagIds);
            }
            return updated;
          });
        },
      },
      {
        module: 'comm',
        methods: {
          updateWithTags: {
            enabled: true,
            getEntityId: (args) => args[0],
            before: async (args, storage) => {
              const id = args[0];
              const data = (args[1] ?? {}) as Record<string, unknown>;
              const tagIds = args[2];
              const c = data.status !== undefined ? await storage.getComm(id) : undefined;
              const tags = tagIds !== undefined ? await commTags.listForComm(id) : [];
              return { status: c?.status, tags };
            },
            after: async (args, result, storage) => {
              const id = args[0];
              const data = (args[1] ?? {}) as Record<string, unknown>;
              const tagIds = args[2];
              const status =
                data.status !== undefined
                  ? (result?.status ?? (await storage.getComm(id))?.status)
                  : undefined;
              const tags = tagIds !== undefined ? await commTags.listForComm(id) : [];
              return { status, tags };
            },
            getDescription: async (args, _result, beforeState, afterState, storage) => {
              const id = args[0];
              const label = (await storage.getLogLabel(id)) ?? `comm ${id.slice(0, 8)}`;
              const parts: string[] = [];
              const fromStatus = beforeState?.status;
              const toStatus = afterState?.status;
              if (fromStatus !== toStatus) {
                parts.push(`status ${fromStatus ?? '∅'} → ${toStatus ?? '∅'}`);
              }
              const beforeTags: Array<{ id: string; name: string }> = beforeState?.tags ?? [];
              const afterTags: Array<{ id: string; name: string }> = afterState?.tags ?? [];
              const beforeIds = new Set(beforeTags.map((t) => t.id));
              const afterIds = new Set(afterTags.map((t) => t.id));
              const added = afterTags.filter((t) => !beforeIds.has(t.id)).map((t) => t.name);
              const removed = beforeTags.filter((t) => !afterIds.has(t.id)).map((t) => t.name);
              for (const name of added) parts.push(`+${name}`);
              for (const name of removed) parts.push(`-${name}`);
              if (parts.length === 0) return `Updated ${label} (no changes)`;
              return `Updated ${label}: ${parts.join(', ')}`;
            },
          },
        },
      },
    );
    this.grievances = withStorageLogging(
      createGrievanceStorage(),
      grievanceLoggingConfig,
    );
    this.grievanceTimelineTemplates = withStorageLogging(
      createGrievanceTimelineTemplateStorage(),
      grievanceTimelineTemplateLoggingConfig,
    );
  }
}

export const storage = new DatabaseStorage();
