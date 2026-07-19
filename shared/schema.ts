import { sql, relations } from "drizzle-orm";
import { foreignKey, pgTable, pgEnum, text, varchar, boolean, timestamp, date, primaryKey, jsonb, doublePrecision, integer, unique, serial, index, uniqueIndex, numeric, check } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { isValidYmd, type Ymd } from "./utils/date";

export {
  optionsDispatchJobType,
  pluginConfigsDispatch,
  insertPluginConfigDispatchSchema,
  type InsertPluginConfigDispatch,
  type PluginConfigDispatch,
  dispatchJobs,
  dispatchJobStatusEnum,
  insertDispatchJobTypeSchema,
  insertDispatchJobSchema,
  dispatches,
  dispatchStatusEnum,
  insertDispatchSchema,
  workerDispatchStatus,
  workerDispatchStatusEnum,
  insertWorkerDispatchStatusSchema,
  workerDispatchEligDenorm,
  insertWorkerDispatchEligDenormSchema,
  type DispatchJobStatus,
  type InsertDispatchJobType,
  type DispatchJobType,
  type InsertDispatchJob,
  type DispatchJob,
  type DispatchStatus,
  type InsertDispatch,
  type Dispatch,
  type WorkerDispatchStatusOption,
  type InsertWorkerDispatchStatus,
  type WorkerDispatchStatus,
  type InsertWorkerDispatchEligDenorm,
  type WorkerDispatchEligDenorm,
} from "./schema/dispatch/schema";

export {
  workerDispatchDnc,
  dispatchWorkerDncTypeEnum,
  insertWorkerDispatchDncSchema,
  type DispatchWorkerDncType,
  type InsertWorkerDispatchDnc,
  type WorkerDispatchDnc,
} from "./schema/dispatch/dnc-schema";

export {
  workerDispatchHfe,
  insertWorkerDispatchHfeSchema,
  type InsertWorkerDispatchHfe,
  type WorkerDispatchHfe,
} from "./schema/dispatch/hfe-schema";

export {
  workerDispatchEba,
  insertWorkerDispatchEbaSchema,
  type InsertWorkerDispatchEba,
  type WorkerDispatchEba,
} from "./schema/dispatch/eba-schema";

export {
  dispatchJobGroups,
  insertDispatchJobGroupSchema,
  type InsertDispatchJobGroup,
  type DispatchJobGroup,
} from "./schema/dispatch/job-group-schema";

export {
  facilities,
  insertFacilitySchema,
  type InsertFacility,
  type Facility,
} from "./schema/facility/schema";

export {
  eligibilityPluginConfigSchema,
  jobTypeEligibilitySchema,
  type EligibilityPluginConfig,
  type JobTypeEligibility,
  type EligibilityPluginMetadata,
  type JobTypeData,
  type DispatchJobData,
  type NotificationMedia,
  type PollPhaseStatus,
  type PollPhaseResult,
  type PollResult,
} from "./schema/dispatch/eligibility-config";

export {
  wsBundles,
  wsBundleStatusEnum,
  insertWsBundleSchema,
  wsClients,
  wsClientStatusEnum,
  insertWsClientSchema,
  wsClientCredentials,
  insertWsClientCredentialSchema,
  wsClientIpRules,
  insertWsClientIpRuleSchema,
  type WsBundleStatus,
  type InsertWsBundle,
  type WsBundle,
  type WsClientStatus,
  type InsertWsClient,
  type WsClient,
  type InsertWsClientCredential,
  type WsClientCredential,
  type InsertWsClientIpRule,
  type WsClientIpRule,
} from "./schema/webservices/schema";

// Session storage table for Replit Auth
export const sessions = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)],
);

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: varchar("email").notNull().unique(),
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  profileImageUrl: varchar("profile_image_url"),
  accountStatus: varchar("account_status").default("pending").notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").default(sql`now()`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`now()`).notNull(),
  lastLogin: timestamp("last_login"),
  data: jsonb("data"),
});

export const authProviderTypeEnum = pgEnum("auth_provider_type", [
  "replit",
  "okta",
  "saml",
  "oauth",
  "local",
  "clerk",
]);

export const authIdentities = pgTable(
  "auth_identities",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: varchar("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    providerType: authProviderTypeEnum("provider_type").notNull(),
    externalId: varchar("external_id").notNull(),
    email: varchar("email"),
    displayName: varchar("display_name"),
    profileImageUrl: varchar("profile_image_url"),
    passwordHash: varchar("password_hash"),
    refreshToken: text("refresh_token"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at").default(sql`now()`).notNull(),
    updatedAt: timestamp("updated_at").default(sql`now()`).notNull(),
    lastUsedAt: timestamp("last_used_at"),
  },
  (table) => [
    index("idx_auth_identities_user").on(table.userId),
    uniqueIndex("idx_auth_identities_provider_external_unique").on(
      table.providerType,
      table.externalId
    ),
  ]
);

export const authIdentitiesRelations = relations(authIdentities, ({ one }) => ({
  user: one(users, {
    fields: [authIdentities.userId],
    references: [users.id],
  }),
}));

export type AuthIdentity = typeof authIdentities.$inferSelect;
export type InsertAuthIdentity = typeof authIdentities.$inferInsert;
export type AuthProviderType = (typeof authProviderTypeEnum.enumValues)[number];

export const roles = pgTable("roles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull().unique(),
  description: text("description"),
  sequence: integer("sequence").notNull().default(0),
  createdAt: timestamp("created_at").default(sql`now()`).notNull(),
});

export const userRoles = pgTable("user_roles", {
  userId: varchar("user_id").notNull(),
  roleId: varchar("role_id").notNull(),
  assignedAt: timestamp("assigned_at").default(sql`now()`).notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.userId, table.roleId] }),
}));

export const rolePermissions = pgTable("role_permissions", {
  roleId: varchar("role_id").notNull(),
  permissionKey: text("permission_key").notNull(), // Changed from permissionId to permissionKey
  assignedAt: timestamp("assigned_at").default(sql`now()`).notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.roleId, table.permissionKey] }),
}));

export const contacts = pgTable("contacts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  title: text("title"),
  given: text("given"),
  middle: text("middle"),
  family: text("family"),
  generational: text("generational"),
  credentials: text("credentials"),
  displayName: text("display_name").notNull(),
  email: text("email").unique(),
  birthDate: date("birth_date"),
  gender: varchar("gender").references(() => optionsGender.id, { onDelete: 'set null' }),
  genderNota: text("gender_nota"),
  genderCalc: text("gender_calc"),
});

export const workers = pgTable("workers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  siriusId: serial("sirius_id").notNull().unique(),
  contactId: varchar("contact_id").notNull().references(() => contacts.id, { onDelete: 'cascade' }),
  ssn: text("ssn").unique(),
  bargainingUnitId: varchar("bargaining_unit_id").references(() => bargainingUnits.id, { onDelete: 'set null' }),
  data: jsonb("data"),
});

export const workerBans = pgTable("worker_bans", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  workerId: varchar("worker_id").notNull().references(() => workers.id, { onDelete: 'cascade' }),
  type: varchar("type"),
  startDate: timestamp("start_date").notNull(),
  endDate: timestamp("end_date"),
  denormActive: boolean("denorm_active").default(true),
  message: text("message"),
  data: jsonb("data"),
});

export const employers = pgTable("employers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  siriusId: varchar("sirius_id").unique(),
  name: text("name").notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  typeId: varchar("type_id").references(() => optionsEmployerType.id, { onDelete: 'set null' }),
  industryId: varchar("industry_id").references(() => optionsIndustry.id, { onDelete: 'set null' }),
  denormPolicyId: varchar("denorm_policy_id").references(() => policies.id, { onDelete: 'set null' }),
});

export const policies = pgTable("policies", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  siriusId: varchar("sirius_id").notNull().unique(),
  name: text("name"),
  data: jsonb("data"),
});

export const bargainingUnits = pgTable("bargaining_units", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  siriusId: varchar("sirius_id").notNull().unique(),
  name: text("name").notNull(),
  data: jsonb("data"),
});

export const employerPolicyHistory = pgTable("employer_policy_history", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  date: date("date").notNull(),
  employerId: varchar("employer_id").notNull().references(() => employers.id, { onDelete: 'cascade' }),
  policyId: varchar("policy_id").notNull().references(() => policies.id, { onDelete: 'cascade' }),
  data: jsonb("data"),
  createdAt: timestamp("created_at").default(sql`now()`).notNull(),
});

export const employerContacts = pgTable("employer_contacts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  employerId: varchar("employer_id").notNull().references(() => employers.id, { onDelete: 'cascade' }),
  contactId: varchar("contact_id").notNull().references(() => contacts.id, { onDelete: 'cascade' }),
  contactTypeId: varchar("contact_type_id"),
}, (table) => [
  foreignKey({
    name: "employer_contacts_contact_type_id_options_employer_contact_type",
    columns: [table.contactTypeId],
    foreignColumns: [optionsEmployerContactType.id],
  }).onDelete("set null"),
]);

export const workerHours = pgTable("worker_hours", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  year: integer("year").notNull(),
  month: integer("month").notNull(),
  day: integer("day").notNull(),
  workerId: varchar("worker_id").notNull().references(() => workers.id, { onDelete: 'cascade' }),
  employerId: varchar("employer_id").notNull().references(() => employers.id, { onDelete: 'cascade' }),
  employmentStatusId: varchar("employment_status_id").notNull(),
  hours: doublePrecision("hours"),
  home: boolean("home").default(false).notNull(),
  jobTitle: text("job_title"),
}, (table) => ({
  // Declared in TABLE-column order with an explicit name (see trust_wmb's
  // constraint comment): drizzle-kit push introspects constraint columns in
  // table order, so any other declared order false-positives on db-push runs.
  uniqueWorkerEmployerYearMonthDay: unique("worker_hours_worker_id_employer_id_year_month_day_unique").on(table.year, table.month, table.day, table.workerId, table.employerId),
  fkEmploymentStatusId: foreignKey({
    name: "worker_hours_employment_status_id_options_employment_status_id_",
    columns: [table.employmentStatusId],
    foreignColumns: [optionsEmploymentStatus.id],
  }).onDelete("cascade"),
}));

export const trustProviders = pgTable("trust_providers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  data: jsonb("data"),
});

export const trustProviderContacts = pgTable("trust_provider_contacts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  providerId: varchar("provider_id").notNull().references(() => trustProviders.id, { onDelete: 'cascade' }),
  contactId: varchar("contact_id").notNull().references(() => contacts.id, { onDelete: 'cascade' }),
  contactTypeId: varchar("contact_type_id"),
}, (table) => [
  foreignKey({
    name: "trust_provider_contacts_contact_type_id_options_trust_provider_",
    columns: [table.contactTypeId],
    foreignColumns: [optionsTrustProviderType.id],
  }).onDelete("set null"),
]);

export const trustBenefits = pgTable("trust_benefits", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  siriusId: varchar("sirius_id").unique(),
  name: text("name").notNull(),
  benefitType: varchar("benefit_type").references(() => optionsTrustBenefitType.id, { onDelete: 'set null' }),
  isActive: boolean("is_active").default(true).notNull(),
  description: text("description"),
});

export const trustWmb = pgTable("trust_wmb", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  month: integer("month").notNull(),
  year: integer("year").notNull(),
  workerId: varchar("worker_id").notNull().references(() => workers.id, { onDelete: 'cascade' }),
  employerId: varchar("employer_id").notNull().references(() => employers.id, { onDelete: 'cascade' }),
  benefitId: varchar("benefit_id").notNull().references(() => trustBenefits.id, { onDelete: 'cascade' }),
}, (table) => ({
  // Declared in TABLE-column order (month, year, worker, employer, benefit)
  // with an explicit name, on purpose. drizzle-kit push's diff is
  // column-order-sensitive, but its introspection returns constraint columns
  // in table order (its information_schema query has no ORDER BY on the
  // constraint ordinal). Declaring the constraint in any other order makes
  // every `ALLOW_DB_PUSH=1 npx tsx scripts/db-push.ts` run false-positive an
  // "add constraint" + interactive truncate prompt. The live DB constraint
  // remains (worker_id, employer_id, benefit_id, month, year) — the startup
  // drift gate compares column SETS (order-insensitive), so both orders are
  // accepted and no migration is needed. Do not "fix" this order back.
  uniqueWorkerEmployerBenefitMonthYear: unique("trust_wmb_worker_id_employer_id_benefit_id_month_year_unique").on(table.month, table.year, table.workerId, table.employerId, table.benefitId),
}));

