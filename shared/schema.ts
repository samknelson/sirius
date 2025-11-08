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
});

export const employers = pgTable("employers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  siriusId: serial("sirius_id").notNull().unique(),
  name: text("name").notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  stripeCustomerId: text("stripe_customer_id"),
});

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
  description: text("description"),
}, (table) => [
  index("idx_winston_logs_entity_id").on(table.entityId),
  index("idx_winston_logs_module").on(table.module),
  index("idx_winston_logs_operation").on(table.operation),
]);

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

// Helper function to format SSN for display
export function formatSSN(ssn: string | null | undefined): string {
  if (!ssn) return '';
  // Remove any non-digit characters
  const digits = ssn.replace(/\D/g, '');
  // Format as XXX-XX-XXXX
  if (digits.length === 9) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;
  }
  return ssn; // Return as-is if not 9 digits
}

// Helper function to unformat SSN (remove dashes)
export function unformatSSN(ssn: string): string {
  return ssn.replace(/\D/g, '');
}

// Helper function to validate SSN against standard rules
export function validateSSN(ssn: string): { valid: boolean; error?: string } {
  // Remove any formatting
  const digits = ssn.replace(/\D/g, '');
  
  // Must be exactly 9 digits
  if (digits.length !== 9) {
    return { valid: false, error: "SSN must be exactly 9 digits" };
  }
  
  // Extract area, group, and serial numbers
  const area = parseInt(digits.slice(0, 3), 10);
  const group = parseInt(digits.slice(3, 5), 10);
  const serial = parseInt(digits.slice(5, 9), 10);
  
  // Area number cannot be 000
  if (area === 0) {
    return { valid: false, error: "SSN cannot begin with 000" };
  }
  
  // Area number cannot be 666
  if (area === 666) {
    return { valid: false, error: "SSN cannot begin with 666" };
  }
  
  // Area number cannot be between 900-999 (reserved)
  if (area >= 900) {
    return { valid: false, error: "SSN cannot begin with 900-999 (reserved)" };
  }
  
  // Group number cannot be 00
  if (group === 0) {
    return { valid: false, error: "SSN middle two digits cannot be 00" };
  }
  
  // Serial number cannot be 0000
  if (serial === 0) {
    return { valid: false, error: "SSN last four digits cannot be 0000" };
  }
  
  return { valid: true };
}
