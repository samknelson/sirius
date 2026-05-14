import { pgTable, varchar, jsonb, date } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { workers, policies } from "../../schema";

export const workerTrustElections = pgTable("worker_trust_elections", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  workerId: varchar("worker_id").notNull().references(() => workers.id, { onDelete: 'cascade' }),
  benefitIds: varchar("benefit_ids").array(),
  policyId: varchar("policy_id").notNull().references(() => policies.id, { onDelete: 'restrict' }),
  startYmd: date("start_ymd").notNull(),
  endYmd: date("end_ymd"),
  relationshipIds: varchar("relationship_ids").array(),
  data: jsonb("data"),
});

export const insertWorkerTrustElectionSchema = createInsertSchema(workerTrustElections).omit({
  id: true,
});

export type WorkerTrustElection = typeof workerTrustElections.$inferSelect;
export type InsertWorkerTrustElection = z.infer<typeof insertWorkerTrustElectionSchema>;
