import { sql } from "drizzle-orm";
import { pgTable, uuid, text, jsonb, timestamp, index } from "drizzle-orm/pg-core";

export const processes = pgTable("processes", {
  id: uuid("id").primaryKey(),
  name: text("name"),
  roles: text("roles").array().notNull(),
  data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
  startedTs: timestamp("started_ts", { withTimezone: true }).notNull(),
  updatedTs: timestamp("updated_ts", { withTimezone: true }).notNull(),
  endedTs: timestamp("ended_ts", { withTimezone: true }),
}, (t) => [
  index("processes_active_start_idx").on(t.startedTs, t.id).where(sql`${t.endedTs} IS NULL`),
  index("processes_expiry_idx").on(sql`COALESCE(${t.endedTs}, ${t.updatedTs})`),
]);
export type ProcessRecord = typeof processes.$inferSelect;
