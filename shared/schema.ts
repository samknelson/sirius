import { sql } from "drizzle-orm";
import { pgTable, text, varchar, boolean, timestamp, primaryKey } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password_hash: text("password_hash").notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").default(sql`now()`).notNull(),
});

export const roles = pgTable("roles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull().unique(),
  description: text("description"),
  createdAt: timestamp("created_at").default(sql`now()`).notNull(),
});

export const permissions = pgTable("permissions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  key: text("key").notNull().unique(),
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
  permissionId: varchar("permission_id").notNull(),
  assignedAt: timestamp("assigned_at").default(sql`now()`).notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.roleId, table.permissionId] }),
}));

export const workers = pgTable("workers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
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

export const insertPermissionSchema = createInsertSchema(permissions).omit({
  id: true,
  createdAt: true,
});

export const insertWorkerSchema = createInsertSchema(workers).omit({
  id: true,
});

export const assignRoleSchema = z.object({
  userId: z.string(),
  roleId: z.string(),
});

export const assignPermissionSchema = z.object({
  roleId: z.string(),
  permissionId: z.string(),
});

// TypeScript types
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type LoginUser = z.infer<typeof loginUserSchema>;
export type CreateUser = z.infer<typeof createUserSchema>;

export type InsertRole = z.infer<typeof insertRoleSchema>;
export type Role = typeof roles.$inferSelect;

export type InsertPermission = z.infer<typeof insertPermissionSchema>;
export type Permission = typeof permissions.$inferSelect;

export type InsertWorker = z.infer<typeof insertWorkerSchema>;
export type Worker = typeof workers.$inferSelect;

export type UserRole = typeof userRoles.$inferSelect;
export type RolePermission = typeof rolePermissions.$inferSelect;
export type AssignRole = z.infer<typeof assignRoleSchema>;
export type AssignPermission = z.infer<typeof assignPermissionSchema>;
