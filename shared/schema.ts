import { sql } from "drizzle-orm";
import { pgTable, text, varchar, boolean, timestamp, date, primaryKey, jsonb, doublePrecision, integer, unique, serial, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

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
  replitUserId: varchar("replit_user_id").unique(),
  email: varchar("email").notNull().unique(),
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  profileImageUrl: varchar("profile_image_url"),
  accountStatus: varchar("account_status").default("pending").notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").default(sql`now()`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`now()`).notNull(),
  lastLogin: timestamp("last_login"),
});

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
  denormHomeEmployerId: varchar("denorm_home_employer_id").references(() => employers.id, { onDelete: 'set null' }),
  denormEmployerIds: varchar("denorm_employer_ids").array(),
});

export const employers = pgTable("employers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  siriusId: serial("sirius_id").notNull().unique(),
  name: text("name").notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  stripeCustomerId: text("stripe_customer_id"),
});

export const employerContacts = pgTable("employer_contacts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  employerId: varchar("employer_id").notNull().references(() => employers.id, { onDelete: 'cascade' }),
  contactId: varchar("contact_id").notNull().references(() => contacts.id, { onDelete: 'cascade' }),
  contactTypeId: varchar("contact_type_id").references(() => optionsEmployerContactType.id, { onDelete: 'set null' }),
});

export const workerHours = pgTable("worker_hours", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  year: integer("year").notNull(),
  month: integer("month").notNull(),
  day: integer("day").notNull(),
  workerId: varchar("worker_id").notNull().references(() => workers.id, { onDelete: 'cascade' }),
  employerId: varchar("employer_id").notNull().references(() => employers.id, { onDelete: 'cascade' }),
  employmentStatusId: varchar("employment_status_id").notNull().references(() => optionsEmploymentStatus.id, { onDelete: 'cascade' }),
  hours: doublePrecision("hours"),
  home: boolean("home").default(false).notNull(),
}, (table) => ({
  uniqueWorkerEmployerYearMonthDay: unique().on(table.workerId, table.employerId, table.year, table.month, table.day),
}));

export const trustBenefits = pgTable("trust_benefits", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
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
  uniqueWorkerEmployerBenefitMonthYear: unique().on(table.workerId, table.employerId, table.benefitId, table.month, table.year),
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
});

export const optionsWorkerIdType = pgTable("options_worker_id_type", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  sequence: integer("sequence").notNull().default(0),
  validator: text("validator"),
});

export const optionsTrustBenefitType = pgTable("options_trust_benefit_type", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  sequence: integer("sequence").notNull().default(0),
});

export const optionsLedgerPaymentType = pgTable("options_ledger_payment_type", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  description: text("description"),
  sequence: integer("sequence").notNull().default(0),
});

export const optionsEmployerContactType = pgTable("options_employer_contact_type", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  description: text("description"),
});

export const optionsWorkerWs = pgTable("options_worker_ws", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  description: text("description"),
  sequence: integer("sequence").notNull().default(0),
});

export const optionsEmploymentStatus = pgTable("options_employment_status", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  code: varchar("code").notNull(),
  employed: boolean("employed").default(false).notNull(),
  description: text("description"),
  sequence: integer("sequence").notNull().default(0),
});

export const workerIds = pgTable("worker_ids", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  workerId: varchar("worker_id").notNull().references(() => workers.id, { onDelete: 'cascade' }),
  typeId: varchar("type_id").notNull().references(() => optionsWorkerIdType.id, { onDelete: 'cascade' }),
  value: text("value").notNull(),
}, (table) => ({
  uniqueTypeValue: unique().on(table.typeId, table.value),
}));

export const postalAddresses = pgTable("postal_addresses", {
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
  validationResponse: jsonb("validation_response"),
  latitude: doublePrecision("latitude"),
  longitude: doublePrecision("longitude"),
  accuracy: text("accuracy"),
  createdAt: timestamp("created_at").default(sql`now()`).notNull(),
});

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

export const ledgerStripePaymentMethods = pgTable("ledger_stripe_paymentmethods", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  entityType: text("entity_type").notNull(),
  entityId: varchar("entity_id").notNull(),
  paymentMethod: text("payment_method").notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  isDefault: boolean("is_default").default(false).notNull(),
  createdAt: timestamp("created_at").default(sql`now()`).notNull(),
});

export const ledgerAccounts = pgTable("ledger_accounts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  description: text("description"),
  isActive: boolean("is_active").default(true).notNull(),
});

export const ledgerPayments = pgTable("ledger_payments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  status: text("status").notNull().$type<'draft' | 'canceled' | 'cleared' | 'error'>(),
  allocated: boolean("allocated").notNull().default(false),
  payerType: text("payer_type").notNull().$type<'worker' | 'employer'>(),
  payerId: varchar("payer_id").notNull(),
  account: varchar("account").notNull().references(() => ledgerAccounts.id),
  details: jsonb("details"),
});

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
});

export const insertEmployerSchema = createInsertSchema(employers).omit({
  id: true,
});

