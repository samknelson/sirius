// Database storage implementation based on blueprint:javascript_database
import { 
  users, workers, roles, permissions, userRoles, rolePermissions,
  type User, type InsertUser, type Worker, type InsertWorker,
  type Role, type InsertRole, type Permission, type InsertPermission,
  type UserRole, type RolePermission, type AssignRole, type AssignPermission
} from "@shared/schema";
import { db } from "./db";
import { eq, and } from "drizzle-orm";
import bcrypt from "bcrypt";

// modify the interface with any CRUD methods
// you might need

export interface IStorage {
  // User operations
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUser(id: string, user: Partial<InsertUser>): Promise<User | undefined>;
  deleteUser(id: string): Promise<boolean>;
  getAllUsers(): Promise<User[]>;
  
  // Password operations
  hashPassword(password: string): Promise<string>;
  verifyPassword(password: string, hash: string): Promise<boolean>;
  
  // Role operations
  getAllRoles(): Promise<Role[]>;
  getRole(id: string): Promise<Role | undefined>;
  createRole(role: InsertRole): Promise<Role>;
  updateRole(id: string, role: Partial<InsertRole>): Promise<Role | undefined>;
  deleteRole(id: string): Promise<boolean>;
  
  // Permission operations
  getAllPermissions(): Promise<Permission[]>;
  getPermission(id: string): Promise<Permission | undefined>;
  createPermission(permission: InsertPermission): Promise<Permission>;
  updatePermission(id: string, permission: Partial<InsertPermission>): Promise<Permission | undefined>;
  deletePermission(id: string): Promise<boolean>;
  
  // User-Role assignment operations
  assignRoleToUser(assignment: AssignRole): Promise<UserRole>;
  unassignRoleFromUser(userId: string, roleId: string): Promise<boolean>;
  getUserRoles(userId: string): Promise<Role[]>;
  getUsersWithRole(roleId: string): Promise<User[]>;
  
  // Role-Permission assignment operations
  assignPermissionToRole(assignment: AssignPermission): Promise<RolePermission>;
  unassignPermissionFromRole(roleId: string, permissionId: string): Promise<boolean>;
  getRolePermissions(roleId: string): Promise<Permission[]>;
  getRolesWithPermission(permissionId: string): Promise<Role[]>;
  
  // Authorization helpers
  getUserPermissions(userId: string): Promise<Permission[]>;
  userHasPermission(userId: string, permissionKey: string): Promise<boolean>;
  
  // Worker CRUD operations
  getAllWorkers(): Promise<Worker[]>;
  getWorker(id: string): Promise<Worker | undefined>;
  createWorker(worker: InsertWorker): Promise<Worker>;
  updateWorker(id: string, worker: Partial<InsertWorker>): Promise<Worker | undefined>;
  deleteWorker(id: string): Promise<boolean>;
}

export class DatabaseStorage implements IStorage {
  // Password operations
  async hashPassword(password: string): Promise<string> {
    const saltRounds = 12;
    return bcrypt.hash(password, saltRounds);
  }

