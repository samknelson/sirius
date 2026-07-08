import { foreignKey, pgTable, varchar, text, jsonb, boolean, integer, date, timestamp, uniqueIndex, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { workers, employers, users, denorm, bargainingUnits, contacts } from "../../schema";

export const optionsGrievanceStatus = pgTable("options_grievance_status", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name", { length: 255 }).notNull().unique(),
  description: text("description"),
  siriusId: varchar("sirius_id").unique(),
  open: boolean("open").default(true).notNull(),
  sequence: integer("sequence").notNull().default(0),
  data: jsonb("data"),
});

export const insertOptionsGrievanceStatusSchema = createInsertSchema(
  optionsGrievanceStatus,
).omit({
  id: true,
});

export type OptionsGrievanceStatus = typeof optionsGrievanceStatus.$inferSelect;
export type InsertOptionsGrievanceStatus = z.infer<
  typeof insertOptionsGrievanceStatusSchema
>;

export const optionsGrievanceCategory = pgTable("options_grievance_category", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name", { length: 255 }).notNull().unique(),
  description: text("description"),
  data: jsonb("data"),
});

export const insertOptionsGrievanceCategorySchema = createInsertSchema(
  optionsGrievanceCategory,
).omit({
  id: true,
});

export type OptionsGrievanceCategory = typeof optionsGrievanceCategory.$inferSelect;
export type InsertOptionsGrievanceCategory = z.infer<
  typeof insertOptionsGrievanceCategorySchema
>;

export const optionsGrievanceSteps = pgTable("options_grievance_steps", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  // Explicit "_key" constraint names on this table (and complaints/remedies/
  // roles below), on purpose: these tables were originally created via raw
  // SQL, so the live DB carries Postgres-default "<table>_<col>_key" names
  // instead of drizzle's "<table>_<col>_unique". drizzle-kit push compares by
  // name and false-positives an "add constraint" on every db-push preview run
  // unless the declared names match the DB.
  name: varchar("name", { length: 255 }).notNull().unique("options_grievance_steps_name_key"),
  description: text("description"),
  siriusId: varchar("sirius_id").unique("options_grievance_steps_sirius_id_key"),
  sequence: integer("sequence").notNull().default(0),
  actor: varchar("actor").notNull(),
  data: jsonb("data"),
});

export const insertOptionsGrievanceStepsSchema = createInsertSchema(
  optionsGrievanceSteps,
).omit({
  id: true,
});

export type OptionsGrievanceStep = typeof optionsGrievanceSteps.$inferSelect;
export type InsertOptionsGrievanceStep = z.infer<
  typeof insertOptionsGrievanceStepsSchema
>;

export const optionsGrievanceComplaints = pgTable("options_grievance_complaints", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  // Explicit "_key" names — see optionsGrievanceSteps comment above.
  name: varchar("name", { length: 255 }).notNull().unique("options_grievance_complaints_name_key"),
  description: text("description"),
  siriusId: varchar("sirius_id").unique("options_grievance_complaints_sirius_id_key"),
  sequence: integer("sequence").notNull().default(0),
  data: jsonb("data"),
});

export const insertOptionsGrievanceComplaintSchema = createInsertSchema(
  optionsGrievanceComplaints,
).omit({
  id: true,
});

export type OptionsGrievanceComplaint = typeof optionsGrievanceComplaints.$inferSelect;
export type InsertOptionsGrievanceComplaint = z.infer<
  typeof insertOptionsGrievanceComplaintSchema
>;

export const optionsGrievanceRemedies = pgTable("options_grievance_remedies", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  // Explicit "_key" names — see optionsGrievanceSteps comment above.
  name: varchar("name", { length: 255 }).notNull().unique("options_grievance_remedies_name_key"),
  description: text("description"),
  siriusId: varchar("sirius_id").unique("options_grievance_remedies_sirius_id_key"),
  sequence: integer("sequence").notNull().default(0),
  data: jsonb("data"),
});

export const insertOptionsGrievanceRemedySchema = createInsertSchema(
  optionsGrievanceRemedies,
).omit({
  id: true,
});

