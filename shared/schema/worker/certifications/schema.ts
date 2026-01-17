import { pgTable, varchar, jsonb, unique, date, pgEnum, boolean } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { workers } from "../../../schema";

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

export const workerCertificationStatusEnum = pgEnum("worker_certification_status", [
  "pending",
  "granted",
  "revoked",
  "expired",
]);

export const workerCertifications = pgTable("worker_certifications", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  workerId: varchar("worker_id").notNull().references(() => workers.id, { onDelete: 'cascade' }),
  certificationId: varchar("certification_id").notNull().references(() => optionsCertifications.id, { onDelete: 'cascade' }),
  startDate: date("start_date"),
  endDate: date("end_date"),
  status: workerCertificationStatusEnum("status").notNull().default("pending"),
  active: boolean("active").notNull().default(false),
  data: jsonb("data"),
});

export const insertWorkerCertificationSchema = createInsertSchema(workerCertifications).omit({
  id: true,
  active: true,
});

export type WorkerCertification = typeof workerCertifications.$inferSelect;
export type InsertWorkerCertification = z.infer<typeof insertWorkerCertificationSchema>;