// WMB Scan Status - tracks scan status per month/year
export const trustWmbScanStatus = pgTable("trust_wmb_scan_status", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  month: integer("month").notNull(),
  year: integer("year").notNull(),
  status: varchar("status").notNull().default("queued"), // queued, running, completed, failed, stale
  totalQueued: integer("total_queued").notNull().default(0),
  processedSuccess: integer("processed_success").notNull().default(0),
  processedFailed: integer("processed_failed").notNull().default(0),
  benefitsStarted: integer("benefits_started").notNull().default(0),
  benefitsContinued: integer("benefits_continued").notNull().default(0),
  benefitsTerminated: integer("benefits_terminated").notNull().default(0),
  queuedAt: timestamp("queued_at").default(sql`now()`).notNull(),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  lastError: text("last_error"),
}, (table) => ({
  uniqueMonthYear: unique().on(table.month, table.year),
}));

// WMB Scan Queue - tracks individual worker scan jobs
export const trustWmbScanQueue = pgTable("trust_wmb_scan_queue", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  statusId: varchar("status_id").notNull().references(() => trustWmbScanStatus.id, { onDelete: 'cascade' }),
  workerId: varchar("worker_id").notNull().references(() => workers.id, { onDelete: 'cascade' }),
  month: integer("month").notNull(),
  year: integer("year").notNull(),
  status: varchar("status").notNull().default("pending"), // pending, processing, success, failed, invalidated, skipped
  triggerSource: varchar("trigger_source").notNull().default("monthly_batch"), // monthly_batch, manual, worker_update
  resultSummary: jsonb("result_summary"),
  scheduledFor: timestamp("scheduled_for"),
  pickedAt: timestamp("picked_at"),
  completedAt: timestamp("completed_at"),
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
}, (table) => ({
  // Declared in TABLE-column order with an explicit name (see trust_wmb's
  // constraint comment): drizzle-kit push introspects constraint columns in
  // table order, so any other declared order false-positives on db-push runs.
  uniqueWorkerYearMonth: unique("trust_wmb_scan_queue_worker_id_year_month_unique").on(table.workerId, table.month, table.year),
}));

export const variables = pgTable("variables", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull().unique(),
  value: jsonb("value").notNull(),
});

export const optionsGender = pgTable("options_gender", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  code: varchar("code").notNull().unique(),
  nota: boolean("nota").default(false).notNull(),
  sequence: integer("sequence").notNull().default(0),
  data: jsonb("data"),
});

export const optionsWorkerIdType = pgTable("options_worker_id_type", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  siriusId: varchar("sirius_id", { length: 255 }).unique(),
  sequence: integer("sequence").notNull().default(0),
  validator: text("validator"),
  data: jsonb("data"),
});

export const optionsTrustBenefitType = pgTable("options_trust_benefit_type", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  siriusId: varchar("sirius_id", { length: 255 }).unique(),
  sequence: integer("sequence").notNull().default(0),
  data: jsonb("data"),
});

export const optionsLedgerPaymentType = pgTable("options_ledger_payment_type", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  description: text("description"),
  currencyCode: varchar("currency_code", { length: 10 }).notNull().default("USD"),
  category: varchar("category", { length: 20 }).notNull().default("financial").$type<"financial" | "adjustment">(),
  sequence: integer("sequence").notNull().default(0),
  data: jsonb("data"),
});

export const optionsEmployerContactType = pgTable("options_employer_contact_type", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  description: text("description"),
  data: jsonb("data"),
});

export const optionsEmployerType = pgTable("options_employer_type", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  description: text("description"),
  sequence: integer("sequence").notNull().default(0),
  data: jsonb("data"),
});

export const optionsDepartment = pgTable("options_department", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  data: jsonb("data"),
});

export const optionsClassifications = pgTable("options_classifications", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  code: varchar("code", { length: 255 }).unique(),
  siriusId: varchar("sirius_id", { length: 255 }).unique(),
  sequence: integer("sequence").notNull().default(0),
  data: jsonb("data"),
});

export const optionsIndustry = pgTable("options_industries", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  code: varchar("code", { length: 255 }).unique(),
  siriusId: varchar("sirius_id", { length: 255 }).unique(),
  data: jsonb("data"),
});

export const optionsWorkerWs = pgTable("options_worker_ws", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  description: text("description"),
  sequence: integer("sequence").notNull().default(0),
  data: jsonb("data"),
});

export const optionsWorkerMs = pgTable("options_worker_ms", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  code: varchar("code", { length: 255 }).unique(),
  siriusId: varchar("sirius_id", { length: 255 }).unique(),
  description: text("description"),
  industryId: varchar("industry_id").notNull().references(() => optionsIndustry.id),
  sequence: integer("sequence").notNull().default(0),
  data: jsonb("data"),
});

export const optionsEmploymentStatus = pgTable("options_employment_status", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  code: varchar("code").notNull(),
  employed: boolean("employed").default(false).notNull(),
  description: text("description"),
  sequence: integer("sequence").notNull().default(0),
  data: jsonb("data"),
});

export const optionsTrustProviderType = pgTable("options_trust_provider_type", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  description: text("description"),
  data: jsonb("data"),
});

export const optionsCommTags = pgTable("options_comm_tags", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  siriusId: varchar("sirius_id", { length: 255 }).unique(),
  data: jsonb("data"),
});

export const optionsEventType = pgTable("options_event_type", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  siriusId: varchar("sirius_id").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  category: varchar("category").notNull().default("public"),
  config: jsonb("config"),
  data: jsonb("data"),
});

export const events = pgTable("events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  eventTypeId: varchar("event_type_id").notNull().references(() => optionsEventType.id, { onDelete: 'restrict' }),
  title: text("title").notNull(),
  description: text("description"),
  config: jsonb("config"),
  data: jsonb("data"),
  createdAt: timestamp("created_at").default(sql`now()`).notNull(),
});

export const eventOccurrences = pgTable("event_occurrences", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  eventId: varchar("event_id").notNull().references(() => events.id, { onDelete: 'cascade' }),
  startAt: timestamp("start_at").notNull(),
  endAt: timestamp("end_at"),
  status: varchar("status").notNull().default("active"),
  notes: text("notes"),
  data: jsonb("data"),
  createdAt: timestamp("created_at").default(sql`now()`).notNull(),
});

export const eventParticipants = pgTable("event_participants", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  eventId: varchar("event_id").notNull().references(() => events.id, { onDelete: 'cascade' }),
  contactId: varchar("contact_id").notNull().references(() => contacts.id, { onDelete: 'cascade' }),
  role: varchar("role").notNull(),
  status: varchar("status"),
  data: jsonb("data"),
  registeredAt: timestamp("registered_at").defaultNow(),
});

export const workerIds = pgTable("worker_ids", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  workerId: varchar("worker_id").notNull().references(() => workers.id, { onDelete: 'cascade' }),
  typeId: varchar("type_id").notNull().references(() => optionsWorkerIdType.id, { onDelete: 'cascade' }),
  value: text("value").notNull(),
}, (table) => ({
  uniqueTypeValue: unique().on(table.typeId, table.value),
}));

export const workerWsh = pgTable("worker_wsh", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  date: date("date").notNull(),
  workerId: varchar("worker_id").notNull().references(() => workers.id, { onDelete: 'cascade' }),
  wsId: varchar("ws_id").notNull().references(() => optionsWorkerWs.id, { onDelete: 'cascade' }),
  data: jsonb("data"),
  createdAt: timestamp("created_at").default(sql`now()`).notNull(),
});

export const workerMsh = pgTable("worker_msh", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  date: date("date").notNull(),
  workerId: varchar("worker_id").notNull().references(() => workers.id, { onDelete: 'cascade' }),
  msId: varchar("ms_id").notNull().references(() => optionsWorkerMs.id, { onDelete: 'cascade' }),
  industryId: varchar("industry_id").notNull().references(() => optionsIndustry.id, { onDelete: 'cascade' }),
  data: jsonb("data"),
  createdAt: timestamp("created_at").default(sql`now()`).notNull(),
}, (table) => ({
  // Declared in TABLE-column order with an explicit name (see trust_wmb's
  // constraint comment): drizzle-kit push introspects constraint columns in
  // table order, so any other declared order false-positives on db-push runs.
  uniqueWorkerIndustryDate: unique("worker_msh_worker_id_industry_id_date_unique").on(table.date, table.workerId, table.industryId),
}));

export const contactPostal = pgTable("contact_postal", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  contactId: varchar("contact_id").notNull().references(() => contacts.id, { onDelete: 'cascade' }),
  friendlyName: text("friendly_name"),
  street: text("street").notNull(),
  city: text("city").notNull(),
  state: text("state").notNull(),
  postalCode: text("postal_code").notNull(),
  country: text("country").notNull(),
  isPrimary: boolean("is_primary").default(false).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  source: text("source").$type<'worker_self' | 'employer_feed' | 'admin' | 'import' | 'system'>().default('admin').notNull(),
  deliverabilityStatus: text("deliverability_status").$type<'unknown' | 'verified' | 'undeliverable' | 'vacant' | 'returned_mail'>().default('unknown').notNull(),
  lastVerifiedAt: timestamp("last_verified_at"),
  updatedAt: timestamp("updated_at").default(sql`now()`).notNull(),
  needsReview: boolean("needs_review").default(false).notNull(),
  validationResponse: jsonb("validation_response"),
  latitude: doublePrecision("latitude"),
  longitude: doublePrecision("longitude"),
  accuracy: text("accuracy"),
  createdAt: timestamp("created_at").default(sql`now()`).notNull(),
}, (table) => ({
  chkSource: check(
    "chk_source",
    sql`${table.source} IN ('worker_self', 'employer_feed', 'admin', 'import', 'system')`
  ),
  chkDeliverabilityStatus: check(
    "chk_deliverability_status",
    sql`${table.deliverabilityStatus} IN ('unknown', 'verified', 'undeliverable', 'vacant', 'returned_mail')`
  ),
  idxContactId: index("idx_contact_postal_contact_id").on(table.contactId),
  idxContactPrimary: index("idx_contact_postal_contact_primary")
    .on(table.contactId, table.isPrimary)
    .where(sql`${table.isActive} = true`),
  idxNeedsReview: index("idx_contact_postal_needs_review")
    .on(table.needsReview)
    .where(sql`${table.needsReview} = true`),
}));

export const phoneNumbers = pgTable("contact_phone", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  contactId: varchar("contact_id").notNull().references(() => contacts.id, { onDelete: 'cascade' }),
  friendlyName: text("friendly_name"),
  phoneNumber: text("phone_number").notNull(),
  isPrimary: boolean("is_primary").default(false).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  validationResponse: jsonb("validation_response"),
  createdAt: timestamp("created_at").default(sql`now()`).notNull(),
});

export const bookmarks = pgTable("bookmarks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  entityType: text("entity_type").notNull(),
  entityId: varchar("entity_id").notNull(),
  createdAt: timestamp("created_at").default(sql`now()`).notNull(),
});

export const ledgerPaymentMethods = pgTable("ledger_paymentmethods", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  entityType: text("entity_type").notNull(),
  entityId: varchar("entity_id").notNull(),
  paymentMethod: text("payment_method").notNull(),
  // Required link to the payment-gateway plugin config this method belongs to.
  // FK targets the payment-gateway subsidiary (a type-safe FK target) rather
  // than the polymorphic plugin_configs id. NOT NULL — a payment method is
  // unusable without knowing its gateway. ON DELETE RESTRICT prevents deleting
  // a gateway config that still has payment methods attached.
  gatewayConfigId: varchar("gateway_config_id").notNull(),
  // Generic, gateway-agnostic opaque settings blob.
  data: jsonb("data").default(sql`'{}'::jsonb`),
  isActive: boolean("is_active").default(true).notNull(),
  isDefault: boolean("is_default").default(false).notNull(),
  createdAt: timestamp("created_at").default(sql`now()`).notNull(),
}, (table) => [
  foreignKey({
    name: "ledger_paymentmethods_gateway_config_id_plugin_configs_payment_",
    columns: [table.gatewayConfigId],
    foreignColumns: [pluginConfigsPaymentGateway.id],
  }).onDelete("restrict"),
]);

// Per-(entity, gateway config) provider customer mapping. Replaces the old
// single `employers.stripe_customer_id` column so an entity can have a distinct
// provider customer reference per gateway config (e.g. two Stripe accounts).
export const ledgerGatewayCustomers = pgTable("ledger_gateway_customers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  entityType: text("entity_type").notNull(),
  entityId: varchar("entity_id").notNull(),
  // FK targets the payment-gateway subsidiary (a type-safe FK target) rather
  // than the polymorphic plugin_configs base. ON DELETE RESTRICT mirrors the
  // payment-method link: a gateway config with customer mappings cannot be
  // deleted out from under them.
  gatewayConfigId: varchar("gateway_config_id").notNull(),
  // Opaque provider customer reference (e.g. Stripe `cus_...`).
  customerRef: text("customer_ref").notNull(),
  createdAt: timestamp("created_at").default(sql`now()`).notNull(),
}, (table) => ({
  entityGatewayUnique: unique("ledger_gateway_customers_entity_gateway_unique").on(
    table.entityType,
    table.entityId,
    table.gatewayConfigId,
  ),
  fkGatewayConfigId: foreignKey({
    name: "ledger_gateway_customers_gateway_config_id_plugin_configs_payme",
    columns: [table.gatewayConfigId],
    foreignColumns: [pluginConfigsPaymentGateway.id],
  }).onDelete("restrict"),
}));