export type OptionsGrievanceRemedy = typeof optionsGrievanceRemedies.$inferSelect;
export type InsertOptionsGrievanceRemedy = z.infer<
  typeof insertOptionsGrievanceRemedySchema
>;

export const optionsGrievanceRoles = pgTable("options_grievance_roles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  // Explicit "_key" names — see optionsGrievanceSteps comment above.
  name: varchar("name", { length: 255 }).notNull().unique("options_grievance_roles_name_key"),
  description: text("description"),
  siriusId: varchar("sirius_id").unique("options_grievance_roles_sirius_id_key"),
  sequence: integer("sequence").notNull().default(0),
  data: jsonb("data"),
});

export const insertOptionsGrievanceRoleSchema = createInsertSchema(
  optionsGrievanceRoles,
).omit({
  id: true,
});

export type OptionsGrievanceRole = typeof optionsGrievanceRoles.$inferSelect;
export type InsertOptionsGrievanceRole = z.infer<
  typeof insertOptionsGrievanceRoleSchema
>;

export const GRIEVANCE_CARDINALITIES = [
  "individual",
  "multiple",
  "multiple-with-lead",
  "class",
] as const;

export type GrievanceCardinality = (typeof GRIEVANCE_CARDINALITIES)[number];

export const grievances = pgTable("grievances", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  siriusId: varchar("sirius_id").notNull().unique(),
  classDescription: text("class_description"),
  cardinality: varchar("cardinality").notNull().default("individual"),
  categoryId: varchar("category_id")
    .notNull()
    .references(() => optionsGrievanceCategory.id, { onDelete: "restrict" }),
  data: jsonb("data"),
  timelineTemplateId: varchar("timeline_template_id"),
  bargainingUnitId: varchar("bargaining_unit_id").references(
    () => bargainingUnits.id,
    { onDelete: "set null" },
  ),
  employerContactId: varchar("employer_contact_id").references(
    () => contacts.id,
    { onDelete: "set null" },
  ),
}, (table) => [
  foreignKey({
    name: "grievances_timeline_template_id_grievance_timeline_templates_id",
    columns: [table.timelineTemplateId],
    foreignColumns: [grievanceTimelineTemplates.id],
  }).onDelete("set null"),
]);

export const insertGrievanceSchema = createInsertSchema(grievances)
  .omit({
    id: true,
  })
  // The DB column is NOT NULL, but the app never requires the caller to supply
  // an ID: the storage layer auto-generates one on create when it is absent or
  // empty. Keep siriusId optional/nullable here so that flow still type-checks.
  .extend({
    siriusId: z.string().trim().min(1).nullish(),
  });

export type Grievance = typeof grievances.$inferSelect;
export type InsertGrievance = z.infer<typeof insertGrievanceSchema>;

/**
 * Per-grievance status history. The grievance's "current" status is derived:
 * the entry with the latest `date` is current. `is_current` is recomputed
 * transactionally by the storage layer on every add/edit/delete; the partial
 * unique index guarantees at most one current row per grievance, and the
 * unique (grievance_id, date) pair forbids two entries at the same instant.
 * A grievance may have zero history entries (status shows blank).
 */
export const grievanceStatusHistory = pgTable(
  "grievance_status_history",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    grievanceId: varchar("grievance_id")
      .notNull()
      .references(() => grievances.id, { onDelete: "cascade" }),
    statusId: varchar("status_id")
      .notNull(),
    date: timestamp("date").notNull(),
    isCurrent: boolean("is_current").notNull().default(false),
    data: jsonb("data"),
  },
  (table) => ({
    oneCurrentPerGrievance: uniqueIndex(
      "grievance_status_history_one_current_per_grievance",
    )
      .on(table.grievanceId)
      .where(sql`${table.isCurrent} = true`),
    grievanceDateUnique: uniqueIndex(
      "grievance_status_history_grievance_date_unique",
    ).on(table.grievanceId, table.date),
    dateNotInFuture: check(
      "grievance_status_history_date_not_future",
      sql`${table.date} <= now()`,
    ),
    fkStatusId: foreignKey({
    name: "grievance_status_history_status_id_options_grievance_status_id_",
    columns: [table.statusId],
    foreignColumns: [optionsGrievanceStatus.id],
  }).onDelete("restrict"),
}),
);

