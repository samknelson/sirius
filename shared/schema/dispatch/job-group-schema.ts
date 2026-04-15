import { pgTable, text, varchar, jsonb, date } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const dispatchJobGroups = pgTable("dispatch_job_group", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  startYmd: date("start_ymd").notNull(),
  endYmd: date("end_ymd").notNull(),
  data: jsonb("data"),
});

export const insertDispatchJobGroupSchema = createInsertSchema(dispatchJobGroups).omit({
  id: true,
}).extend({
  startYmd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD format"),
  endYmd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD format"),
});

export type InsertDispatchJobGroup = z.infer<typeof insertDispatchJobGroupSchema>;
export type DispatchJobGroup = typeof dispatchJobGroups.$inferSelect;
