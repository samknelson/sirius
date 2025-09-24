// Database storage implementation based on blueprint:javascript_database
import { 
  users, workers, contacts, roles, userRoles, rolePermissions, variables,
  type User, type InsertUser, type Worker, type InsertWorker,
  type Contact, type InsertContact,
  type Role, type InsertRole, type Variable, type InsertVariable,
  type UserRole, type RolePermission, type AssignRole, type AssignPermission
} from "@shared/schema";
import { permissionRegistry, type PermissionDefinition } from "@shared/permissions";
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
  updateUserLastLogin(id: string): Promise<User | undefined>;
  deleteUser(id: string): Promise<boolean>;
  getAllUsers(): Promise<User[]>;
  getAllUsersWithRoles(): Promise<(User & { roles: Role[] })[]>;
  
  // Password operations
  hashPassword(password: string): Promise<string>;
  verifyPassword(password: string, hash: string): Promise<boolean>;
  
  // Role operations
  getAllRoles(): Promise<Role[]>;
  getRole(id: string): Promise<Role | undefined>;
  createRole(role: InsertRole): Promise<Role>;
  updateRole(id: string, role: Partial<InsertRole>): Promise<Role | undefined>;
  deleteRole(id: string): Promise<boolean>;
  
  // Permission operations (now using registry)
  getAllPermissions(): Promise<PermissionDefinition[]>;
  getPermissionByKey(key: string): Promise<PermissionDefinition | undefined>;
  permissionExists(key: string): boolean;
  
  // User-Role assignment operations
  assignRoleToUser(assignment: AssignRole): Promise<UserRole>;
  unassignRoleFromUser(userId: string, roleId: string): Promise<boolean>;
  getUserRoles(userId: string): Promise<Role[]>;
  getUsersWithRole(roleId: string): Promise<User[]>;
  
  // Role-Permission assignment operations  
  assignPermissionToRole(assignment: AssignPermission): Promise<RolePermission>;
  unassignPermissionFromRole(roleId: string, permissionKey: string): Promise<boolean>;
  getRolePermissions(roleId: string): Promise<PermissionDefinition[]>;
  getRolesWithPermission(permissionKey: string): Promise<Role[]>;
  
  // Authorization helpers
  getUserPermissions(userId: string): Promise<PermissionDefinition[]>;
  userHasPermission(userId: string, permissionKey: string): Promise<boolean>;
  
  // Worker CRUD operations
  getAllWorkers(): Promise<Worker[]>;
  getWorker(id: string): Promise<Worker | undefined>;
  createWorker(worker: InsertWorker): Promise<Worker>;
  updateWorker(id: string, worker: Partial<InsertWorker>): Promise<Worker | undefined>;
  deleteWorker(id: string): Promise<boolean>;

  // Variable CRUD operations
  getAllVariables(): Promise<Variable[]>;
  getVariable(id: string): Promise<Variable | undefined>;
  getVariableByName(name: string): Promise<Variable | undefined>;
  createVariable(variable: InsertVariable): Promise<Variable>;
  updateVariable(id: string, variable: Partial<InsertVariable>): Promise<Variable | undefined>;
  deleteVariable(id: string): Promise<boolean>;
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

  async updateUserLastLogin(id: string): Promise<User | undefined> {
    const [user] = await db
      .update(users)
      .set({ lastLogin: new Date() })
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

  async getAllUsersWithRoles(): Promise<(User & { roles: Role[] })[]> {
    // Get all users
    const allUsers = await db.select().from(users);
    
    // Get all user-role relationships with role details in one query
    const userRoleData = await db
      .select({
        userId: userRoles.userId,
        roleId: roles.id,
        roleName: roles.name,
        roleDescription: roles.description,
        roleCreatedAt: roles.createdAt,
      })
      .from(userRoles)
      .innerJoin(roles, eq(userRoles.roleId, roles.id));
    
    // Group roles by user ID
    const rolesByUser = userRoleData.reduce((acc, row) => {
      if (!acc[row.userId]) {
        acc[row.userId] = [];
      }
      acc[row.userId].push({
        id: row.roleId,
        name: row.roleName,
        description: row.roleDescription,
        createdAt: row.roleCreatedAt,
      });
      return acc;
    }, {} as Record<string, Role[]>);
    
    // Combine users with their roles
    return allUsers.map(user => ({
      ...user,
      roles: rolesByUser[user.id] || []
    }));
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

  // Permission operations (now using registry)
  async getAllPermissions(): Promise<PermissionDefinition[]> {
    return permissionRegistry.getAll();
  }

  async getPermissionByKey(key: string): Promise<PermissionDefinition | undefined> {
    return permissionRegistry.getByKey(key);
  }

  permissionExists(key: string): boolean {
    return permissionRegistry.exists(key);
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
        lastLogin: users.lastLogin,
      })
      .from(userRoles)
      .innerJoin(users, eq(userRoles.userId, users.id))
      .where(eq(userRoles.roleId, roleId));
    return result;
  }

  // Role-Permission assignment operations
  async assignPermissionToRole(assignment: AssignPermission): Promise<RolePermission> {
    // Validate that the permission key exists in the registry
    if (!permissionRegistry.exists(assignment.permissionKey)) {
      throw new Error(`Permission '${assignment.permissionKey}' does not exist in the registry`);
    }
    
    const [rolePermission] = await db
      .insert(rolePermissions)
      .values(assignment)
      .returning();
    return rolePermission;
  }

  async unassignPermissionFromRole(roleId: string, permissionKey: string): Promise<boolean> {
    const result = await db
      .delete(rolePermissions)
      .where(and(eq(rolePermissions.roleId, roleId), eq(rolePermissions.permissionKey, permissionKey)))
      .returning();
    return result.length > 0;
  }

  async getRolePermissions(roleId: string): Promise<PermissionDefinition[]> {
    const result = await db
      .select({
        permissionKey: rolePermissions.permissionKey,
      })
      .from(rolePermissions)
      .where(eq(rolePermissions.roleId, roleId));
    
    // Map permission keys to PermissionDefinitions from registry
    return result
      .map(row => permissionRegistry.getByKey(row.permissionKey))
      .filter((permission): permission is PermissionDefinition => permission !== undefined);
  }

  async getRolesWithPermission(permissionKey: string): Promise<Role[]> {
    const result = await db
      .select({
        id: roles.id,
        name: roles.name,
        description: roles.description,
        createdAt: roles.createdAt,
      })
      .from(rolePermissions)
      .innerJoin(roles, eq(rolePermissions.roleId, roles.id))
      .where(eq(rolePermissions.permissionKey, permissionKey));
    return result;
  }

  // Authorization helpers
  async getUserPermissions(userId: string): Promise<PermissionDefinition[]> {
    const result = await db
      .select({
        permissionKey: rolePermissions.permissionKey,
      })
      .from(userRoles)
      .innerJoin(roles, eq(userRoles.roleId, roles.id))
      .innerJoin(rolePermissions, eq(roles.id, rolePermissions.roleId))
      .where(eq(userRoles.userId, userId));
    
    // Map permission keys to PermissionDefinitions from registry and remove duplicates
    const uniqueKeys = Array.from(new Set(result.map(row => row.permissionKey)));
    return uniqueKeys
      .map(key => permissionRegistry.getByKey(key))
      .filter((permission): permission is PermissionDefinition => permission !== undefined);
  }

  async userHasPermission(userId: string, permissionKey: string): Promise<boolean> {
    const result = await db
      .select({ permissionKey: rolePermissions.permissionKey })
      .from(userRoles)
      .innerJoin(roles, eq(userRoles.roleId, roles.id))
      .innerJoin(rolePermissions, eq(roles.id, rolePermissions.roleId))
      .where(and(eq(userRoles.userId, userId), eq(rolePermissions.permissionKey, permissionKey)));
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
    // Create contact first with the same name as the worker
    const [contact] = await db
      .insert(contacts)
      .values({ name: insertWorker.name })
      .returning();
    
    // Create worker with the contact reference
    const [worker] = await db
      .insert(workers)
      .values({ ...insertWorker, contactId: contact.id })
      .returning();
    
    return worker;
  }

  async updateWorker(id: string, workerUpdate: Partial<InsertWorker>): Promise<Worker | undefined> {
    // Get the current worker to find its contact
    const currentWorker = await this.getWorker(id);
    if (!currentWorker) {
      return undefined;
    }
    
    // Update the worker
    const [worker] = await db
      .update(workers)
      .set(workerUpdate)
      .where(eq(workers.id, id))
      .returning();
    
    // If the name was updated, also update the corresponding contact
    if (workerUpdate.name && worker) {
      await db
        .update(contacts)
        .set({ name: workerUpdate.name })
        .where(eq(contacts.id, worker.contactId));
    }
    
    return worker || undefined;
  }

  async deleteWorker(id: string): Promise<boolean> {
    // Get the worker to find its contact
    const worker = await this.getWorker(id);
    if (!worker) {
      return false;
    }
    
    // Delete the worker first
    const result = await db.delete(workers).where(eq(workers.id, id)).returning();
    
    // If worker was deleted, also delete the corresponding contact
    if (result.length > 0) {
      await db.delete(contacts).where(eq(contacts.id, worker.contactId));
    }
    
    return result.length > 0;
  }

  // Variable operations
  async getAllVariables(): Promise<Variable[]> {
    const allVariables = await db.select().from(variables);
    return allVariables.sort((a, b) => a.name.localeCompare(b.name));
  }

  async getVariable(id: string): Promise<Variable | undefined> {
    const [variable] = await db.select().from(variables).where(eq(variables.id, id));
    return variable || undefined;
  }

  async getVariableByName(name: string): Promise<Variable | undefined> {
    const [variable] = await db.select().from(variables).where(eq(variables.name, name));
    return variable || undefined;
  }

  async createVariable(insertVariable: InsertVariable): Promise<Variable> {
    const [variable] = await db
      .insert(variables)
      .values(insertVariable)
      .returning();
    return variable;
  }

  async updateVariable(id: string, variableUpdate: Partial<InsertVariable>): Promise<Variable | undefined> {
    const [variable] = await db
      .update(variables)
      .set(variableUpdate)
      .where(eq(variables.id, id))
      .returning();
    
    return variable || undefined;
  }

  async deleteVariable(id: string): Promise<boolean> {
    const result = await db.delete(variables).where(eq(variables.id, id)).returning();
    return result.length > 0;
  }
}

export const storage = new DatabaseStorage();
