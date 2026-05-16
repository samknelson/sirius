import { pgTable, varchar, text, jsonb, date, unique } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { workers } from "../../../schema";

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

export const workerRelations = pgTable("worker_relations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  worker1: varchar("worker_1").notNull().references(() => workers.id, { onDelete: 'cascade' }),
  worker2: varchar("worker_2").notNull().references(() => workers.id, { onDelete: 'cascade' }),
  relationType: varchar("relation_type").notNull().references(() => optionsWorkerRelationType.id),
  startYmd: date("start_ymd"),
  endYmd: date("end_ymd"),
  data: jsonb("data"),
});

export const insertWorkerRelationSchema = createInsertSchema(workerRelations).omit({
  id: true,
});

export type WorkerRelation = typeof workerRelations.$inferSelect;
export type InsertWorkerRelation = z.infer<typeof insertWorkerRelationSchema>;
