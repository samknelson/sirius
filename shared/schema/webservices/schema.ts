import { sql } from "drizzle-orm";
import { pgTable, pgEnum, text, varchar, boolean, timestamp, index, uniqueIndex, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { pluginConfigs } from "../../schema";

export const wsClientStatusEnum = pgEnum("ws_client_status", [
  "active",
  "suspended",
  "revoked",
]);

export const wsClients = pgTable("ws_clients", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name", { length: 100 }).notNull(),
  description: text("description"),
  status: wsClientStatusEnum("status").default("active").notNull(),
  ipAllowlistEnabled: boolean("ip_allowlist_enabled").default(false).notNull(),
  createdAt: timestamp("created_at").default(sql`now()`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`now()`).notNull(),
}, (table) => ({
  statusIdx: index("ws_clients_status_idx").on(table.status),
}));

export const insertWsClientSchema = createInsertSchema(wsClients, {
  name: z.string().min(1).max(100),
  description: z.string().optional().nullable(),
}).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type WsClientStatus = (typeof wsClientStatusEnum.enumValues)[number];
export type InsertWsClient = z.infer<typeof insertWsClientSchema>;
export type WsClient = typeof wsClients.$inferSelect;

/**
 * A client's grant to one web service configuration (`plugin_configs` row of
 * kind `web-service`). A client holds any number of grants; a configuration is
 * granted to any number of clients. Granting and revoking never touches the
 * client's credentials.
 *
 * Both sides cascade: deleting the client or the configuration removes the
 * grant, so a revoked service can never leave a dangling authorization behind.
 */
export const wsClientGrants = pgTable("ws_client_grants", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  clientId: varchar("client_id").notNull().references(() => wsClients.id, { onDelete: "cascade" }),
  configId: varchar("config_id").notNull().references(() => pluginConfigs.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").default(sql`now()`).notNull(),
}, (table) => ({
  clientIdIdx: index("ws_client_grants_client_id_idx").on(table.clientId),
  configIdIdx: index("ws_client_grants_config_id_idx").on(table.configId),
  // Named UNIQUE CONSTRAINT (not a unique index) so the startup drift gate
  // sees the same object the migration creates.
  clientConfigUnique: unique("ws_client_grants_client_config_unique").on(table.clientId, table.configId),
}));

export const insertWsClientGrantSchema = createInsertSchema(wsClientGrants, {
  clientId: z.string().min(1),
  configId: z.string().min(1),
}).omit({
  id: true,
  createdAt: true,
});

export type InsertWsClientGrant = z.infer<typeof insertWsClientGrantSchema>;
export type WsClientGrant = typeof wsClientGrants.$inferSelect;

export const wsClientCredentials = pgTable("ws_client_credentials", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  clientId: varchar("client_id").notNull().references(() => wsClients.id, { onDelete: "cascade" }),
  clientKey: varchar("client_key", { length: 64 }).notNull().unique(),
  secretHash: varchar("secret_hash", { length: 255 }).notNull(),
  label: varchar("label", { length: 100 }),
  isActive: boolean("is_active").default(true).notNull(),
  expiresAt: timestamp("expires_at"),
  lastUsedAt: timestamp("last_used_at"),
  createdAt: timestamp("created_at").default(sql`now()`).notNull(),
}, (table) => ({
  clientIdIdx: index("ws_client_credentials_client_id_idx").on(table.clientId),
  clientKeyIdx: uniqueIndex("ws_client_credentials_client_key_idx").on(table.clientKey),
  isActiveIdx: index("ws_client_credentials_is_active_idx").on(table.isActive),
}));

export const insertWsClientCredentialSchema = createInsertSchema(wsClientCredentials, {
  clientId: z.string().min(1),
  clientKey: z.string().min(1).max(64),
  secretHash: z.string().min(1).max(255),
  label: z.string().max(100).optional().nullable(),
}).omit({
  id: true,
  lastUsedAt: true,
  createdAt: true,
});

export type InsertWsClientCredential = z.infer<typeof insertWsClientCredentialSchema>;
export type WsClientCredential = typeof wsClientCredentials.$inferSelect;

export const wsClientIpRules = pgTable("ws_client_ip_rules", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  clientId: varchar("client_id").notNull().references(() => wsClients.id, { onDelete: "cascade" }),
  ipAddress: varchar("ip_address", { length: 45 }).notNull(),
  description: text("description"),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").default(sql`now()`).notNull(),
}, (table) => ({
  clientIdIdx: index("ws_client_ip_rules_client_id_idx").on(table.clientId),
  clientIpIdx: uniqueIndex("ws_client_ip_rules_client_ip_idx").on(table.clientId, table.ipAddress),
}));

export const insertWsClientIpRuleSchema = createInsertSchema(wsClientIpRules, {
  clientId: z.string().min(1),
  ipAddress: z.string().min(1).max(45),
  description: z.string().optional().nullable(),
}).omit({
  id: true,
  createdAt: true,
});

export type InsertWsClientIpRule = z.infer<typeof insertWsClientIpRuleSchema>;
export type WsClientIpRule = typeof wsClientIpRules.$inferSelect;