export const insertGrievanceStatusHistorySchema = createInsertSchema(
  grievanceStatusHistory,
).omit({
  id: true,
  isCurrent: true,
});

export type GrievanceStatusHistory = typeof grievanceStatusHistory.$inferSelect;
export type InsertGrievanceStatusHistory = z.infer<
  typeof insertGrievanceStatusHistorySchema
>;

/**
 * Timeline adjustment attached to a status history entry, stored under the
 * `timelineAdjustment` key of the entry's `data` jsonb. Applied by the
 * `grievance_timeline` denorm plugin to the due date of the step this entry
 * STARTS:
 *  - `relative` shifts the computed due date by +/- days, following the
 *    step's dayType (business steps add/subtract business days);
 *  - `explicit` replaces the computed due date outright with a Ymd date.
 */
export const grievanceTimelineAdjustmentSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("relative"),
    days: z
      .number()
      .int("Days must be a whole number")
      .refine((d) => d !== 0, "Days cannot be zero"),
    note: z.string().max(500).optional(),
  }),
  z.object({
    kind: z.literal("explicit"),
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format"),
    note: z.string().max(500).optional(),
  }),
]);

export type GrievanceTimelineAdjustment = z.infer<
  typeof grievanceTimelineAdjustmentSchema
>;

/** The `data` jsonb key the adjustment lives under on a status history entry. */
export const TIMELINE_ADJUSTMENT_DATA_KEY = "timelineAdjustment";

/** Read (and validate) an entry's timeline adjustment from its `data` jsonb. */
export function readTimelineAdjustment(
  data: unknown,
): GrievanceTimelineAdjustment | null {
  if (!data || typeof data !== "object") return null;
  const raw = (data as Record<string, unknown>)[TIMELINE_ADJUSTMENT_DATA_KEY];
  if (raw === undefined || raw === null) return null;
  const parsed = grievanceTimelineAdjustmentSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export const grievanceWorkers = pgTable(
  "grievance_workers",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    workerId: varchar("worker_id")
      .notNull()
      .references(() => workers.id, { onDelete: "restrict" }),
    grievanceId: varchar("grievance_id")
      .notNull()
      .references(() => grievances.id, { onDelete: "restrict" }),
    primary: boolean("primary").notNull().default(true),
    data: jsonb("data"),
  },
  (table) => ({
    workerGrievanceUnique: uniqueIndex("grievance_workers_worker_grievance_unique").on(
      table.workerId,
      table.grievanceId,
    ),
    onePrimaryPerGrievance: uniqueIndex("grievance_workers_one_primary_per_grievance")
      .on(table.grievanceId)
      // `primary` is a reserved word; Postgres reflects the partial-index
      // predicate with the identifier quoted (`"primary" = true`). The drift
      // gate compares predicate strings without stripping per-identifier
      // quotes, so the declared predicate must carry the quotes literally
      // rather than interpolating `${table.primary}` (which renders unquoted).
      .where(sql`"primary" = true`),
  }),
);

export const insertGrievanceWorkerSchema = createInsertSchema(grievanceWorkers).omit({
  id: true,
});

export type GrievanceWorker = typeof grievanceWorkers.$inferSelect;
export type InsertGrievanceWorker = z.infer<typeof insertGrievanceWorkerSchema>;

export const grievanceEmployers = pgTable(
  "grievance_employers",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    employerId: varchar("employer_id")
      .notNull()
      .references(() => employers.id, { onDelete: "restrict" }),
    grievanceId: varchar("grievance_id")
      .notNull()
      .references(() => grievances.id, { onDelete: "restrict" }),
    data: jsonb("data"),
  },
  (table) => ({
    employerGrievanceUnique: uniqueIndex("grievance_employers_employer_grievance_unique").on(
      table.employerId,
      table.grievanceId,
    ),
  }),
);