export const insertLedgerGatewayCustomerSchema = createInsertSchema(ledgerGatewayCustomers).omit({
  id: true,
  createdAt: true,
});
export type InsertLedgerGatewayCustomer = z.infer<typeof insertLedgerGatewayCustomerSchema>;
export type LedgerGatewayCustomer = typeof ledgerGatewayCustomers.$inferSelect;

export const ledgerAccounts = pgTable("ledger_accounts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  description: text("description"),
  currencyCode: text("currency_code").default('USD').notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  data: jsonb("data"),
  // Optional link to the payment-gateway plugin config this account uses. The
  // FK targets the payment-gateway subsidiary (a type-safe FK target) rather
  // than the polymorphic plugin_configs base, and is ON DELETE SET NULL so
  // deleting the gateway config simply unlinks the account.
  gatewayConfigId: varchar("gateway_config_id"),
}, (table) => [
  foreignKey({
    name: "ledger_accounts_gateway_config_id_plugin_configs_payment_gatewa",
    columns: [table.gatewayConfigId],
    foreignColumns: [pluginConfigsPaymentGateway.id],
  }).onDelete("set null"),
]);

export const ledgerPayments = pgTable("ledger_payments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  status: text("status").notNull().$type<'draft' | 'canceled' | 'cleared' | 'error'>(),
  allocated: boolean("allocated").notNull().default(false),
  amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
  paymentType: varchar("payment_type").notNull().references(() => optionsLedgerPaymentType.id),
  ledgerEaId: varchar("ledger_ea_id").notNull().references(() => ledgerEa.id),
  details: jsonb("details"),
  dateCreated: timestamp("date_created").default(sql`now()`).notNull(),
  dateReceived: timestamp("date_received"),
  dateCleared: timestamp("date_cleared"),
  memo: text("memo"),
});

export const ledgerEa = pgTable("ledger_ea", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  accountId: varchar("account_id").notNull().references(() => ledgerAccounts.id),
  entityType: varchar("entity_type").notNull(),
  entityId: varchar("entity_id").notNull(),
  data: jsonb("data"),
}, (table) => ({
  uniqueAccountEntity: unique().on(table.accountId, table.entityId),
}));

export const ledger = pgTable("ledger", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  chargePlugin: varchar("charge_plugin").notNull(),
  chargePluginKey: varchar("charge_plugin_key").notNull(),
  chargePluginConfigId: varchar("charge_plugin_config_id"),
  amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
  eaId: varchar("ea_id").notNull().references(() => ledgerEa.id, { onDelete: 'cascade' }),
  referenceType: varchar("reference_type"),
  referenceId: varchar("reference_id"),
  date: timestamp("date"),
  memo: text("memo"),
  data: jsonb("data"),
  statementYmd: date("statement_ymd").notNull(),
}, (table) => ({
  uniqueChargePluginKey: unique().on(table.chargePlugin, table.chargePluginKey),
}));

export const wizards = pgTable("wizards", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  date: timestamp("date").default(sql`now()`).notNull(),
  type: varchar("type").notNull(),
  status: varchar("status").notNull(),
  currentStep: varchar("current_step"),
  entityId: varchar("entity_id"),
  data: jsonb("data"),
});

export const wizardEmployerMonthly = pgTable("wizard_employer_monthly", {
  wizardId: varchar("wizard_id").primaryKey().references(() => wizards.id, { onDelete: 'cascade' }),
  employerId: varchar("employer_id").notNull().references(() => employers.id, { onDelete: 'cascade' }),
  year: integer("year").notNull(),
  month: integer("month").notNull(),
}, (table) => [
  index("idx_wizard_employer_monthly_period").on(table.year, table.month),
  index("idx_wizard_employer_monthly_employer").on(table.employerId),
]);

export const wizardFeedMappings = pgTable("wizard_feed_mappings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  type: varchar("type").notNull(),
  firstRowHash: varchar("first_row_hash").notNull(),
  mapping: jsonb("mapping").notNull(),
  createdAt: timestamp("created_at").default(sql`now()`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`now()`).notNull(),
}, (table) => [
  index("idx_wizard_feed_mappings_user_type_hash").on(table.userId, table.type, table.firstRowHash),
]);

export const wizardEmploymentStatusMappings = pgTable("wizard_employment_status_mappings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  employerId: varchar("employer_id").notNull().references(() => employers.id, { onDelete: 'cascade' }),
  sourceStatus: text("source_status").notNull(),
  targetStatusId: varchar("target_status_id").notNull(),
  createdAt: timestamp("created_at").default(sql`now()`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`now()`).notNull(),
}, (table) => [
  unique("idx_wizard_esm_employer_source").on(table.employerId, table.sourceStatus),
  index("idx_wizard_esm_employer").on(table.employerId),
  foreignKey({
    name: "wizard_employment_status_mappings_target_status_id_options_empl",
    columns: [table.targetStatusId],
    foreignColumns: [optionsEmploymentStatus.id],
  }).onDelete("cascade"),
]);

export const wizardReportData = pgTable("wizard_report_data", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  wizardId: varchar("wizard_id").notNull().references(() => wizards.id, { onDelete: 'cascade' }),
  pk: varchar("pk").notNull(),
  data: jsonb("data"),
  createdAt: timestamp("created_at").default(sql`now()`).notNull(),
}, (table) => [
  index("idx_wizard_report_data_wizard_id").on(table.wizardId),
  unique("idx_wizard_report_data_wizard_id_pk").on(table.wizardId, table.pk),
]);

export const files = pgTable("files", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  fileName: varchar("file_name").notNull(),
  storagePath: varchar("storage_path").notNull(),
  mimeType: varchar("mime_type"),
  size: integer("size").notNull(),
  uploadedBy: varchar("uploaded_by").notNull(),
  uploadedAt: timestamp("uploaded_at").default(sql`now()`).notNull(),
  entityType: varchar("entity_type"),
  entityId: varchar("entity_id"),
  accessLevel: varchar("access_level").notNull().default('private'),
  metadata: jsonb("metadata"),
});

export const esigStatusEnum = pgEnum("esig_status", ["pending", "signed"]);
export const esigTypeEnum = pgEnum("esig_type", ["online", "offline", "upload"]);

export const esigs = pgTable("esigs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: 'restrict' }),
  status: esigStatusEnum("status").notNull().default("pending"),
  signedDate: timestamp("signed_date"),
  type: esigTypeEnum("type").notNull(),
  docFileId: varchar("doc_file_id").references(() => files.id, { onDelete: 'set null' }),
  docRender: text("doc_render"),
  docHash: text("doc_hash"),
  esig: jsonb("esig"),
  docType: text("doc_type"),
});

export const winstonLogs = pgTable("winston_logs", {
  id: serial("id").primaryKey(),
  level: varchar("level", { length: 20 }),
  message: text("message"),
  timestamp: timestamp("timestamp").default(sql`now()`),
  source: varchar("source", { length: 50 }),
  meta: jsonb("meta"),
  module: varchar("module", { length: 100 }),
  operation: varchar("operation", { length: 100 }),
  entityId: varchar("entity_id", { length: 255 }),
  hostEntityId: varchar("host_entity_id", { length: 255 }),
  description: text("description"),
  userId: varchar("user_id", { length: 255 }),
  userEmail: varchar("user_email", { length: 255 }),
  ipAddress: varchar("ip_address", { length: 45 }),
}, (table) => [
  index("idx_winston_logs_entity_id").on(table.entityId),
  index("idx_winston_logs_host_entity_id").on(table.hostEntityId),
  index("idx_winston_logs_module").on(table.module),
  index("idx_winston_logs_operation").on(table.operation),
  index("idx_winston_logs_user_id").on(table.userId),
]);

export type WinstonLog = typeof winstonLogs.$inferSelect;

export {
  cardcheckDefinitions,
  cardcheckStatusEnum,
  cardchecks,
  insertCardcheckDefinitionSchema,
  insertCardcheckSchema,
  type CardcheckDefinition,
  type InsertCardcheckDefinition,
  type Cardcheck,
  type InsertCardcheck,
} from "./schema/cardcheck/schema";

export {
  workerStewardAssignments,
  insertWorkerStewardAssignmentSchema,
  type WorkerStewardAssignment,
  type InsertWorkerStewardAssignment,
} from "./schema/worker/steward/schema";

export {
  sitespecificBtuCsg,
  insertBtuCsgSchema,
  type BtuCsgRecord,
  type InsertBtuCsgRecord,
  sitespecificBtuEmployerMap,
  insertBtuEmployerMapSchema,
  type BtuEmployerMap,
  type InsertBtuEmployerMap,
  btuTerritories,
  insertBtuTerritorySchema,
  type BtuTerritory,
  type InsertBtuTerritory,
  btuTerritoryReps,
  insertBtuTerritoryRepSchema,
  type BtuTerritoryRep,
  type InsertBtuTerritoryRep,
  btuTerritoryWorkers,
  insertBtuTerritoryWorkerSchema,
  type BtuTerritoryWorker,
  type InsertBtuTerritoryWorker,
  sitespecificBtuSchoolTypes,
  insertBtuSchoolTypeSchema,
  type BtuSchoolType,
  type InsertBtuSchoolType,
  sitespecificBtuRegions,
  insertBtuRegionSchema,
  type BtuRegion,
  type InsertBtuRegion,
  sitespecificBtuSchoolAttributes,
  insertBtuSchoolAttributesSchema,
  type BtuSchoolAttributes,
  type InsertBtuSchoolAttributes,
  btuScheduleItemSchema,
  type BtuScheduleItem,
} from "./schema/sitespecific/btu/schema";

export {
  bulkMediumEnum,
  bulkMessageStatusEnum,
  bulkMessages,
  insertBulkMessageSchema,
  type BulkMessage,
  type InsertBulkMessage,
  bulkMessagesEmail,
  insertBulkMessagesEmailSchema,
  type BulkMessagesEmail,
  type InsertBulkMessagesEmail,
  bulkMessagesSms,
  insertBulkMessagesSmsSchema,
  type BulkMessagesSms,
  type InsertBulkMessagesSms,
  bulkMessagesPostal,
  insertBulkMessagesPostalSchema,
  type BulkMessagesPostal,
  type InsertBulkMessagesPostal,
  bulkMessagesInapp,
  insertBulkMessagesInappSchema,
  type BulkMessagesInapp,
  type InsertBulkMessagesInapp,
  bulkParticipantStatusEnum,
  bulkParticipants,
  insertBulkParticipantSchema,
  type BulkParticipant,
  type InsertBulkParticipant,
} from "./schema/bulk/schema";

export {
  companies,
  insertCompanySchema,
  type Company,
  type InsertCompany,
  employerCompanies,
  insertEmployerCompanySchema,
  type EmployerCompany,
  type InsertEmployerCompany,
} from "./schema/employer/company-schema";

export {
  ledgerPaymentBatches,
  insertLedgerPaymentBatchSchema,
  type LedgerPaymentBatch,
  type InsertLedgerPaymentBatch,
  ledgerPaymentBatchAssignments,
  insertLedgerPaymentBatchAssignmentSchema,
  type LedgerPaymentBatchAssignment,
  type InsertLedgerPaymentBatchAssignment,
} from "./schema/ledger/payment-batch/schema";

export {
  sftpClientDestinations,
  insertSftpClientDestinationSchema,
  type SftpClientDestination,
  type InsertSftpClientDestination,
  sftpConnectionSchema,
  ftpConnectionSchema,
  connectionDataSchema,
  type ConnectionData,
  type SftpConnectionData,
  type FtpConnectionData,
  PROTOCOL_DEFAULTS,
} from "./schema/system/sftp-client-schema";

export {
  trustProviderEdi,
  insertTrustProviderEdiSchema,
  type TrustProviderEdi,
  type InsertTrustProviderEdi,
} from "./schema/trust/provider-edi-schema";

