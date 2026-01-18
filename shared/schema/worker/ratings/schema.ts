import { pgTable, varchar, jsonb, type AnyPgColumn } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const optionsWorkerRatings = pgTable("options_worker_ratings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name", { length: 255 }).notNull(),
  parent: varchar("parent").references((): AnyPgColumn => optionsWorkerRatings.id, { onDelete: 'set null' }),
  data: jsonb("data"),
});

export const insertOptionsWorkerRatingsSchema = createInsertSchema(optionsWorkerRatings).omit({
  id: true,
});

export type OptionsWorkerRating = typeof optionsWorkerRatings.$inferSelect;
export type InsertOptionsWorkerRating = z.infer<typeof insertOptionsWorkerRatingsSchema>;
