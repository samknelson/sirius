import { pgTable, text, timestamp, varchar, jsonb, unique } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { workers, contacts, bargainingUnits, optionsEmploymentStatus, employers } from "../../../schema";

export const sitespecificBtuCsg = pgTable("sitespecific_btu_csg", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  workerId: varchar("worker_id").references(() => workers.id, { onDelete: 'set null' }),
  bpsId: text("bps_id"),
  firstName: text("first_name"),
  lastName: text("last_name"),
  phone: text("phone"),
  nonBpsEmail: text("non_bps_email"),
  school: text("school"),
  principalHeadmaster: text("principal_headmaster"),
  role: text("role"),
  typeOfClass: text("type_of_class"),
  course: text("course"),
  section: text("section"),
  numberOfStudents: text("number_of_students"),
  comments: text("comments"),
  status: text("status").default("pending").notNull(),
  adminNotes: text("admin_notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertBtuCsgSchema = createInsertSchema(sitespecificBtuCsg).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type BtuCsgRecord = typeof sitespecificBtuCsg.$inferSelect;
export type InsertBtuCsgRecord = z.infer<typeof insertBtuCsgSchema>;

export const btuTerritories = pgTable("btu_territories", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  siriusId: varchar("sirius_id").unique().notNull(),
  name: text("name").notNull(),
  data: jsonb("data"),
});

export const insertBtuTerritorySchema = createInsertSchema(btuTerritories).omit({
  id: true,
});

export type BtuTerritory = typeof btuTerritories.$inferSelect;
export type InsertBtuTerritory = z.infer<typeof insertBtuTerritorySchema>;

export const sitespecificBtuEmployerMap = pgTable("sitespecific_btu_employer_map", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  departmentId: varchar("department_id"),
  departmentTitle: varchar("department_title"),
  locationId: varchar("location_id"),
  locationTitle: varchar("location_title"),
  jobCode: varchar("job_code"),
  jobTitle: varchar("job_title"),
  employerName: varchar("employer_name"),
  secondaryEmployerName: varchar("secondary_employer_name"),
  bargainingUnitId: varchar("bargaining_unit_id").references(() => bargainingUnits.id, { onDelete: 'set null' }),
  employmentStatusId: varchar("employment_status_id").references(() => optionsEmploymentStatus.id, { onDelete: 'set null' }),
  territoryId: varchar("territory_id").references(() => btuTerritories.id, { onDelete: 'set null' }),
});

export const insertBtuEmployerMapSchema = createInsertSchema(sitespecificBtuEmployerMap).omit({
  id: true,
});

export type BtuEmployerMap = typeof sitespecificBtuEmployerMap.$inferSelect;
export type InsertBtuEmployerMap = z.infer<typeof insertBtuEmployerMapSchema>;

export const btuTerritoryReps = pgTable("btu_territory_reps", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  territoryId: varchar("territory_id").notNull().references(() => btuTerritories.id, { onDelete: 'cascade' }),
  contactId: varchar("contact_id").notNull().references(() => contacts.id, { onDelete: 'cascade' }),
  data: jsonb("data"),
}, (table) => [
  unique("btu_territory_reps_territory_contact_unique").on(table.territoryId, table.contactId),
]);

export const insertBtuTerritoryRepSchema = createInsertSchema(btuTerritoryReps).omit({
  id: true,
});

export type BtuTerritoryRep = typeof btuTerritoryReps.$inferSelect;
export type InsertBtuTerritoryRep = z.infer<typeof insertBtuTerritoryRepSchema>;

export const btuTerritoryWorkers = pgTable("btu_territory_workers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  territoryId: varchar("territory_id").notNull().references(() => btuTerritories.id, { onDelete: 'cascade' }),
  workerId: varchar("worker_id").notNull().unique().references(() => workers.id, { onDelete: 'cascade' }),
});

export const insertBtuTerritoryWorkerSchema = createInsertSchema(btuTerritoryWorkers).omit({
  id: true,
});

export type BtuTerritoryWorker = typeof btuTerritoryWorkers.$inferSelect;
export type InsertBtuTerritoryWorker = z.infer<typeof insertBtuTerritoryWorkerSchema>;

// BTU School Types - reference table for school type options
export const sitespecificBtuSchoolTypes = pgTable("sitespecific_btu_school_types", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  siriusId: varchar("sirius_id").unique().notNull(),
  name: text("name").notNull(),
});

export const insertBtuSchoolTypeSchema = createInsertSchema(sitespecificBtuSchoolTypes).omit({
  id: true,
});

export type BtuSchoolType = typeof sitespecificBtuSchoolTypes.$inferSelect;
export type InsertBtuSchoolType = z.infer<typeof insertBtuSchoolTypeSchema>;

// BTU Regions - reference table with SS/AS/OL contact references
export const sitespecificBtuRegions = pgTable("sitespecific_btu_regions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  siriusId: varchar("sirius_id").unique().notNull(),
  name: text("name").notNull(),
  ssContactId: varchar("ss_contact_id").references(() => contacts.id, { onDelete: 'set null' }),
  asContactId: varchar("as_contact_id").references(() => contacts.id, { onDelete: 'set null' }),
  olContactId: varchar("ol_contact_id").references(() => contacts.id, { onDelete: 'set null' }),
});

export const insertBtuRegionSchema = createInsertSchema(sitespecificBtuRegions).omit({
  id: true,
});

export type BtuRegion = typeof sitespecificBtuRegions.$inferSelect;
export type InsertBtuRegion = z.infer<typeof insertBtuRegionSchema>;

// BTU School Attributes - main table linking employer to school types, schedules, and region
// schedules is a JSON array of { label: string, startTime: string, endTime: string }
export const sitespecificBtuSchoolAttributes = pgTable("sitespecific_btu_school_attributes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  siriusId: varchar("sirius_id").unique().notNull(),
  employerId: varchar("employer_id").notNull().references(() => employers.id, { onDelete: 'cascade' }),
  schoolTypeIds: text("school_type_ids").array(),
  schedules: jsonb("schedules"),
  regionId: varchar("region_id").references(() => sitespecificBtuRegions.id, { onDelete: 'set null' }),
});

// Zod schema for schedule items
export const btuScheduleItemSchema = z.object({
  label: z.string(),
  startTime: z.string(),
  endTime: z.string(),
});

export type BtuScheduleItem = z.infer<typeof btuScheduleItemSchema>;

export const insertBtuSchoolAttributesSchema = createInsertSchema(sitespecificBtuSchoolAttributes).omit({
  id: true,
}).extend({
  schoolTypeIds: z.array(z.string()).nullable().optional(),
  schedules: z.array(btuScheduleItemSchema).nullable().optional(),
  regionId: z.string().nullable().optional(),
});

export type BtuSchoolAttributes = typeof sitespecificBtuSchoolAttributes.$inferSelect;
export type InsertBtuSchoolAttributes = z.infer<typeof insertBtuSchoolAttributesSchema>;