export {
  sitespecificBtuPoliticalOfficials,
  insertBtuPoliticalOfficialSchema,
  type BtuPoliticalOfficial,
  type InsertBtuPoliticalOfficial,
  sitespecificBtuPoliticalWorkerReps,
  insertBtuPoliticalWorkerRepSchema,
  type BtuPoliticalWorkerRep,
  type InsertBtuPoliticalWorkerRep,
  sitespecificBtuPoliticalDistrictCache,
  insertBtuPoliticalDistrictCacheSchema,
  type BtuPoliticalDistrictCache,
  type InsertBtuPoliticalDistrictCache,
} from "./schema/sitespecific/btu/political-schema";

export * from "./schema/sitespecific/gbhet-pension/schema";

export * from "./schema/sitespecific/bao/schema";

export {
  sitespecificFreemanCrewleads,
  insertFreemanCrewleadSchema,
  type FreemanCrewlead,
  type InsertFreemanCrewlead,
} from "./schema/sitespecific/freeman/schema";

export {
  optionsGrievanceStatus,
  insertOptionsGrievanceStatusSchema,
  type OptionsGrievanceStatus,
  type InsertOptionsGrievanceStatus,
  optionsGrievanceCategory,
  insertOptionsGrievanceCategorySchema,
  type OptionsGrievanceCategory,
  type InsertOptionsGrievanceCategory,
  optionsGrievanceSteps,
  insertOptionsGrievanceStepsSchema,
  type OptionsGrievanceStep,
  type InsertOptionsGrievanceStep,
  optionsGrievanceComplaints,
  insertOptionsGrievanceComplaintSchema,
  type OptionsGrievanceComplaint,
  type InsertOptionsGrievanceComplaint,
  optionsGrievanceRemedies,
  insertOptionsGrievanceRemedySchema,
  type OptionsGrievanceRemedy,
  type InsertOptionsGrievanceRemedy,
  optionsGrievanceRoles,
  insertOptionsGrievanceRoleSchema,
  type OptionsGrievanceRole,
  type InsertOptionsGrievanceRole,
  grievances,
  insertGrievanceSchema,
  GRIEVANCE_CARDINALITIES,
  type GrievanceCardinality,
  type Grievance,
  type InsertGrievance,
  grievanceWorkers,
  insertGrievanceWorkerSchema,
  type GrievanceWorker,
  type InsertGrievanceWorker,
  grievanceEmployers,
  insertGrievanceEmployerSchema,
  type GrievanceEmployer,
  type InsertGrievanceEmployer,
  grievanceUsers,
  insertGrievanceUserSchema,
  type GrievanceUser,
  type InsertGrievanceUser,
  grievanceComplaints,
  insertGrievanceComplaintSchema,
  type GrievanceComplaint,
  type InsertGrievanceComplaint,
  grievanceRemedies,
  insertGrievanceRemedySchema,
  type GrievanceRemedy,
  type InsertGrievanceRemedy,
  grievanceStepsDenorm,
  insertGrievanceStepsDenormSchema,
  type GrievanceStepsDenorm,
  type InsertGrievanceStepsDenorm,
  GRIEVANCE_TIMELINE_DAY_TYPES,
  type GrievanceTimelineDayType,
  grievanceTimelineTemplates,
  insertGrievanceTimelineTemplateSchema,
  type GrievanceTimelineTemplate,
  type InsertGrievanceTimelineTemplate,
  grievanceTimelineTemplateSteps,
  insertGrievanceTimelineTemplateStepSchema,
  type GrievanceTimelineTemplateStep,
  type InsertGrievanceTimelineTemplateStep,
  grievanceNameDenorm,
  insertGrievanceNameDenormSchema,
  type GrievanceNameDenorm,
  type InsertGrievanceNameDenorm,
  grievanceStatusHistory,
  insertGrievanceStatusHistorySchema,
  type GrievanceStatusHistory,
  type InsertGrievanceStatusHistory,
  grievanceTimelineAdjustmentSchema,
  type GrievanceTimelineAdjustment,
  TIMELINE_ADJUSTMENT_DATA_KEY,
  readTimelineAdjustment,
} from "./schema/grievance/schema";

export {
  optionsGrievanceSettlementType,
  insertOptionsGrievanceSettlementTypeSchema,
  type OptionsGrievanceSettlementType,
  type InsertOptionsGrievanceSettlementType,
  grievanceSettlements,
  insertGrievanceSettlementSchema,
  type GrievanceSettlement,
  type InsertGrievanceSettlement,
} from "./schema/grievance/settlement-schema";

export {
  grievanceContractSections,
  insertGrievanceContractSectionSchema,
  type GrievanceContractSection,
  type InsertGrievanceContractSection,
  grievanceContracts,
  insertGrievanceContractSchema,
  type GrievanceContract,
  type InsertGrievanceContract,
} from "./schema/grievance/contract-schema";

export {
  contracts,
  insertContractSchema,
  type Contract,
  type InsertContract,
  contractArticles,
  insertContractArticleSchema,
  type ContractArticle,
  type InsertContractArticle,
  contractSections,
  insertContractSectionSchema,
  type ContractSection,
  type InsertContractSection,
} from "./schema/contract/schema";

export {
  optionsSkills,
  insertOptionsSkillsSchema,
  type OptionsSkill,
  type InsertOptionsSkill,
  workerSkills,
  insertWorkerSkillsSchema,
  type WorkerSkill,
  type InsertWorkerSkill,
} from "./schema/worker/skills/schema";

export {
  optionsCertifications,
  insertOptionsCertificationsSchema,
  type OptionsCertification,
  type InsertOptionsCertification,
  workerCertificationStatusEnum,
  workerCertifications,
  insertWorkerCertificationSchema,
  type WorkerCertification,
  type InsertWorkerCertification,
} from "./schema/worker/certifications/schema";

export {
  optionsWorkerRatings,
  insertOptionsWorkerRatingsSchema,
  type OptionsWorkerRating,
  type InsertOptionsWorkerRating,
  workerRatings,
  insertWorkerRatingsSchema,
  type WorkerRating,
  type InsertWorkerRating,
} from "./schema/worker/ratings/schema";

export {
  workerTos,
  insertWorkerTosSchema,
  type WorkerTos,
  type InsertWorkerTos,
} from "./schema/worker/tos/schema";

export {
  optionsWorkerRelationType,
  insertOptionsWorkerRelationTypeSchema,
  type OptionsWorkerRelationType,
  type InsertOptionsWorkerRelationType,
  workerRelations,
  insertWorkerRelationSchema,
  type WorkerRelation,
  type InsertWorkerRelation,
} from "./schema/worker/relations/schema";

export {
  workerTrustElections,
  insertWorkerTrustElectionSchema,
  createWorkerTrustElectionRequestSchema,
  updateWorkerTrustElectionRequestSchema,
  type WorkerTrustElection,
  type WorkerTrustElectionView,
  type InsertWorkerTrustElection,
  type CreateWorkerTrustElectionRequest,
  type UpdateWorkerTrustElectionRequest,
} from "./schema/trust/elections-schema";

export {
  trustBenefitEligibilityExemptions,
  insertTrustBenefitEligibilityExemptionSchema,
  createTrustBenefitEligibilityExemptionRequestSchema,
  updateTrustBenefitEligibilityExemptionRequestSchema,
  type TrustBenefitEligibilityExemption,
  type InsertTrustBenefitEligibilityExemption,
  type CreateTrustBenefitEligibilityExemptionRequest,
  type UpdateTrustBenefitEligibilityExemptionRequest,
} from "./schema/trust/eligibility-exemptions-schema";

export {
  edlsSheets,
  edlsSheetStatusEnum,
  insertEdlsSheetsSchema,
  type EdlsSheet,
  type EdlsSheetStatus,
  type InsertEdlsSheet,
  edlsCrews,
  insertEdlsCrewsSchema,
  type EdlsCrew,
  type InsertEdlsCrew,
  edlsAssignments,
  insertEdlsAssignmentsSchema,
  updateAssignmentExtraSchema,
  type EdlsAssignment,
  type InsertEdlsAssignment,
  type AssignmentExtra,
  type UpdateAssignmentExtra,
  optionsEdlsTasks,
  insertEdlsTaskSchema,
  type EdlsTask,
  type InsertEdlsTask,
  optionsEdlsShowStatus,
  insertEdlsShowStatusSchema,
  type EdlsShowStatus,
  type InsertEdlsShowStatus,
  workerEdls,
  insertWorkerEdlsSchema,
  type WorkerEdls,
  type InsertWorkerEdls,
} from "./schema/edls/schema";

// Zod schemas for validation
export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// For Replit Auth upsert operations
export const upsertUserSchema = createInsertSchema(users).omit({
  createdAt: true,
  updatedAt: true,
  lastLogin: true,
  isActive: true,
});

// For admin user creation (email-based provisioning)
export const createUserSchema = z.object({
  email: z.string().email("Valid email is required"),
  firstName: z.string().optional().nullable(),
  lastName: z.string().optional().nullable(),
  isActive: z.boolean().default(true),
});

export const insertRoleSchema = createInsertSchema(roles).omit({
  id: true,
  createdAt: true,
});

export const insertContactSchema = createInsertSchema(contacts).omit({
  id: true,
});

export const insertWorkerSchema = createInsertSchema(workers).omit({
  id: true,
  contactId: true, // Contact will be managed automatically
  data: true, // Generic JSON blob; written only through dedicated storage methods
});

export const workerBanTypeEnum = ["dispatch"] as const;
export type WorkerBanType = typeof workerBanTypeEnum[number];

export const insertWorkerBanSchema = createInsertSchema(workerBans).omit({
  id: true,
  denormActive: true, // Auto-calculated based on end_date
}).extend({
  startDate: z.coerce.date(),
  endDate: z.coerce.date().optional().nullable(),
  type: z.enum(workerBanTypeEnum).optional().nullable(),
});

export const insertEmployerSchema = createInsertSchema(employers).omit({
  id: true,
});

export const insertPolicySchema = createInsertSchema(policies).omit({
  id: true,
});

export const insertBargainingUnitSchema = createInsertSchema(bargainingUnits).omit({
  id: true,
});

export const insertEmployerContactSchema = createInsertSchema(employerContacts).omit({
  id: true,
});

export const insertTrustProviderContactSchema = createInsertSchema(trustProviderContacts).omit({
  id: true,
});

export const insertWorkerHoursSchema = createInsertSchema(workerHours).omit({
  id: true,
}).refine((data) => {
  // Validate day is within 1-31
  if (data.day < 1 || data.day > 31) {
    return false;
  }
  
  // Validate day against the actual days in the month
  const daysInMonth = new Date(data.year, data.month, 0).getDate();
  return data.day <= daysInMonth;
}, {
  message: "Invalid day for the specified month and year",
  path: ["day"],
});

export const insertTrustProviderSchema = createInsertSchema(trustProviders).omit({
  id: true,
});

export const insertTrustBenefitSchema = createInsertSchema(trustBenefits).omit({
  id: true,
});

export const insertTrustWmbSchema = createInsertSchema(trustWmb).omit({
  id: true,
});

export const insertTrustWmbScanStatusSchema = createInsertSchema(trustWmbScanStatus).omit({
  id: true,
  queuedAt: true,
});

export const insertTrustWmbScanQueueSchema = createInsertSchema(trustWmbScanQueue).omit({
  id: true,
});

export const insertVariableSchema = createInsertSchema(variables).omit({
  id: true,
});

export const insertContactPostalSchema = createInsertSchema(contactPostal, {
  source: z.enum(['worker_self', 'employer_feed', 'admin', 'import', 'system']).optional(),
  deliverabilityStatus: z.enum(['unknown', 'verified', 'undeliverable', 'vacant', 'returned_mail']).optional(),
}).omit({
  id: true,
  createdAt: true,
});

export const insertPhoneNumberSchema = createInsertSchema(phoneNumbers).omit({
  id: true,
  createdAt: true,
});

export const insertBookmarkSchema = createInsertSchema(bookmarks).omit({
  id: true,
  createdAt: true,
});

export const insertLedgerPaymentMethodSchema = createInsertSchema(ledgerPaymentMethods).omit({
  id: true,
  createdAt: true,
});

export const ledgerAccountDataSchema = z.object({
  invoicesEnabled: z.boolean().optional(),
  invoiceHeader: z.string().optional(),
  invoiceFooter: z.string().optional(),
}).strict();

export const insertLedgerAccountSchema = createInsertSchema(ledgerAccounts).omit({
  id: true,
}).extend({
  data: ledgerAccountDataSchema.optional().nullable(),
});

export const insertLedgerPaymentSchema = createInsertSchema(ledgerPayments).omit({
  id: true,
  dateCreated: true,
});

export const insertLedgerEaSchema = createInsertSchema(ledgerEa).omit({
  id: true,
});

export type InsertLedgerEa = z.infer<typeof insertLedgerEaSchema>;
export type SelectLedgerEa = typeof ledgerEa.$inferSelect;

