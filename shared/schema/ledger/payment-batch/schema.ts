import { pgTable, varchar, text, jsonb } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { ledgerAccounts, ledgerPayments } from "../../../schema";

export const ledgerPaymentBatches = pgTable("ledger_payment_batches", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  accountId: varchar("account_id").notNull().references(() => ledgerAccounts.id, { onDelete: "restrict" }),
  data: jsonb("data"),
});

export const insertLedgerPaymentBatchSchema = createInsertSchema(ledgerPaymentBatches).omit({
  id: true,
});

export type LedgerPaymentBatch = typeof ledgerPaymentBatches.$inferSelect;
export type InsertLedgerPaymentBatch = z.infer<typeof insertLedgerPaymentBatchSchema>;

export const ledgerPaymentBatchAssignments = pgTable("ledger_payment_batch_assignments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  batchId: varchar("batch_id").notNull().references(() => ledgerPaymentBatches.id, { onDelete: "cascade" }),
  paymentId: varchar("payment_id").notNull().unique().references(() => ledgerPayments.id, { onDelete: "restrict" }),
  data: jsonb("data"),
});

export const insertLedgerPaymentBatchAssignmentSchema = createInsertSchema(ledgerPaymentBatchAssignments).omit({
  id: true,
});

export type LedgerPaymentBatchAssignment = typeof ledgerPaymentBatchAssignments.$inferSelect;
export type InsertLedgerPaymentBatchAssignment = z.infer<typeof insertLedgerPaymentBatchAssignmentSchema>;
