import { pgTable, text, varchar, jsonb } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { contacts } from "../../schema";

export const facilities = pgTable("facilities", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  siriusId: text("sirius_id").unique(),
  contactId: varchar("contact_id").notNull().references(() => contacts.id, { onDelete: "restrict" }),
  data: jsonb("data"),
});

export const insertFacilitySchema = createInsertSchema(facilities).omit({
  id: true,
}).extend({
  siriusId: z.string().nullish(),
  data: z.any().nullish(),
});

export type InsertFacility = z.infer<typeof insertFacilitySchema>;
export type Facility = typeof facilities.$inferSelect;
