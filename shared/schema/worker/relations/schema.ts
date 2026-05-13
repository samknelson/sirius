import { pgTable, varchar, text, jsonb, unique } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const optionsWorkerRelationType = pgTable("options_worker_relation_type", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  siriusId: varchar("sirius_id", { length: 255 }),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  data: jsonb("data"),
}, (table) => ({
  siriusIdUnique: unique("options_worker_relation_type_sirius_id_unique").on(table.siriusId),
}));

export const insertOptionsWorkerRelationTypeSchema = createInsertSchema(optionsWorkerRelationType).omit({
  id: true,
});

export type OptionsWorkerRelationType = typeof optionsWorkerRelationType.$inferSelect;
export type InsertOptionsWorkerRelationType = z.infer<typeof insertOptionsWorkerRelationTypeSchema>;