  async verifyPassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }

  // User operations
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user || undefined;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user || undefined;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db
      .insert(users)
      .values(insertUser)
      .returning();
    return user;
  }

  async updateUser(id: string, userUpdate: Partial<InsertUser>): Promise<User | undefined> {
    const [user] = await db
      .update(users)
      .set(userUpdate)
      .where(eq(users.id, id))
      .returning();
    return user || undefined;
  }

  async deleteUser(id: string): Promise<boolean> {
    const result = await db.delete(users).where(eq(users.id, id)).returning();
    return result.length > 0;
  }

  async getAllUsers(): Promise<User[]> {
    return db.select().from(users);
  }

  // Role operations
  async getAllRoles(): Promise<Role[]> {
    return db.select().from(roles);
  }

  async getRole(id: string): Promise<Role | undefined> {
    const [role] = await db.select().from(roles).where(eq(roles.id, id));
    return role || undefined;
  }

  async createRole(insertRole: InsertRole): Promise<Role> {
    const [role] = await db
      .insert(roles)
      .values(insertRole)
      .returning();
    return role;
  }

  async updateRole(id: string, roleUpdate: Partial<InsertRole>): Promise<Role | undefined> {
    const [role] = await db
      .update(roles)
      .set(roleUpdate)
      .where(eq(roles.id, id))
      .returning();
    return role || undefined;
  }

  async deleteRole(id: string): Promise<boolean> {
    const result = await db.delete(roles).where(eq(roles.id, id)).returning();
    return result.length > 0;
  }

  // Permission operations
  async getAllPermissions(): Promise<Permission[]> {
    return db.select().from(permissions);
  }

  async getPermission(id: string): Promise<Permission | undefined> {
    const [permission] = await db.select().from(permissions).where(eq(permissions.id, id));
    return permission || undefined;
  }

  async createPermission(insertPermission: InsertPermission): Promise<Permission> {
    const [permission] = await db
      .insert(permissions)
      .values(insertPermission)
      .returning();
    return permission;
  }

  async updatePermission(id: string, permissionUpdate: Partial<InsertPermission>): Promise<Permission | undefined> {
    const [permission] = await db
      .update(permissions)
      .set(permissionUpdate)
      .where(eq(permissions.id, id))
      .returning();
    return permission || undefined;
  }

  async deletePermission(id: string): Promise<boolean> {
    const result = await db.delete(permissions).where(eq(permissions.id, id)).returning();
    return result.length > 0;
  }

  // User-Role assignment operations
  async assignRoleToUser(assignment: AssignRole): Promise<UserRole> {
    const [userRole] = await db
      .insert(userRoles)
      .values(assignment)
      .returning();
    return userRole;
  }

  async unassignRoleFromUser(userId: string, roleId: string): Promise<boolean> {
    const result = await db
      .delete(userRoles)
      .where(and(eq(userRoles.userId, userId), eq(userRoles.roleId, roleId)))
      .returning();
    return result.length > 0;
  }

  async getUserRoles(userId: string): Promise<Role[]> {
    const result = await db
      .select({
        id: roles.id,
        name: roles.name,
        description: roles.description,
        createdAt: roles.createdAt,
      })
      .from(userRoles)
      .innerJoin(roles, eq(userRoles.roleId, roles.id))
      .where(eq(userRoles.userId, userId));
    return result;
  }

  async getUsersWithRole(roleId: string): Promise<User[]> {
    const result = await db
      .select({
        id: users.id,
        username: users.username,
        password_hash: users.password_hash,
        isActive: users.isActive,
        createdAt: users.createdAt,
      })
      .from(userRoles)
      .innerJoin(users, eq(userRoles.userId, users.id))
      .where(eq(userRoles.roleId, roleId));
    return result;
  }

  // Role-Permission assignment operations
  async assignPermissionToRole(assignment: AssignPermission): Promise<RolePermission> {
    const [rolePermission] = await db
      .insert(rolePermissions)
      .values(assignment)
      .returning();
    return rolePermission;
  }

  async unassignPermissionFromRole(roleId: string, permissionId: string): Promise<boolean> {
    const result = await db
      .delete(rolePermissions)
      .where(and(eq(rolePermissions.roleId, roleId), eq(rolePermissions.permissionId, permissionId)))
      .returning();
    return result.length > 0;
  }

  async getRolePermissions(roleId: string): Promise<Permission[]> {
    const result = await db
      .select({
        id: permissions.id,
        key: permissions.key,
        description: permissions.description,
        createdAt: permissions.createdAt,
      })
      .from(rolePermissions)
      .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
      .where(eq(rolePermissions.roleId, roleId));
    return result;
  }

  async getRolesWithPermission(permissionId: string): Promise<Role[]> {
    const result = await db
      .select({
        id: roles.id,
        name: roles.name,
        description: roles.description,
        createdAt: roles.createdAt,
      })
      .from(rolePermissions)
      .innerJoin(roles, eq(rolePermissions.roleId, roles.id))
      .where(eq(rolePermissions.permissionId, permissionId));
    return result;
  }

  // Authorization helpers
  async getUserPermissions(userId: string): Promise<Permission[]> {
    const result = await db
      .select({
        id: permissions.id,
        key: permissions.key,
        description: permissions.description,
        createdAt: permissions.createdAt,
      })
      .from(userRoles)
      .innerJoin(roles, eq(userRoles.roleId, roles.id))
      .innerJoin(rolePermissions, eq(roles.id, rolePermissions.roleId))
      .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
      .where(eq(userRoles.userId, userId));
    return result;
  }

  async userHasPermission(userId: string, permissionKey: string): Promise<boolean> {
    const result = await db
      .select({ count: permissions.id })
      .from(userRoles)
      .innerJoin(roles, eq(userRoles.roleId, roles.id))
      .innerJoin(rolePermissions, eq(roles.id, rolePermissions.roleId))
      .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
      .where(and(eq(userRoles.userId, userId), eq(permissions.key, permissionKey)));
    return result.length > 0;
  }

  // Worker operations
  async getAllWorkers(): Promise<Worker[]> {
    const allWorkers = await db.select().from(workers);
    return allWorkers.sort((a, b) => a.name.localeCompare(b.name));
  }

  async getWorker(id: string): Promise<Worker | undefined> {
    const [worker] = await db.select().from(workers).where(eq(workers.id, id));
    return worker || undefined;
  }

  async createWorker(insertWorker: InsertWorker): Promise<Worker> {
    const [worker] = await db
      .insert(workers)
      .values(insertWorker)
      .returning();
    return worker;
  }

  async updateWorker(id: string, workerUpdate: Partial<InsertWorker>): Promise<Worker | undefined> {
    const [worker] = await db
      .update(workers)
      .set(workerUpdate)
      .where(eq(workers.id, id))
      .returning();
    return worker || undefined;
  }

  async deleteWorker(id: string): Promise<boolean> {
    const result = await db.delete(workers).where(eq(workers.id, id)).returning();
    return result.length > 0;
  }
}

export const storage = new DatabaseStorage();