export const insertGrievanceEmployerSchema = createInsertSchema(grievanceEmployers).omit({
  id: true,
});

export type GrievanceEmployer = typeof grievanceEmployers.$inferSelect;
export type InsertGrievanceEmployer = z.infer<typeof insertGrievanceEmployerSchema>;

export const grievanceUsers = pgTable(
  "grievance_users",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    grievanceId: varchar("grievance_id")
      .notNull()
      .references(() => grievances.id, { onDelete: "cascade" }),
    userId: varchar("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    roleId: varchar("role_id")
      .notNull()
      .references(() => optionsGrievanceRoles.id, { onDelete: "restrict" }),
    data: jsonb("data"),
  },
  (table) => ({
    grievanceUserRoleUnique: uniqueIndex("grievance_users_grievance_user_role_unique").on(
      table.grievanceId,
      table.userId,
      table.roleId,
    ),
  }),
);

export const insertGrievanceUserSchema = createInsertSchema(grievanceUsers).omit({
  id: true,
});

export type GrievanceUser = typeof grievanceUsers.$inferSelect;
export type InsertGrievanceUser = z.infer<typeof insertGrievanceUserSchema>;

export const grievanceComplaints = pgTable("grievance_complaints", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  grievanceId: varchar("grievance_id")
    .notNull()
    .references(() => grievances.id, { onDelete: "cascade" }),
  complaintId: varchar("complaint_id"),
  description: text("description").notNull(),
  sequence: integer("sequence").notNull().default(0),
}, (table) => [
  foreignKey({
    name: "grievance_complaints_complaint_id_options_grievance_complaints_",
    columns: [table.complaintId],
    foreignColumns: [optionsGrievanceComplaints.id],
  }).onDelete("set null"),
]);

export const insertGrievanceComplaintSchema = createInsertSchema(
  grievanceComplaints,
).omit({
  id: true,
});

export type GrievanceComplaint = typeof grievanceComplaints.$inferSelect;
export type InsertGrievanceComplaint = z.infer<
  typeof insertGrievanceComplaintSchema
>;

export const grievanceRemedies = pgTable("grievance_remedies", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  grievanceId: varchar("grievance_id")
    .notNull()
    .references(() => grievances.id, { onDelete: "cascade" }),
  remedyId: varchar("remedy_id").references(
    () => optionsGrievanceRemedies.id,
    { onDelete: "set null" },
  ),
  description: text("description").notNull(),
  sequence: integer("sequence").notNull().default(0),
});

export const insertGrievanceRemedySchema = createInsertSchema(
  grievanceRemedies,
).omit({
  id: true,
});

export type GrievanceRemedy = typeof grievanceRemedies.$inferSelect;
export type InsertGrievanceRemedy = z.infer<
  typeof insertGrievanceRemedySchema
>;

// Per-grievance computed timeline steps (payload table for the
// `grievance_timeline` denorm plugin). Rows are derived from the grievance's
// timeline template + status history; NO route may write this table — the
// plugin is its sole maintainer. `denorm_id` ties rows back to the grievance's
// workflow status row in the core `denorm` table.
export const grievanceStepsDenorm = pgTable(
  "grievance_steps_denorm",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    denormId: varchar("denorm_id")
      .notNull()
      .references(() => denorm.id, { onDelete: "cascade" }),
    grievanceId: varchar("grievance_id")
      .notNull()
      .references(() => grievances.id, { onDelete: "cascade" }),
    stepId: varchar("step_id")
      .notNull()
      .references(() => optionsGrievanceSteps.id, { onDelete: "cascade" }),
    startedYmd: date("started_ymd"),
    dueYmd: date("due_ymd"),
    completedYmd: date("completed_ymd"),
    isCurrent: boolean("is_current").notNull().default(false),
    data: jsonb("data"),
  },
  (table) => ({
    // At most one current step per grievance. `is_current` is not a reserved
    // word, so Postgres reflects the partial-index predicate unquoted; the
    // drift gate compares predicate strings literally, so the declared
    // predicate must read `is_current = true` to match what is reflected.
    oneCurrentPerGrievance: uniqueIndex("grievance_steps_denorm_one_current_per_grievance")
      .on(table.grievanceId)
      .where(sql`is_current = true`),
  }),
);

