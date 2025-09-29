import { sql } from "drizzle-orm";
import { pgTable, text, varchar, boolean, timestamp, primaryKey, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password_hash: text("password_hash").notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").default(sql`now()`).notNull(),
  lastLogin: timestamp("last_login"),
});

export const roles = pgTable("roles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull().unique(),
  description: text("description"),
  createdAt: timestamp("created_at").default(sql`now()`).notNull(),
});

export const userRoles = pgTable("user_roles", {
  userId: varchar("user_id").notNull(),
  roleId: varchar("role_id").notNull(),
  assignedAt: timestamp("assigned_at").default(sql`now()`).notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.userId, table.roleId] }),
}));

export const rolePermissions = pgTable("role_permissions", {
  roleId: varchar("role_id").notNull(),
  permissionKey: text("permission_key").notNull(), // Changed from permissionId to permissionKey
  assignedAt: timestamp("assigned_at").default(sql`now()`).notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.roleId, table.permissionKey] }),
}));

export const contacts = pgTable("contacts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
});

export const workers = pgTable("workers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  contactId: varchar("contact_id").notNull().references(() => contacts.id, { onDelete: 'cascade' }),
});

export const variables = pgTable("variables", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull().unique(),
  value: jsonb("value").notNull(),
});

export const postalAddresses = pgTable("postal_addresses", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  contactId: varchar("contact_id").notNull().references(() => contacts.id, { onDelete: 'cascade' }),
  street: text("street").notNull(),
  city: text("city").notNull(),
  state: text("state").notNull(),
  postalCode: text("postal_code").notNull(),
  country: text("country").notNull(),
  isPrimary: boolean("is_primary").default(false).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").default(sql`now()`).notNull(),
});

// Zod schemas for validation
export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
  createdAt: true,
});

export const loginUserSchema = z.object({
  username: z.string().min(3).max(50),
  password: z.string().min(6),
});

export const createUserSchema = loginUserSchema.extend({
  password: z.string().min(8),
});

export const insertRoleSchema = createInsertSchema(roles).omit({
  id: true,
  createdAt: true,
});

export const insertContactSchema = createInsertSchema(contacts).omit({
  id: true,
});

export const insertWorkerSchema = createInsertSchema(workers).omit({
  id: true,
  contactId: true, // Contact will be managed automatically
});

export const insertVariableSchema = createInsertSchema(variables).omit({
  id: true,
});

export const insertPostalAddressSchema = createInsertSchema(postalAddresses).omit({
  id: true,
  createdAt: true,
});

export const assignRoleSchema = z.object({
  userId: z.string(),
  roleId: z.string(),
});

export const assignPermissionSchema = z.object({
  roleId: z.string(),
  permissionKey: z.string(), // Changed from permissionId to permissionKey
});

// TypeScript types
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type LoginUser = z.infer<typeof loginUserSchema>;
export type CreateUser = z.infer<typeof createUserSchema>;

export type InsertRole = z.infer<typeof insertRoleSchema>;
export type Role = typeof roles.$inferSelect;

export type InsertContact = z.infer<typeof insertContactSchema>;
export type Contact = typeof contacts.$inferSelect;

export type InsertWorker = z.infer<typeof insertWorkerSchema>;
export type Worker = typeof workers.$inferSelect;

export type InsertVariable = z.infer<typeof insertVariableSchema>;
export type Variable = typeof variables.$inferSelect;

export type InsertPostalAddress = z.infer<typeof insertPostalAddressSchema>;
export type PostalAddress = typeof postalAddresses.$inferSelect;

export type UserRole = typeof userRoles.$inferSelect;
export type RolePermission = typeof rolePermissions.$inferSelect;
export type AssignRole = z.infer<typeof assignRoleSchema>;
export type AssignPermission = z.infer<typeof assignPermissionSchema>;
