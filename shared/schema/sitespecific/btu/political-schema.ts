import { pgTable, text, timestamp, varchar, jsonb, unique } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { workers } from "../../../schema";

export const sitespecificBtuPoliticalOfficials = pgTable("sitespecific_btu_political_officials", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  officeName: text("office_name").notNull(),
  level: text("level").notNull(),
  division: text("division"),
  party: text("party"),
  phones: text("phones").array(),
  emails: text("emails").array(),
  photoUrl: text("photo_url"),
  urls: text("urls").array(),
  channels: jsonb("channels"),
  ocdDivisionId: text("ocd_division_id"),
  data: jsonb("data"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  unique("btu_political_officials_name_office_division_unique").on(table.name, table.officeName, table.ocdDivisionId),
]);

export const insertBtuPoliticalOfficialSchema = createInsertSchema(sitespecificBtuPoliticalOfficials).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type BtuPoliticalOfficial = typeof sitespecificBtuPoliticalOfficials.$inferSelect;
export type InsertBtuPoliticalOfficial = z.infer<typeof insertBtuPoliticalOfficialSchema>;

export const sitespecificBtuPoliticalWorkerReps = pgTable("sitespecific_btu_political_worker_reps", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  workerId: varchar("worker_id").notNull().references(() => workers.id, { onDelete: 'cascade' }),
  officialId: varchar("official_id").notNull().references(() => sitespecificBtuPoliticalOfficials.id, { onDelete: 'cascade' }),
  address: text("address"),
  lastLookedUpAt: timestamp("last_looked_up_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  unique("btu_political_worker_reps_worker_official_unique").on(table.workerId, table.officialId),
]);

export const insertBtuPoliticalWorkerRepSchema = createInsertSchema(sitespecificBtuPoliticalWorkerReps).omit({
  id: true,
  createdAt: true,
});

export type BtuPoliticalWorkerRep = typeof sitespecificBtuPoliticalWorkerReps.$inferSelect;
export type InsertBtuPoliticalWorkerRep = z.infer<typeof insertBtuPoliticalWorkerRepSchema>;

export const sitespecificBtuPoliticalDistrictCache = pgTable("sitespecific_btu_political_district_cache", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  districtKey: text("district_key").notNull().unique("btu_political_district_cache_key_unique"),
  state: text("state").notNull(),
  cd: text("cd"),
  sldu: text("sldu"),
  sldl: text("sldl"),
  officialIds: text("official_ids").array().notNull(),
  lookedUpAt: timestamp("looked_up_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertBtuPoliticalDistrictCacheSchema = createInsertSchema(sitespecificBtuPoliticalDistrictCache).omit({
  id: true,
  createdAt: true,
});

export type BtuPoliticalDistrictCache = typeof sitespecificBtuPoliticalDistrictCache.$inferSelect;
export type InsertBtuPoliticalDistrictCache = z.infer<typeof insertBtuPoliticalDistrictCacheSchema>;