export const insertLedgerSchema = createInsertSchema(ledger, {
  date: z.coerce.date().nullish(),
}).omit({
  id: true,
}).extend({
  // statementYmd may be derived from `date` by the storage layer when omitted.
  statementYmd: z.string().refine(isValidYmd, { message: "statementYmd must be YYYY-MM-DD" }).optional() as z.ZodType<Ymd | undefined>,
});

export type InsertLedger = z.infer<typeof insertLedgerSchema>;
export type Ledger = typeof ledger.$inferSelect;

export const insertWizardSchema = createInsertSchema(wizards).omit({
  id: true,
  date: true,
});

export const insertWizardEmployerMonthlySchema = createInsertSchema(wizardEmployerMonthly);

export const insertWizardFeedMappingSchema = createInsertSchema(wizardFeedMappings).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertWizardEmploymentStatusMappingSchema = createInsertSchema(wizardEmploymentStatusMappings).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertWizardReportDataSchema = createInsertSchema(wizardReportData).omit({
  id: true,
  createdAt: true,
});

export const insertGenderOptionSchema = createInsertSchema(optionsGender).omit({
  id: true,
});

export const insertWorkerIdTypeSchema = createInsertSchema(optionsWorkerIdType).omit({
  id: true,
});

export const insertWorkerIdSchema = createInsertSchema(workerIds).omit({
  id: true,
});

export const insertWorkerWshSchema = createInsertSchema(workerWsh).omit({
  id: true,
});

export const insertWorkerMshSchema = createInsertSchema(workerMsh).omit({
  id: true,
});

export const insertEmployerPolicyHistorySchema = createInsertSchema(employerPolicyHistory).omit({
  id: true,
});

export const insertTrustBenefitTypeSchema = createInsertSchema(optionsTrustBenefitType).omit({
  id: true,
});

export const insertLedgerPaymentTypeSchema = createInsertSchema(optionsLedgerPaymentType).omit({
  id: true,
});

export const insertEmployerContactTypeSchema = createInsertSchema(optionsEmployerContactType).omit({
  id: true,
});

export const insertEmployerTypeSchema = createInsertSchema(optionsEmployerType).omit({
  id: true,
});

export const insertDepartmentSchema = createInsertSchema(optionsDepartment).omit({
  id: true,
});

export const insertClassificationSchema = createInsertSchema(optionsClassifications).omit({
  id: true,
}).extend({
  name: z.string().trim().min(1, "Name is required"),
  code: z.string().trim().nullable().optional(),
  siriusId: z.string().trim().nullable().optional(),
  data: z.record(z.unknown()).nullable().optional(),
});

export const insertTrustProviderTypeSchema = createInsertSchema(optionsTrustProviderType).omit({
  id: true,
});

export const insertEventTypeSchema = createInsertSchema(optionsEventType).omit({
  id: true,
});

export const insertCommTagSchema = createInsertSchema(optionsCommTags).omit({
  id: true,
});

export type OptionsCommTag = typeof optionsCommTags.$inferSelect;
export type InsertOptionsCommTag = z.infer<typeof insertCommTagSchema>;

export const insertWorkerWsSchema = createInsertSchema(optionsWorkerWs).omit({
  id: true,
}).extend({
  name: z.string().trim().min(1, "Name is required"),
  description: z.string().trim().nullable().or(z.literal("")).transform(val => val === "" ? null : val).optional(),
  sequence: z.number().optional().default(0),
});

export const updateWorkerWsSchema = z.object({
  name: z.string().trim().min(1, "Name is required").optional(),
  description: z.string().trim().nullable().or(z.literal("")).transform(val => val === "" ? null : val).optional(),
  sequence: z.number().optional(),
}).strict();

export const insertEmploymentStatusSchema = createInsertSchema(optionsEmploymentStatus).omit({
  id: true,
}).extend({
  name: z.string().trim().min(1, "Name is required"),
  code: z.string().trim().min(1, "Code is required"),
  employed: z.boolean().optional().default(false),
  description: z.string().trim().nullable().or(z.literal("")).transform(val => val === "" ? null : val).optional(),
  sequence: z.number().optional().default(0),
  data: z.object({ color: z.string().optional() }).nullable().optional(),
});

export const updateEmploymentStatusSchema = z.object({
  name: z.string().trim().min(1, "Name is required").optional(),
  code: z.string().trim().min(1, "Code is required").optional(),
  employed: z.boolean().optional(),
  description: z.string().trim().nullable().or(z.literal("")).transform(val => val === "" ? null : val).optional(),
  sequence: z.number().optional(),
  data: z.object({ color: z.string().optional() }).nullable().optional(),
}).strict();

export const assignRoleSchema = z.object({
  userId: z.string(),
  roleId: z.string(),
});

export const assignPermissionSchema = z.object({
  roleId: z.string(),
  permissionKey: z.string(), // Changed from permissionId to permissionKey
});

// TypeScript types
export type InsertUser = z.infer<typeof insertUserSchema>;
export type UpsertUser = z.infer<typeof upsertUserSchema>;
export type User = typeof users.$inferSelect;
export type CreateUser = z.infer<typeof createUserSchema>;

export type InsertRole = z.infer<typeof insertRoleSchema>;
export type Role = typeof roles.$inferSelect;

export type InsertContact = z.infer<typeof insertContactSchema>;
export type Contact = typeof contacts.$inferSelect;

export type InsertWorker = z.infer<typeof insertWorkerSchema>;
// `data` (jsonb) is an internal storage blob (e.g. sitespecific.bao.beneficiaries,
// which holds PII). It is deliberately excluded from the public Worker type and
// stripped in the storage layer so it never leaks through generic worker
// endpoints — it is only ever accessed via the dedicated getData/setData
// accessors and the component-gated beneficiaries storage namespace.
// `denormMsIds` / `denormWsId` / `denormHomeEmployerId` / `denormEmployerIds` /
// `denormJobTitle` are no longer physical columns on `workers`; they are derived
// from the `worker_msh_denorm` / `worker_wsh_denorm` / `worker_employment_denorm`
// tables by the worker read methods that need them (e.g. `getWorker`). Kept on
// the DTO so existing consumers see the same shape. The employment fields reflect
// the worker's HOME employment row: `denormHomeEmployerId` is the home row's
// employer, `denormJobTitle` is the home row's job title, and `denormEmployerIds`
// is the set of all employer ids across employment rows.
export type Worker = Omit<typeof workers.$inferSelect, "data"> & {
  denormMsIds?: string[] | null;
  denormWsId?: string | null;
  denormHomeEmployerId?: string | null;
  denormEmployerIds?: string[] | null;
  denormJobTitle?: string | null;
};

export type InsertWorkerBan = z.infer<typeof insertWorkerBanSchema>;
export type WorkerBan = typeof workerBans.$inferSelect;

export type InsertEmployer = z.infer<typeof insertEmployerSchema>;
export type Employer = typeof employers.$inferSelect;

export type InsertPolicy = z.infer<typeof insertPolicySchema>;
export type Policy = typeof policies.$inferSelect;

export type InsertBargainingUnit = z.infer<typeof insertBargainingUnitSchema>;
export type BargainingUnit = typeof bargainingUnits.$inferSelect;

export type InsertEmployerContact = z.infer<typeof insertEmployerContactSchema>;
export type EmployerContact = typeof employerContacts.$inferSelect;

export type InsertTrustProviderContact = z.infer<typeof insertTrustProviderContactSchema>;
export type TrustProviderContact = typeof trustProviderContacts.$inferSelect;

export type InsertWorkerHours = z.infer<typeof insertWorkerHoursSchema>;
export type WorkerHours = typeof workerHours.$inferSelect;

export type InsertTrustProvider = z.infer<typeof insertTrustProviderSchema>;
export type TrustProvider = typeof trustProviders.$inferSelect;

export type InsertTrustBenefit = z.infer<typeof insertTrustBenefitSchema>;
export type TrustBenefit = typeof trustBenefits.$inferSelect;

export type InsertTrustWmb = z.infer<typeof insertTrustWmbSchema>;
export type TrustWmb = typeof trustWmb.$inferSelect;

export type InsertTrustWmbScanStatus = z.infer<typeof insertTrustWmbScanStatusSchema>;
export type TrustWmbScanStatus = typeof trustWmbScanStatus.$inferSelect;

export type InsertTrustWmbScanQueue = z.infer<typeof insertTrustWmbScanQueueSchema>;
export type TrustWmbScanQueue = typeof trustWmbScanQueue.$inferSelect;

export type InsertVariable = z.infer<typeof insertVariableSchema>;
export type Variable = typeof variables.$inferSelect;

export type InsertContactPostal = z.infer<typeof insertContactPostalSchema>;
export type ContactPostal = typeof contactPostal.$inferSelect;

export type InsertPhoneNumber = z.infer<typeof insertPhoneNumberSchema>;
export type PhoneNumber = typeof phoneNumbers.$inferSelect;

export type InsertBookmark = z.infer<typeof insertBookmarkSchema>;
export type Bookmark = typeof bookmarks.$inferSelect;

export type InsertLedgerPaymentMethod = z.infer<typeof insertLedgerPaymentMethodSchema>;
export type LedgerPaymentMethod = typeof ledgerPaymentMethods.$inferSelect;

export type InsertLedgerAccount = z.infer<typeof insertLedgerAccountSchema>;
export type LedgerAccount = typeof ledgerAccounts.$inferSelect;

export type InsertLedgerPayment = z.infer<typeof insertLedgerPaymentSchema>;
export type LedgerPayment = typeof ledgerPayments.$inferSelect;

export type AllocatedEntity = {
  eaId: string;
  entityType: string;
  entityId: string;
  entityName: string | null;
};

export type LedgerPaymentWithEntity = LedgerPayment & {
  entityType: string;
  entityId: string;
  entityName: string | null;
  allocatedEntities: AllocatedEntity[];
};

export type InsertWizard = z.infer<typeof insertWizardSchema>;
export type Wizard = typeof wizards.$inferSelect;

export type InsertWizardFeedMapping = z.infer<typeof insertWizardFeedMappingSchema>;
export type WizardFeedMapping = typeof wizardFeedMappings.$inferSelect;

export type InsertWizardEmploymentStatusMapping = z.infer<typeof insertWizardEmploymentStatusMappingSchema>;
export type WizardEmploymentStatusMapping = typeof wizardEmploymentStatusMappings.$inferSelect;

export type InsertWizardReportData = z.infer<typeof insertWizardReportDataSchema>;
export type WizardReportData = typeof wizardReportData.$inferSelect;

export const wizardStepProgressSchema = z.object({
  status: z.enum(['pending', 'in_progress', 'completed']),
  completedAt: z.string().optional(),
  payload: z.any().optional(),
});

export const wizardStepStatusSchema = z.object({
  isComplete: z.boolean(),
  updatedAt: z.string(),
});

export const wizardDataSchema = z.object({
  progress: z.record(z.string(), wizardStepProgressSchema).optional(),
  stepStatus: z.record(z.string(), wizardStepStatusSchema).optional(),
  metadata: z.object({
    lastUpdatedBy: z.string().optional(),
    lastUpdatedAt: z.string().optional(),
  }).optional(),
}).passthrough();

export type WizardStepProgress = z.infer<typeof wizardStepProgressSchema>;
export type WizardStepStatus = z.infer<typeof wizardStepStatusSchema>;
export type WizardData = z.infer<typeof wizardDataSchema>;

export const insertFileSchema = createInsertSchema(files).omit({
  id: true,
  uploadedAt: true,
});

export const insertEsigSchema = createInsertSchema(esigs).omit({
  id: true,
});

export type InsertFile = z.infer<typeof insertFileSchema>;
export type File = typeof files.$inferSelect;

export type InsertEsig = z.infer<typeof insertEsigSchema>;
export type Esig = typeof esigs.$inferSelect;

export type InsertGenderOption = z.infer<typeof insertGenderOptionSchema>;
export type GenderOption = typeof optionsGender.$inferSelect;

export type InsertWorkerIdType = z.infer<typeof insertWorkerIdTypeSchema>;
export type WorkerIdType = typeof optionsWorkerIdType.$inferSelect;

export type InsertWorkerId = z.infer<typeof insertWorkerIdSchema>;
export type WorkerId = typeof workerIds.$inferSelect;

export type InsertWorkerWsh = z.infer<typeof insertWorkerWshSchema>;
export type WorkerWsh = typeof workerWsh.$inferSelect;

export type InsertWorkerMsh = z.infer<typeof insertWorkerMshSchema>;
export type WorkerMsh = typeof workerMsh.$inferSelect;

export type InsertEmployerPolicyHistory = z.infer<typeof insertEmployerPolicyHistorySchema>;
export type EmployerPolicyHistory = typeof employerPolicyHistory.$inferSelect;

