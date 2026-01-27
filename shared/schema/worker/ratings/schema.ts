import { pgTable, varchar, jsonb, integer, unique, type AnyPgColumn } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { workers } from "../../../schema";

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

export const workerRatings = pgTable("worker_ratings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  workerId: varchar("worker_id").notNull().references(() => workers.id, { onDelete: 'cascade' }),
  ratingId: varchar("rating_id").notNull().references(() => optionsWorkerRatings.id, { onDelete: 'cascade' }),
  value: integer("value").notNull(),
}, (table) => ({
  workerRatingUnique: unique("worker_rating_unique").on(table.workerId, table.ratingId),
}));

export const insertWorkerRatingsSchema = createInsertSchema(workerRatings).omit({
  id: true,
});

export type WorkerRating = typeof workerRatings.$inferSelect;
export type InsertWorkerRating = z.infer<typeof insertWorkerRatingsSchema>;
