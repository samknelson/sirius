import { pgTable, varchar, jsonb, unique } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const optionsCertifications = pgTable("options_certifications", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name", { length: 255 }).notNull(),
  siriusId: varchar("sirius_id", { length: 100 }),
  data: jsonb("data"),
}, (table) => ({
  uniqueSiriusId: unique().on(table.siriusId),
}));

export const insertOptionsCertificationsSchema = createInsertSchema(optionsCertifications).omit({
  id: true,
});

export type OptionsCertification = typeof optionsCertifications.$inferSelect;
export type InsertOptionsCertification = z.infer<typeof insertOptionsCertificationsSchema>;