export type InsertTrustBenefitType = z.infer<typeof insertTrustBenefitTypeSchema>;
export type TrustBenefitType = typeof optionsTrustBenefitType.$inferSelect;

export type InsertLedgerPaymentType = z.infer<typeof insertLedgerPaymentTypeSchema>;
export type LedgerPaymentType = typeof optionsLedgerPaymentType.$inferSelect;

export type InsertEmployerContactType = z.infer<typeof insertEmployerContactTypeSchema>;
export type EmployerContactType = typeof optionsEmployerContactType.$inferSelect;

export type InsertEmployerType = z.infer<typeof insertEmployerTypeSchema>;
export type EmployerType = typeof optionsEmployerType.$inferSelect;

export type InsertDepartment = z.infer<typeof insertDepartmentSchema>;
export type Department = typeof optionsDepartment.$inferSelect;

export type InsertClassification = z.infer<typeof insertClassificationSchema>;
export type Classification = typeof optionsClassifications.$inferSelect;

export type InsertTrustProviderType = z.infer<typeof insertTrustProviderTypeSchema>;
export type TrustProviderType = typeof optionsTrustProviderType.$inferSelect;

export type InsertEventType = z.infer<typeof insertEventTypeSchema>;
export type EventType = typeof optionsEventType.$inferSelect;

export const insertEventSchema = createInsertSchema(events).omit({
  id: true,
  createdAt: true,
});
export type InsertEvent = z.infer<typeof insertEventSchema>;
export type Event = typeof events.$inferSelect;

export const insertEventOccurrenceSchema = createInsertSchema(eventOccurrences).omit({
  id: true,
  createdAt: true,
});
export type InsertEventOccurrence = z.infer<typeof insertEventOccurrenceSchema>;
export type EventOccurrence = typeof eventOccurrences.$inferSelect;

export const insertEventParticipantSchema = createInsertSchema(eventParticipants).omit({
  id: true,
});
export type InsertEventParticipant = z.infer<typeof insertEventParticipantSchema>;
export type EventParticipant = typeof eventParticipants.$inferSelect;

export type InsertWorkerWs = z.infer<typeof insertWorkerWsSchema>;
export type WorkerWs = typeof optionsWorkerWs.$inferSelect;

export type InsertEmploymentStatus = z.infer<typeof insertEmploymentStatusSchema>;
export type EmploymentStatus = typeof optionsEmploymentStatus.$inferSelect;

export type UserRole = typeof userRoles.$inferSelect;
export type RolePermission = typeof rolePermissions.$inferSelect;
export type AssignRole = z.infer<typeof assignRoleSchema>;
export type AssignPermission = z.infer<typeof assignPermissionSchema>;

// Address parsing schemas
export const parseAddressRequestSchema = z.object({
  rawAddress: z.string().min(1, "Address cannot be empty"),
  context: z.object({
    country: z.string().optional(),
    region: z.string().optional(),
  }).optional(),
});

export const structuredAddressSchema = z.object({
  street: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  postalCode: z.string().optional(),
  country: z.string().optional(),
  // Additional fields for international support
  sublocality: z.string().optional(),
  province: z.string().optional(),
  locality: z.string().optional(),
});

export const addressSuggestionSchema = z.object({
  field: z.string(),
  value: z.string(),
  confidence: z.number().min(0).max(1).optional(),
});

export const addressParseValidationSchema = z.object({
  isValid: z.boolean(),
  errors: z.array(z.string()),
  warnings: z.array(z.string()),
  source: z.enum(["local", "google"]),
  confidence: z.number().min(0).max(1).optional(),
  suggestions: z.array(addressSuggestionSchema).optional(),
  providerMetadata: z.record(z.any()).optional(),
});

// Discriminated union for success/failure responses
export const parseAddressResponseSchema = z.discriminatedUnion("success", [
  z.object({
    success: z.literal(true),
    structuredAddress: structuredAddressSchema,
    validation: addressParseValidationSchema,
  }),
  z.object({
    success: z.literal(false),
    validation: addressParseValidationSchema,
    message: z.string(),
  }),
]);

// Address parsing types
export type ParseAddressRequest = z.infer<typeof parseAddressRequestSchema>;
export type StructuredAddress = z.infer<typeof structuredAddressSchema>;
export type AddressSuggestion = z.infer<typeof addressSuggestionSchema>;
export type AddressParseValidation = z.infer<typeof addressParseValidationSchema>;
export type ParseAddressResponse = z.infer<typeof parseAddressResponseSchema>;

// Helper function to generate display name from name components
export function generateDisplayName(components: {
  title?: string | null;
  given?: string | null;
  middle?: string | null;
  family?: string | null;
  generational?: string | null;
  credentials?: string | null;
}): string {
  const parts: string[] = [];
  
  if (components.title) parts.push(components.title);
  if (components.given) parts.push(components.given);
  if (components.middle) parts.push(components.middle);
  if (components.family) parts.push(components.family);
  if (components.generational) parts.push(components.generational);
  
  let name = parts.join(' ');
  
  if (components.credentials) {
    name += `, ${components.credentials}`;
  }
  
  return name || 'Unnamed Contact';
}

// SSN utilities - import from centralized module
import { parseSSN, formatSSN as formatSSNUtil, validateSSN as validateSSNUtil } from './utils/ssn';

// Re-export for use in other modules
export { parseSSN, validateSSN } from './utils/ssn';

// Helper function to format SSN for display (backward compatibility wrapper)
export function formatSSN(ssn: string | null | undefined): string {
  if (!ssn) return '';
  try {
    // Try to parse and format
    const parsed = parseSSN(ssn);
    return formatSSNUtil(parsed, 'dashed');
  } catch {
    // If parsing fails, return as-is
    return ssn;
  }
}

// Helper function to unformat SSN (remove dashes) - now uses parseSSN
export function unformatSSN(ssn: string): string {
  try {
    return parseSSN(ssn);
  } catch {
    // Fallback to stripping non-digits
    return ssn.replace(/\D/g, '');
  }
}

// Employer Monthly Plugin Configuration Schema
export const employerMonthlyPluginConfigSchema = z.record(
  z.string(), // roleId
  z.array(z.string()) // array of wizard type names
);

export type EmployerMonthlyPluginConfig = z.infer<typeof employerMonthlyPluginConfigSchema>;

// Charge Plugin Configs
//
// Charge no longer owns a dedicated table (Task #355). Charge configs live in
// the unified `plugin_configs` (plugin_kind = 'charge') base table plus the
// `plugin_configs_charge` subsidiary (scope / employer / account). This type is
// the resolved, composed shape every charge caller consumes: base columns with
// the base `data` blob surfaced as `settings`, joined with the subsidiary's
// relational dimensions. The charge storage namespace maps the two rows into
// this shape so callers (executor, crons, wizards) keep working unchanged.
export type ChargePluginConfig = {
  id: string;
  pluginId: string;
  name: string | null;
  enabled: boolean;
  scope: string;
  employerId: string | null;
  account: string | null;
  settings: unknown;
  createdAt: Date;
  updatedAt: Date;
};

// ---------------------------------------------------------------------------
// Unified plugin configuration storage (Task #353 — additive foundation)
//
// A single base table (`plugin_configs`) holds the fields common to every
// plugin kind's configuration row. Per-kind relational / queryable dimensions
// live in subsidiary tables keyed 1:1 by the base row id (class-table
// inheritance): each subsidiary's primary key IS a cascade-delete FK back to
// `plugin_configs.id`. Kind-specific opaque settings stay in the base `data`
// jsonb column.
//
// This is the additive foundation only — no kind has been cut over to it yet;
// the legacy per-kind config tables remain the source of truth.
// ---------------------------------------------------------------------------
export const pluginConfigs = pgTable("plugin_configs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  // PluginKind discriminator (e.g. "charge", "dispatch-eligibility",
  // "trust-eligibility", "dashboard", "client-injection").
  pluginKind: varchar("plugin_kind").notNull(),
  pluginId: text("plugin_id").notNull(), // the registered plugin's id within its kind
  enabled: boolean("enabled").default(false).notNull(),
  name: text("name"), // optional descriptive name for this configuration
  // Optional, unique, editable stable identifier. Manual rows leave it null
  // (multiple NULLs are allowed by the unique constraint); component-owned
  // rows use the scheme `auto.<componentId>.<localId>` so the component
  // lifecycle can reconcile them by sirius_id.
  siriusId: varchar("sirius_id").unique(),
  // CORE ordering dimension (deterministic listing / precedence) shared by
  // every kind — intentionally on the base table, not a subsidiary.
  ordering: integer("ordering").default(0).notNull(),
  // Per-row singleton marker. Set by the storage layer from the plugin type's
  // manifest `singleton` flag at create time (omitted from the insert schema so
  // it can never be set from request input). Drives the partial unique index
  // below, making the singleton backstop fully per-TYPE instead of hardcoded to
  // a specific kind: any plugin type that declares `singleton: true` is covered
  // with no schema/migration change.
  isSingleton: boolean("is_singleton").default(false).notNull(),
  data: jsonb("data").default(sql`'{}'::jsonb`), // kind-specific opaque settings blob
  createdAt: timestamp("created_at").default(sql`now()`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`now()`).notNull(),
}, (table) => [
  // Singleton plugin types permit exactly one config row per plugin id.
  // Non-singleton types (charge, trust-eligibility, …) legitimately have many
  // rows per (kind, plugin_id), so this uniqueness is a PARTIAL index scoped to
  // rows the storage layer flagged `is_singleton`. This is the race-safe
  // backstop behind the app-level singleton check, and it covers EVERY
  // singleton type (any kind) without a predicate that names a specific kind.
  // The reflected predicate for a boolean column is just the bare column name
  // (`WHERE is_singleton`), which normalizes cleanly for the startup drift gate
  // — no `::text` cast needed (unlike the previous string-literal predicate).
  uniqueIndex("plugin_configs_singleton_uniq")
    .on(table.pluginKind, table.pluginId)
    .where(sql`${table.isSingleton}`),
]);

export const insertPluginConfigSchema = createInsertSchema(pluginConfigs)
  .omit({
    id: true,
    createdAt: true,
    updatedAt: true,
    // Derived by the storage layer from the plugin type's manifest singleton
    // flag — never accepted from request input.
    isSingleton: true,
  })
  .extend({
    data: z.unknown().optional().default({}),
  });

export type InsertPluginConfig = z.infer<typeof insertPluginConfigSchema>;
export type PluginConfig = typeof pluginConfigs.$inferSelect;

// Charge subsidiary — relational dimensions hoisted out of the opaque settings
// blob (scope / employer / account). Mirrors legacy charge_plugin_configs.
export const pluginConfigsCharge = pgTable("plugin_configs_charge", {
  id: varchar("id").primaryKey().references(() => pluginConfigs.id, { onDelete: 'cascade' }),
  scope: varchar("scope").notNull(), // 'global' or 'employer'
  employerId: varchar("employer_id").references(() => employers.id, { onDelete: 'cascade' }),
  // Required FK: every charge config must target a ledger account. Delete is
  // RESTRICT so a referenced account cannot be removed out from under a config
  // (which would otherwise violate this NOT NULL).
  account: varchar("account").notNull().references(() => ledgerAccounts.id, { onDelete: 'restrict' }),
});

export const insertPluginConfigChargeSchema = createInsertSchema(pluginConfigsCharge);
export type InsertPluginConfigCharge = z.infer<typeof insertPluginConfigChargeSchema>;
export type PluginConfigCharge = typeof pluginConfigsCharge.$inferSelect;

// Trust benefit eligibility subsidiary — owned by the `trust.benefits`
// component. Defined in shared/schema/trust/benefit-eligibility-schema.ts and
// re-exported here so existing `@shared/schema` importers keep working.
export {
  pluginConfigsBenefitEligibility,
  insertPluginConfigBenefitEligibilitySchema,
  type InsertPluginConfigBenefitEligibility,
  type PluginConfigBenefitEligibility,
  trustWmbEvents,
  insertTrustWmbEventSchema,
  type InsertTrustWmbEvent,
  type TrustWmbEvent,
} from "./schema/trust/benefit-eligibility-schema";

// Dashboard subsidiary — role-based visibility hoisted out of the opaque
// settings blob. Each dashboard config targets exactly one role; a viewer
// sees the widget only when they hold that role. The role FK is RESTRICT so a
// role still referenced by a dashboard config cannot be deleted out from under
// it (which would otherwise leave the config with no subsidiary row and make it
// vanish from the inner-joined search/render path).
export const pluginConfigsDashboard = pgTable("plugin_configs_dashboard", {
  id: varchar("id").primaryKey().references(() => pluginConfigs.id, { onDelete: 'cascade' }),
  role: varchar("role").notNull().references(() => roles.id, { onDelete: 'restrict' }),
});

