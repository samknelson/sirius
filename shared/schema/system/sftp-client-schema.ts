import { pgTable, varchar, boolean, text, jsonb } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const sftpClientDestinations = pgTable("sftp_client_destinations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  siriusId: varchar("sirius_id").unique(),
  name: varchar("name").notNull(),
  active: boolean("active").notNull().default(true),
  description: text("description"),
  data: jsonb("data"),
});

export const insertSftpClientDestinationSchema = createInsertSchema(sftpClientDestinations).omit({
  id: true,
});

export type InsertSftpClientDestination = z.infer<typeof insertSftpClientDestinationSchema>;
export type SftpClientDestination = typeof sftpClientDestinations.$inferSelect;
