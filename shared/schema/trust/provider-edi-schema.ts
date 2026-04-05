import { pgTable, varchar, boolean, jsonb } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { sftpClientDestinations } from "../system/sftp-client-schema";
import { trustProviders } from "../../schema";

export const trustProviderEdi = pgTable("trust_provider_edi", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name").notNull(),
  siriusId: varchar("sirius_id").unique(),
  providerId: varchar("provider_id").notNull().references(() => trustProviders.id, { onDelete: "cascade" }),
  sftpClientId: varchar("sftp_client_id").references(() => sftpClientDestinations.id, { onDelete: "restrict" }),
  active: boolean("active").notNull().default(true),
  data: jsonb("data"),
});

export const insertTrustProviderEdiSchema = createInsertSchema(trustProviderEdi).omit({
  id: true,
});

export type InsertTrustProviderEdi = z.infer<typeof insertTrustProviderEdiSchema>;
export type TrustProviderEdi = typeof trustProviderEdi.$inferSelect;