export const insertPluginConfigDashboardSchema = createInsertSchema(pluginConfigsDashboard);
export type InsertPluginConfigDashboard = z.infer<typeof insertPluginConfigDashboardSchema>;
export type PluginConfigDashboard = typeof pluginConfigsDashboard.$inferSelect;

// Payment-gateway subsidiary — exists primarily as a type-safe FK target so
// other tables (e.g. ledger_accounts.gateway_config_id) can reference a
// specific payment-gateway config without pointing at the polymorphic
// plugin_configs base. It carries no columns of its own yet beyond the shared
// id FK (meaningful columns may be added later). Every payment-gateway config
// gets exactly one row — created by the adapter's toRows on write and by an
// idempotent boot-time backfill for pre-existing configs — so the generic
// inner-joined search keeps returning them.
export const pluginConfigsPaymentGateway = pgTable("plugin_configs_payment_gateway", {
  id: varchar("id").primaryKey().references(() => pluginConfigs.id, { onDelete: 'cascade' }),
});

export const insertPluginConfigPaymentGatewaySchema = createInsertSchema(pluginConfigsPaymentGateway);
export type InsertPluginConfigPaymentGateway = z.infer<typeof insertPluginConfigPaymentGatewaySchema>;
export type PluginConfigPaymentGateway = typeof pluginConfigsPaymentGateway.$inferSelect;

// Event-notifier subsidiary — hoists the per-config "active media" selection
// out of the opaque settings blob into a real, filterable envelope column.
// A plugin declares which media it *can* send through (supportedMedia); the
// admin picks the active subset per config, persisted here as a comma-joined
// list (e.g. "email,sms"). Every event-notifier config gets exactly one row —
// created by the adapter's toRows on write and by an idempotent boot-time
// backfill for pre-existing configs — so the generic inner-joined search keeps
// returning them.
export const pluginConfigsEventNotifier = pgTable("plugin_configs_event_notifier", {
  id: varchar("id").primaryKey().references(() => pluginConfigs.id, { onDelete: 'cascade' }),
  media: text("media"),
});

export const insertPluginConfigEventNotifierSchema = createInsertSchema(pluginConfigsEventNotifier);
export type InsertPluginConfigEventNotifier = z.infer<typeof insertPluginConfigEventNotifierSchema>;
export type PluginConfigEventNotifier = typeof pluginConfigsEventNotifier.$inferSelect;

// Cron subsidiary — keeps the cron `schedule` (a cron expression) as a
// first-class, queryable envelope column rather than burying it in the opaque
// `data` blob. Cron plugins are singletons, so every cron config gets exactly
// one row — created by the adapter's `toRows` on write and by the boot-time
// singleton seeder for built-in jobs — so the generic inner-joined search keeps
// returning them.
export const pluginConfigsCron = pgTable("plugin_configs_cron", {
  id: varchar("id").primaryKey().references(() => pluginConfigs.id, { onDelete: 'cascade' }),
  schedule: varchar("schedule").notNull(),
});

export const insertPluginConfigCronSchema = createInsertSchema(pluginConfigsCron);
export type InsertPluginConfigCron = z.infer<typeof insertPluginConfigCronSchema>;
export type PluginConfigCron = typeof pluginConfigsCron.$inferSelect;

// Denorm workflow status spine. One row per (entity, plugin-config): tracks
// whether an entity's denormalized data for a given plugin config is current,
// stale, or errored — NOT the payload itself (each plugin owns its own payload
// table(s) and may write as many rows as it likes). `config_id` is ON DELETE
// CASCADE so a config's denorm rows die with it. `entity_type` is a plain
// plugin-defined string (no enum) — each plugin decides what to write.
export const denormStatusEnum = pgEnum("denorm_status", ["ok", "stale", "error"]);

export const denorm = pgTable("denorm", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  entityId: varchar("entity_id").notNull(),
  entityType: varchar("entity_type").notNull(),
  configId: varchar("config_id")
    .notNull()
    .references(() => pluginConfigs.id, { onDelete: 'cascade' }),
  status: denormStatusEnum("status").notNull(),
  computedAt: timestamp("computed_at"),
  staleAt: timestamp("stale_at"),
  message: varchar("message"),
}, (table) => [
  uniqueIndex("denorm_entity_config_uniq").on(table.entityId, table.configId),
  index("denorm_status_idx").on(table.status),
  index("denorm_config_idx").on(table.configId),
]);

export const insertDenormSchema = createInsertSchema(denorm);
export type InsertDenorm = z.infer<typeof insertDenormSchema>;
export type Denorm = typeof denorm.$inferSelect;
export type DenormStatus = (typeof denormStatusEnum.enumValues)[number];

// Per-worker denormalized current member statuses (payload table for the
// `worker_ms` denorm plugin). One row per (worker, member-status), where
// each row is the latest member status for one industry. `denorm_id` ties the
// rows back to their workflow status row in `denorm`. Replaces the former
// `workers.denorm_ms_ids` array column.
export const workerMshDenorm = pgTable("worker_msh_denorm", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  denormId: varchar("denorm_id")
    .notNull()
    .references(() => denorm.id, { onDelete: 'cascade' }),
  workerId: varchar("worker_id")
    .notNull()
    .references(() => workers.id, { onDelete: 'cascade' }),
  msId: varchar("ms_id")
    .notNull()
    .references(() => optionsWorkerMs.id, { onDelete: 'cascade' }),
}, (table) => [
  uniqueIndex("worker_msh_denorm_worker_ms_uniq").on(table.workerId, table.msId),
  index("worker_msh_denorm_denorm_idx").on(table.denormId),
]);

export const insertWorkerMshDenormSchema = createInsertSchema(workerMshDenorm).omit({
  id: true,
});
export type InsertWorkerMshDenorm = z.infer<typeof insertWorkerMshDenormSchema>;
export type WorkerMshDenorm = typeof workerMshDenorm.$inferSelect;

// Per-worker denormalized current work status (payload table for the
// `worker_ws` denorm plugin). A worker has exactly ONE current work status, so
// `worker_id` is UNIQUE and the table holds 0-or-1 row per worker (the row is
// only present when the worker has a work status). `denorm_id` ties the row back
// to its workflow status row in `denorm`. Replaces the former
// `workers.denorm_ws_id` column.
export const workerWshDenorm = pgTable("worker_wsh_denorm", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  denormId: varchar("denorm_id")
    .notNull()
    .references(() => denorm.id, { onDelete: 'cascade' }),
  workerId: varchar("worker_id")
    .notNull()
    .references(() => workers.id, { onDelete: 'cascade' }),
  wsId: varchar("ws_id")
    .notNull()
    .references(() => optionsWorkerWs.id, { onDelete: 'cascade' }),
}, (table) => [
  uniqueIndex("worker_wsh_denorm_worker_uniq").on(table.workerId),
  index("worker_wsh_denorm_denorm_idx").on(table.denormId),
]);

export const insertWorkerWshDenormSchema = createInsertSchema(workerWshDenorm).omit({
  id: true,
});
export type InsertWorkerWshDenorm = z.infer<typeof insertWorkerWshDenormSchema>;
export type WorkerWshDenorm = typeof workerWshDenorm.$inferSelect;

// Per-worker denormalized current employment (payload table for the
// `worker_employment` denorm plugin). One row per (worker, employer), where each
// row is the worker's latest employment with that employer derived from hours
// history (`worker_hours`). At most one row per worker carries `home = true`
// (the worker's home employer; a worker may have none), and `job_title` is
// stored on every row. The
// `denorm_id` ties the rows back to their workflow status row in `denorm`.
// Replaces the former `workers.denorm_home_employer_id`,
// `workers.denorm_employer_ids`, and `workers.denorm_job_title` columns.
export const workerEmploymentDenorm = pgTable("worker_employment_denorm", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  denormId: varchar("denorm_id")
    .notNull()
    .references(() => denorm.id, { onDelete: 'cascade' }),
  workerId: varchar("worker_id")
    .notNull()
    .references(() => workers.id, { onDelete: 'cascade' }),
  employerId: varchar("employer_id")
    .notNull()
    .references(() => employers.id, { onDelete: 'cascade' }),
  home: boolean("home").notNull().default(false),
  jobTitle: text("job_title"),
}, (table) => [
  uniqueIndex("worker_employment_denorm_worker_employer_uniq").on(table.workerId, table.employerId),
  index("worker_employment_denorm_denorm_idx").on(table.denormId),
]);

export const insertWorkerEmploymentDenormSchema = createInsertSchema(workerEmploymentDenorm).omit({
  id: true,
});
export type InsertWorkerEmploymentDenorm = z.infer<typeof insertWorkerEmploymentDenormSchema>;
export type WorkerEmploymentDenorm = typeof workerEmploymentDenorm.$inferSelect;

// ===========================================================================
// Deferred Event Bus (EBS)
// ===========================================================================
// The EBS lets a denorm plugin schedule a future real event-bus event. Each
// denorm entity owned by an EBS-scheduling plugin corresponds to exactly ONE
// scheduled event, keyed by the denorm `entity_id` (a plugin-defined
// `unique_id`). `ebs_denorm` is that plugin's payload table (one row per
// scheduled event): which `event_type` to emit, its `payload`, and the
// [`send_on`, `dont_send_after`] delivery window. A generic core cron
// (`ebs_pump`) drains due rows, emits them via the event bus, and records the
// outcome in `ebs_status`; delivery itself is handled by ordinary
// event-notifier plugins subscribed to the emitted event.
//
// `denorm_id` FKs `denorm(id)` ON DELETE CASCADE, so a scheduled event dies
// with its denorm status row (e.g. when the widow sweep removes a denorm row
// whose underlying entity is gone). `unique_id` mirrors the denorm entity_id
// and is what joins to the decoupled `ebs_status` table.
export const ebsDenorm = pgTable("ebs_denorm", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  denormId: varchar("denorm_id")
    .notNull()
    .references(() => denorm.id, { onDelete: 'cascade' }),
  uniqueId: varchar("unique_id").notNull(),
  pluginId: varchar("plugin_id").notNull(),
  eventType: varchar("event_type").notNull(),
  payload: jsonb("payload").notNull(),
  // The owning subject the scheduled event is *about* (e.g. the worker), so the
  // bus can be operated at subject granularity (find/purge every scheduled event
  // for a subject) without decoding each `unique_id`. Indexed; opaque to the pump.
  subjectId: varchar("subject_id").notNull(),
  sendOn: timestamp("send_on").notNull(),
  dontSendAfter: timestamp("dont_send_after").notNull(),
}, (table) => [
  uniqueIndex("ebs_denorm_denorm_uniq").on(table.denormId),
  uniqueIndex("ebs_denorm_unique_id_uniq").on(table.uniqueId),
  index("ebs_denorm_send_on_idx").on(table.sendOn),
  index("ebs_denorm_subject_idx").on(table.subjectId),
]);

export const insertEbsDenormSchema = createInsertSchema(ebsDenorm).omit({
  id: true,
});
export type InsertEbsDenorm = z.infer<typeof insertEbsDenormSchema>;
export type EbsDenorm = typeof ebsDenorm.$inferSelect;

// Terminal delivery record for a scheduled event, keyed by `unique_id`.
// DECOUPLED from `ebs_denorm` (no FK) on purpose: it must survive the widow
// deletion of its `ebs_denorm`/`denorm` rows so a later recompute cannot
// re-create and re-fire an event that has already been delivered (or expired).
// The presence of ANY row for a `unique_id` means "terminal — do not process";
// `status` distinguishes a successful send from a window that lapsed unfired.
// `purge_after` (derived from the source event's `dont_send_after`) drives a
// row-safe retention purge: a status row is only dropped once its scheduling
// window is long past, so the purge can never re-open a still-in-window event.
export const ebsDeliveryStatusEnum = pgEnum("ebs_delivery_status", ["sent", "expired"]);

export const ebsStatus = pgTable("ebs_status", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  uniqueId: varchar("unique_id").notNull(),
  status: ebsDeliveryStatusEnum("status").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  purgeAfter: timestamp("purge_after").notNull(),
}, (table) => [
  unique("ebs_status_unique_id_uniq").on(table.uniqueId),
  index("ebs_status_purge_idx").on(table.purgeAfter),
]);

export const insertEbsStatusSchema = createInsertSchema(ebsStatus).omit({
  id: true,
  createdAt: true,
});
export type InsertEbsStatus = z.infer<typeof insertEbsStatusSchema>;
export type EbsStatus = typeof ebsStatus.$inferSelect;
export type EbsDeliveryStatus = (typeof ebsDeliveryStatusEnum.enumValues)[number];

