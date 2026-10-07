import { sql } from "drizzle-orm";
import { pgTable, varchar, timestamp, jsonb, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { users } from "../../schema";

export const sessionHistory = pgTable("session_history", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  // History survives logout/expiry; sid is deliberately not a live-session FK.
  sid: varchar("sid").notNull(),
  // Anonymous sessions have no user; deleting a user removes their history.
  userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }),
  ip: varchar("ip", { length: 45 }),
  // Verified browser-profile label only; neither a credential nor a device FK.
  deviceId: uuid("device_id"),
  timestamp: timestamp("timestamp").notNull().default(sql`now()`),
  data: jsonb("data"),
});

export const insertSessionHistorySchema = createInsertSchema(sessionHistory).omit({
  id: true,
});

export type SessionHistory = typeof sessionHistory.$inferSelect;
export type InsertSessionHistory = z.infer<typeof insertSessionHistorySchema>;