export const insertEmployerContactSchema = createInsertSchema(employerContacts).omit({
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

export const insertTrustBenefitSchema = createInsertSchema(trustBenefits).omit({
  id: true,
});

export const insertTrustWmbSchema = createInsertSchema(trustWmb).omit({
  id: true,
});

export const insertVariableSchema = createInsertSchema(variables).omit({
  id: true,
});

export const insertPostalAddressSchema = createInsertSchema(postalAddresses).omit({
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

export const insertLedgerStripePaymentMethodSchema = createInsertSchema(ledgerStripePaymentMethods).omit({
  id: true,
  createdAt: true,
});

export const insertLedgerAccountSchema = createInsertSchema(ledgerAccounts).omit({
  id: true,
});

export const insertLedgerPaymentSchema = createInsertSchema(ledgerPayments).omit({
  id: true,
});

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

export const insertTrustBenefitTypeSchema = createInsertSchema(optionsTrustBenefitType).omit({
  id: true,
});

export const insertLedgerPaymentTypeSchema = createInsertSchema(optionsLedgerPaymentType).omit({
  id: true,
});

export const insertEmployerContactTypeSchema = createInsertSchema(optionsEmployerContactType).omit({
  id: true,
});

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
});

export const updateEmploymentStatusSchema = z.object({
  name: z.string().trim().min(1, "Name is required").optional(),
  code: z.string().trim().min(1, "Code is required").optional(),
  employed: z.boolean().optional(),
  description: z.string().trim().nullable().or(z.literal("")).transform(val => val === "" ? null : val).optional(),
  sequence: z.number().optional(),
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
export type Worker = typeof workers.$inferSelect;

export type InsertEmployer = z.infer<typeof insertEmployerSchema>;
export type Employer = typeof employers.$inferSelect;

export type InsertEmployerContact = z.infer<typeof insertEmployerContactSchema>;
export type EmployerContact = typeof employerContacts.$inferSelect;

export type InsertWorkerHours = z.infer<typeof insertWorkerHoursSchema>;
export type WorkerHours = typeof workerHours.$inferSelect;

export type InsertTrustBenefit = z.infer<typeof insertTrustBenefitSchema>;
export type TrustBenefit = typeof trustBenefits.$inferSelect;

export type InsertTrustWmb = z.infer<typeof insertTrustWmbSchema>;
export type TrustWmb = typeof trustWmb.$inferSelect;

export type InsertVariable = z.infer<typeof insertVariableSchema>;
export type Variable = typeof variables.$inferSelect;

export type InsertPostalAddress = z.infer<typeof insertPostalAddressSchema>;
export type PostalAddress = typeof postalAddresses.$inferSelect;

export type InsertPhoneNumber = z.infer<typeof insertPhoneNumberSchema>;
export type PhoneNumber = typeof phoneNumbers.$inferSelect;

export type InsertBookmark = z.infer<typeof insertBookmarkSchema>;
export type Bookmark = typeof bookmarks.$inferSelect;

export type InsertLedgerStripePaymentMethod = z.infer<typeof insertLedgerStripePaymentMethodSchema>;
export type LedgerStripePaymentMethod = typeof ledgerStripePaymentMethods.$inferSelect;

export type InsertLedgerAccount = z.infer<typeof insertLedgerAccountSchema>;
export type LedgerAccount = typeof ledgerAccounts.$inferSelect;

export type InsertLedgerPayment = z.infer<typeof insertLedgerPaymentSchema>;
export type LedgerPayment = typeof ledgerPayments.$inferSelect;

export type InsertWizard = z.infer<typeof insertWizardSchema>;
export type Wizard = typeof wizards.$inferSelect;

export type InsertWizardFeedMapping = z.infer<typeof insertWizardFeedMappingSchema>;
export type WizardFeedMapping = typeof wizardFeedMappings.$inferSelect;

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

export type InsertFile = z.infer<typeof insertFileSchema>;
export type File = typeof files.$inferSelect;

export type InsertGenderOption = z.infer<typeof insertGenderOptionSchema>;
export type GenderOption = typeof optionsGender.$inferSelect;

export type InsertWorkerIdType = z.infer<typeof insertWorkerIdTypeSchema>;
export type WorkerIdType = typeof optionsWorkerIdType.$inferSelect;

export type InsertWorkerId = z.infer<typeof insertWorkerIdSchema>;
export type WorkerId = typeof workerIds.$inferSelect;

export type InsertTrustBenefitType = z.infer<typeof insertTrustBenefitTypeSchema>;
export type TrustBenefitType = typeof optionsTrustBenefitType.$inferSelect;

export type InsertLedgerPaymentType = z.infer<typeof insertLedgerPaymentTypeSchema>;
export type LedgerPaymentType = typeof optionsLedgerPaymentType.$inferSelect;

export type InsertEmployerContactType = z.infer<typeof insertEmployerContactTypeSchema>;
export type EmployerContactType = typeof optionsEmployerContactType.$inferSelect;

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