// Base Rate History Schema - for use in charge plugins
export const baseRateHistoryEntrySchema = z.object({
  effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format"),
  rate: z.number().positive("Rate must be positive"),
});

export type BaseRateHistoryEntry = z.infer<typeof baseRateHistoryEntrySchema>;

// Helper function to create rate history schema with validation
export const createRateHistorySchema = (minEntries = 1) => {
  return z.array(baseRateHistoryEntrySchema).min(minEntries, `At least ${minEntries} rate entry is required`);
};

// Cron job run history. Configuration for cron jobs now lives in
// plugin_configs (plugin_kind='cron') + plugin_configs_cron; `jobName` here is
// the cron plugin id (the former cron_jobs.name). No FK — the legacy cron_jobs
// table has been dropped and run history is retained independently.
export const cronJobRuns = pgTable("cron_job_runs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  jobName: text("job_name").notNull(),
  status: varchar("status").notNull(), // 'running', 'success', 'error'
  mode: varchar("mode").notNull().default("live"), // 'live' or 'test'
  output: text("output"),
  error: text("error"),
  startedAt: timestamp("started_at").default(sql`now()`).notNull(),
  completedAt: timestamp("completed_at"),
  triggeredBy: varchar("triggered_by"), // 'scheduler' or user id
});

export const insertCronJobRunSchema = createInsertSchema(cronJobRuns).omit({
  id: true,
  startedAt: true,
});

export type InsertCronJobRun = z.infer<typeof insertCronJobRunSchema>;
export type CronJobRun = typeof cronJobRuns.$inferSelect;

// Communications
export const comm = pgTable("comm", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  medium: varchar("medium").notNull(),
  contactId: varchar("contact_id").notNull().references(() => contacts.id, { onDelete: 'cascade' }),
  status: varchar("status").notNull(),
  sent: timestamp("sent"),
  received: timestamp("received"),
  data: jsonb("data"),
});

export const insertCommSchema = createInsertSchema(comm).omit({
  id: true,
});

export type InsertComm = z.infer<typeof insertCommSchema>;
export type Comm = typeof comm.$inferSelect;

// Communications - SMS
export const commSms = pgTable("comm_sms", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  commId: varchar("comm_id").notNull().references(() => comm.id, { onDelete: 'cascade' }),
  to: varchar("to"),
  body: text("body"),
  data: jsonb("data"),
});

export const insertCommSmsSchema = createInsertSchema(commSms).omit({
  id: true,
});

export type InsertCommSms = z.infer<typeof insertCommSmsSchema>;
export type CommSms = typeof commSms.$inferSelect;

// Communications - Email
export const commEmail = pgTable("comm_email", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  commId: varchar("comm_id").notNull().references(() => comm.id, { onDelete: 'cascade' }),
  to: text("to"),
  toName: varchar("to_name"),
  from: text("from_address"),
  fromName: varchar("from_name"),
  replyTo: text("reply_to"),
  subject: text("subject"),
  bodyText: text("body_text"),
  bodyHtml: text("body_html"),
  data: jsonb("data"),
});

export const insertCommEmailSchema = createInsertSchema(commEmail).omit({
  id: true,
});

export type InsertCommEmail = z.infer<typeof insertCommEmailSchema>;
export type CommEmail = typeof commEmail.$inferSelect;

// Communications - SMS Opt-in
export const commSmsOptin = pgTable("comm_sms_optin", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  phoneNumber: text("phone_number").notNull().unique(),
  optin: boolean("optin").default(false).notNull(),
  optinUser: varchar("optin_user").references(() => users.id, { onDelete: 'set null' }),
  optinDate: timestamp("optin_date"),
  optinIp: varchar("optin_ip"),
  allowlist: boolean("allowlist").default(false).notNull(),
  publicToken: varchar("public_token").unique(),
  smsPossible: boolean("sms_possible"),
  voicePossible: boolean("voice_possible"),
  validatedAt: timestamp("validated_at"),
  validationResponse: jsonb("validation_response"),
});

const ipAddressRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$|^(?:[a-fA-F0-9]{1,4}:){7}[a-fA-F0-9]{1,4}$/;

export const insertCommSmsOptinSchema = createInsertSchema(commSmsOptin, {
  phoneNumber: z.string().min(1, "Phone number is required"),
  optinIp: z.string().regex(ipAddressRegex, "Invalid IP address format").optional().nullable(),
}).omit({
  id: true,
});

export type InsertCommSmsOptin = z.infer<typeof insertCommSmsOptinSchema>;
export type CommSmsOptin = typeof commSmsOptin.$inferSelect;

// Communications - Email Opt-in
export const commEmailOptin = pgTable("comm_email_optin", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: text("email").notNull().unique(),
  optin: boolean("optin").default(false).notNull(),
  optinUser: varchar("optin_user").references(() => users.id, { onDelete: 'set null' }),
  optinDate: timestamp("optin_date"),
  optinIp: varchar("optin_ip"),
  allowlist: boolean("allowlist").default(false).notNull(),
  publicToken: varchar("public_token").unique(),
  emailValid: boolean("email_valid"),
  validatedAt: timestamp("validated_at"),
  validationResponse: jsonb("validation_response"),
});

export const insertCommEmailOptinSchema = createInsertSchema(commEmailOptin, {
  email: z.string().email("Invalid email address"),
  optinIp: z.string().regex(ipAddressRegex, "Invalid IP address format").optional().nullable(),
}).omit({
  id: true,
});

export type InsertCommEmailOptin = z.infer<typeof insertCommEmailOptinSchema>;
export type CommEmailOptin = typeof commEmailOptin.$inferSelect;

// Communications - Postal
export const commPostal = pgTable("comm_postal", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  commId: varchar("comm_id").notNull().references(() => comm.id, { onDelete: 'cascade' }),
  toName: varchar("to_name"),
  toCompany: varchar("to_company"),
  toAddressLine1: text("to_address_line1").notNull(),
  toAddressLine2: text("to_address_line2"),
  toCity: text("to_city").notNull(),
  toState: text("to_state").notNull(),
  toZip: text("to_zip").notNull(),
  toCountry: text("to_country").notNull().default('US'),
  fromName: varchar("from_name"),
  fromCompany: varchar("from_company"),
  fromAddressLine1: text("from_address_line1"),
  fromAddressLine2: text("from_address_line2"),
  fromCity: text("from_city"),
  fromState: text("from_state"),
  fromZip: text("from_zip"),
  fromCountry: text("from_country").default('US'),
  description: text("description"),
  body: text("body"),
  fileUrl: text("file_url"),
  templateId: varchar("template_id"),
  mergeVariables: jsonb("merge_variables"),
  color: boolean("color").default(false).notNull(),
  doubleSided: boolean("double_sided").default(false).notNull(),
  mailType: varchar("mail_type").default('usps_first_class').notNull(),
  extraService: varchar("extra_service"),
  lobLetterId: varchar("lob_letter_id"),
  lobTrackingEvents: jsonb("lob_tracking_events"),
  expectedDeliveryDate: timestamp("expected_delivery_date"),
  data: jsonb("data"),
});

export const insertCommPostalSchema = createInsertSchema(commPostal).omit({
  id: true,
});

export type InsertCommPostal = z.infer<typeof insertCommPostalSchema>;
export type CommPostal = typeof commPostal.$inferSelect;

// Communications - Postal Opt-in
export const commPostalOptin = pgTable("comm_postal_optin", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  canonicalAddress: text("canonical_address").notNull().unique(),
  addressLine1: text("address_line1").notNull(),
  addressLine2: text("address_line2"),
  city: text("city").notNull(),
  state: text("state").notNull(),
  zip: text("zip").notNull(),
  country: text("country").notNull().default('US'),
  optin: boolean("optin").default(false).notNull(),
  optinUser: varchar("optin_user").references(() => users.id, { onDelete: 'set null' }),
  optinDate: timestamp("optin_date"),
  optinIp: varchar("optin_ip"),
  allowlist: boolean("allowlist").default(false).notNull(),
  publicToken: varchar("public_token").unique(),
  deliverable: boolean("deliverable"),
  deliverabilityAnalysis: jsonb("deliverability_analysis"),
  validatedAt: timestamp("validated_at"),
  validationResponse: jsonb("validation_response"),
});

export const insertCommPostalOptinSchema = createInsertSchema(commPostalOptin, {
  canonicalAddress: z.string().min(1, "Canonical address is required"),
  addressLine1: z.string().min(1, "Address line 1 is required"),
  city: z.string().min(1, "City is required"),
  state: z.string().min(1, "State is required"),
  zip: z.string().min(1, "ZIP code is required"),
  country: z.string().min(1, "Country is required"),
  optinIp: z.string().regex(ipAddressRegex, "Invalid IP address format").optional().nullable(),
}).omit({
  id: true,
});

export type InsertCommPostalOptin = z.infer<typeof insertCommPostalOptinSchema>;
export type CommPostalOptin = typeof commPostalOptin.$inferSelect;

// Communications - In-App
export const commInapp = pgTable("comm_inapp", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  commId: varchar("comm_id").notNull().references(() => comm.id, { onDelete: 'cascade' }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  title: varchar("title", { length: 100 }).notNull(),
  body: varchar("body", { length: 500 }).notNull(),
  linkUrl: varchar("link_url", { length: 2048 }),
  linkLabel: varchar("link_label", { length: 50 }),
  status: varchar("status").notNull().default("pending"), // pending, read, expired
  createdAt: timestamp("created_at").default(sql`now()`).notNull(),
}, (table) => ({
  userIdIdx: index("comm_inapp_user_id_idx").on(table.userId),
  statusIdx: index("comm_inapp_status_idx").on(table.status),
  userStatusIdx: index("comm_inapp_user_status_idx").on(table.userId, table.status),
}));

export const insertCommInappSchema = createInsertSchema(commInapp, {
  title: z.string().min(1, "Title is required").max(100, "Title must be 100 characters or less"),
  body: z.string().min(1, "Body is required").max(500, "Body must be 500 characters or less"),
  linkUrl: z.string().max(2048, "Link URL must be 2048 characters or less").optional().nullable(),
  linkLabel: z.string().max(50, "Link label must be 50 characters or less").optional().nullable(),
  status: z.enum(["pending", "read", "expired"]).optional(),
}).omit({
  id: true,
  createdAt: true,
});

export type InsertCommInapp = z.infer<typeof insertCommInappSchema>;
export type CommInapp = typeof commInapp.$inferSelect;

// Communications - Tag Links (many-to-many between comm and options_comm_tags)
export const commTags = pgTable("comm_tags", {
  commId: varchar("comm_id").notNull().references(() => comm.id, { onDelete: 'cascade' }),
  commTagId: varchar("comm_tag_id").notNull().references(() => optionsCommTags.id, { onDelete: 'cascade' }),
}, (table) => ({
  pk: primaryKey({ columns: [table.commId, table.commTagId] }),
  commTagIdIdx: index("comm_tags_comm_tag_id_idx").on(table.commTagId),
}));

export const insertCommTagLinkSchema = createInsertSchema(commTags);

export type InsertCommTagLink = z.infer<typeof insertCommTagLinkSchema>;
export type CommTagLink = typeof commTags.$inferSelect;

// Flood control table for rate limiting
export const flood = pgTable("flood", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  event: varchar("event").notNull(),
  identifier: varchar("identifier").notNull(),
  createdAt: timestamp("created_at").default(sql`now()`).notNull(),
  expiresAt: timestamp("expires_at").notNull(),
}, (table) => ({
  eventIdentifierIdx: index("flood_event_identifier_idx").on(table.event, table.identifier),
  expiresAtIdx: index("flood_expires_at_idx").on(table.expiresAt),
}));

export const insertFloodSchema = createInsertSchema(flood).omit({
  id: true,
});

export type InsertFlood = z.infer<typeof insertFloodSchema>;
export type Flood = typeof flood.$inferSelect;

// Snapshots — generic point-in-time entity copies (self-contained JSON
// export bundles). Core table: entity types from any domain may participate.
export const snapshots = pgTable("snapshots", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  entityType: varchar("entity_type", { length: 100 }).notNull(),
  entityId: varchar("entity_id").notNull(),
  createdAt: timestamp("created_at").default(sql`now()`).notNull(),
  authorId: varchar("author_id").references(() => users.id, { onDelete: 'set null' }),
  authorName: text("author_name"),
  label: text("label"),
  data: jsonb("data").notNull(),
}, (table) => ({
  entityIdx: index("snapshots_entity_type_entity_id_created_at_idx").on(table.entityType, table.entityId, table.createdAt),
}));

export const insertSnapshotSchema = createInsertSchema(snapshots).omit({
  id: true,
  createdAt: true,
});

export type InsertSnapshot = z.infer<typeof insertSnapshotSchema>;
export type Snapshot = typeof snapshots.$inferSelect;
