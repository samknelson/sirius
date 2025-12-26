import { pgTable, text, timestamp, varchar, jsonb, doublePrecision, pgEnum } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { workers, bargainingUnits, esigs } from "../../schema";

export const cardcheckDefinitions = pgTable("cardcheck_definitions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  siriusId: varchar("sirius_id").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  body: text("body"),
  data: jsonb("data"),
});

export const cardcheckStatusEnum = pgEnum("cardcheck_status", ["pending", "signed", "revoked"]);

export const cardchecks = pgTable("cardchecks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  workerId: varchar("worker_id").notNull().references(() => workers.id, { onDelete: 'cascade' }),
  cardcheckDefinitionId: varchar("cardcheck_definition_id").notNull().references(() => cardcheckDefinitions.id, { onDelete: 'restrict' }),
  status: cardcheckStatusEnum("status").notNull().default("pending"),
  signedDate: timestamp("signed_date"),
  rate: doublePrecision("rate"),
  data: jsonb("data"),
  esigId: varchar("esig_id").references(() => esigs.id, { onDelete: 'set null' }),
  bargainingUnitId: varchar("bargaining_unit_id").references(() => bargainingUnits.id, { onDelete: 'set null' }),
});

export const insertCardcheckDefinitionSchema = createInsertSchema(cardcheckDefinitions).omit({
  id: true,
});

export const insertCardcheckSchema = createInsertSchema(cardchecks).omit({
  id: true,
});

export type CardcheckDefinition = typeof cardcheckDefinitions.$inferSelect;
export type InsertCardcheckDefinition = z.infer<typeof insertCardcheckDefinitionSchema>;

export type Cardcheck = typeof cardchecks.$inferSelect;
export type InsertCardcheck = z.infer<typeof insertCardcheckSchema>;
