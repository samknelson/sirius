import { sql } from "drizzle-orm";
import { pgTable, pgEnum, text, varchar, boolean, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const wsBundleStatusEnum = pgEnum("ws_bundle_status", [
  "active",
  "inactive",
  "deprecated",
]);

export const wsBundles = pgTable("ws_bundles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  code: varchar("code", { length: 50 }).notNull().unique(),
  name: varchar("name", { length: 100 }).notNull(),
  description: text("description"),
  version: varchar("version", { length: 20 }).default("1.0.0").notNull(),
  status: wsBundleStatusEnum("status").default("active").notNull(),
  createdAt: timestamp("created_at").default(sql`now()`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`now()`).notNull(),
});

export const insertWsBundleSchema = createInsertSchema(wsBundles, {
  code: z.string().min(1).max(50).regex(/^[a-z][a-z0-9-]*$/, "Code must start with letter and contain only lowercase letters, numbers, and hyphens"),
  name: z.string().min(1).max(100),
  description: z.string().optional().nullable(),
  version: z.string().max(20).optional(),
}).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type WsBundleStatus = (typeof wsBundleStatusEnum.enumValues)[number];
export type InsertWsBundle = z.infer<typeof insertWsBundleSchema>;
export type WsBundle = typeof wsBundles.$inferSelect;

export const wsClientStatusEnum = pgEnum("ws_client_status", [
  "active",
  "suspended",
  "revoked",
]);

export const wsClients = pgTable("ws_clients", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name", { length: 100 }).notNull(),
  description: text("description"),
  bundleId: varchar("bundle_id").notNull().references(() => wsBundles.id, { onDelete: "cascade" }),
  status: wsClientStatusEnum("status").default("active").notNull(),
  ipAllowlistEnabled: boolean("ip_allowlist_enabled").default(false).notNull(),
  createdAt: timestamp("created_at").default(sql`now()`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`now()`).notNull(),
}, (table) => ({
  bundleIdIdx: index("ws_clients_bundle_id_idx").on(table.bundleId),
  statusIdx: index("ws_clients_status_idx").on(table.status),
}));

export const insertWsClientSchema = createInsertSchema(wsClients, {
  name: z.string().min(1).max(100),
  description: z.string().optional().nullable(),
  bundleId: z.string().min(1),
}).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type WsClientStatus = (typeof wsClientStatusEnum.enumValues)[number];
export type InsertWsClient = z.infer<typeof insertWsClientSchema>;
export type WsClient = typeof wsClients.$inferSelect;

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