export const insertGrievanceStepsDenormSchema = createInsertSchema(grievanceStepsDenorm).omit({
  id: true,
});

export type GrievanceStepsDenorm = typeof grievanceStepsDenorm.$inferSelect;
export type InsertGrievanceStepsDenorm = z.infer<typeof insertGrievanceStepsDenormSchema>;

export const GRIEVANCE_TIMELINE_DAY_TYPES = ["calendar", "business"] as const;

export type GrievanceTimelineDayType =
  (typeof GRIEVANCE_TIMELINE_DAY_TYPES)[number];

export const grievanceTimelineTemplates = pgTable("grievance_timeline_templates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description"),
  data: jsonb("data"),
});

export const insertGrievanceTimelineTemplateSchema = createInsertSchema(
  grievanceTimelineTemplates,
).omit({
  id: true,
});

export type GrievanceTimelineTemplate =
  typeof grievanceTimelineTemplates.$inferSelect;
export type InsertGrievanceTimelineTemplate = z.infer<
  typeof insertGrievanceTimelineTemplateSchema
>;

export const grievanceTimelineTemplateSteps = pgTable(
  "grievance_timeline_template_steps",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    templateId: varchar("template_id")
      .notNull(),
    fromStatuses: varchar("from_statuses").array().notNull(),
    toStatuses: varchar("to_statuses").array().notNull(),
    stepId: varchar("step_id")
      .notNull(),
    days: integer("days").notNull(),
    dayType: varchar("day_type").notNull(),
    sequence: integer("sequence").notNull().default(0),
  }, (table) => [
  foreignKey({
    name: "grievance_timeline_template_steps_template_id_grievance_timelin",
    columns: [table.templateId],
    foreignColumns: [grievanceTimelineTemplates.id],
  }).onDelete("cascade"),
  foreignKey({
    name: "grievance_timeline_template_steps_step_id_options_grievance_ste",
    columns: [table.stepId],
    foreignColumns: [optionsGrievanceSteps.id],
  }).onDelete("restrict"),
],
);

export const insertGrievanceTimelineTemplateStepSchema = createInsertSchema(
  grievanceTimelineTemplateSteps,
).omit({
  id: true,
});

export type GrievanceTimelineTemplateStep =
  typeof grievanceTimelineTemplateSteps.$inferSelect;
export type InsertGrievanceTimelineTemplateStep = z.infer<
  typeof insertGrievanceTimelineTemplateStepSchema
>;

// Per-grievance denormalized display name (payload table for the
// `grievance_name_denorm` denorm plugin). A grievance has exactly ONE computed
// name, so `grievance_id` is UNIQUE and the table holds 0-or-1 row per
// grievance. `denorm_id` ties the row back to its workflow status row in the
// core `denorm` table.
export const grievanceNameDenorm = pgTable("grievance_name_denorm", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  denormId: varchar("denorm_id")
    .notNull()
    .references(() => denorm.id, { onDelete: "cascade" }),
  grievanceId: varchar("grievance_id")
    .notNull()
    .references(() => grievances.id, { onDelete: "cascade" }),
  name: varchar("name"),
}, (table) => [
  uniqueIndex("grievance_name_denorm_grievance_uniq").on(table.grievanceId),
  uniqueIndex("grievance_name_denorm_denorm_uniq").on(table.denormId),
]);

export const insertGrievanceNameDenormSchema = createInsertSchema(
  grievanceNameDenorm,
).omit({
  id: true,
});
export type GrievanceNameDenorm = typeof grievanceNameDenorm.$inferSelect;
export type InsertGrievanceNameDenorm = z.infer<
  typeof insertGrievanceNameDenormSchema
>;
