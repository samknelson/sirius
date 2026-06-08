import { pgTable, text, varchar, jsonb } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const sitespecificFreemanCrewleads = pgTable("sitespecific_freeman_crewleads", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  siriusId: varchar("sirius_id").unique().notNull(),
  name: text("name").notNull(),
  data: jsonb("data"),
});

export const insertFreemanCrewleadSchema = createInsertSchema(sitespecificFreemanCrewleads).omit({
  id: true,
});

export type FreemanCrewlead = typeof sitespecificFreemanCrewleads.$inferSelect;
export type InsertFreemanCrewlead = z.infer<typeof insertFreemanCrewleadSchema>;
