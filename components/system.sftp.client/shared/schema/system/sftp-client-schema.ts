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

const baseConnectionFields = {
  host: z.string().min(1, "Host is required"),
  port: z.number().int().min(1).max(65535),
  username: z.string().optional().default(""),
  homeDir: z.string().optional().default(""),
};

export const sftpConnectionSchema = z.object({
  ...baseConnectionFields,
  protocol: z.literal("sftp"),
  password: z.string().optional().default(""),
  privateKey: z.string().optional().default(""),
  publicKey: z.string().optional().default(""),
  passphrase: z.string().optional().default(""),
});

export const ftpConnectionSchema = z.object({
  ...baseConnectionFields,
  protocol: z.literal("ftp"),
  password: z.string().optional().default(""),
  tlsMode: z.enum(["none", "implicit", "explicit"]).optional().default("none"),
});

export const connectionDataSchema = z.discriminatedUnion("protocol", [
  sftpConnectionSchema,
  ftpConnectionSchema,
]);

export type ConnectionData = z.infer<typeof connectionDataSchema>;
export type SftpConnectionData = z.infer<typeof sftpConnectionSchema>;
export type FtpConnectionData = z.infer<typeof ftpConnectionSchema>;

export const PROTOCOL_DEFAULTS: Record<string, { port: number; label: string }> = {
  sftp: { port: 22, label: "SFTP" },
  ftp: { port: 21, label: "FTP" },
};
