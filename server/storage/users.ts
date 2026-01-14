import { getClient } from './transaction-context';
import {
  users,
  roles,
  userRoles,
  rolePermissions,
  type User,
  type InsertUser,
  type UpsertUser,
  type Role,
  type InsertRole,
  type UserRole,
  type RolePermission,
  type AssignRole,
  type AssignPermission,
} from "@shared/schema";
import { permissionRegistry, type PermissionDefinition } from "@shared/permissions";
import { eq, and, sql, inArray } from "drizzle-orm";
import { type StorageLoggingConfig } from "./middleware/logging";
import type { ContactsStorage } from "./contacts";
import { createUserContactSyncService } from "../services/user-contact-sync";

export interface UserStorage {
  // User operations
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  upsertUser(user: UpsertUser): Promise<User>;
  createUser(user: InsertUser): Promise<User>;
  updateUser(id: string, user: Partial<InsertUser>): Promise<User | undefined>;
  updateUserLastLogin(id: string): Promise<User | undefined>;
  deleteUser(id: string): Promise<boolean>;
  getAllUsers(): Promise<User[]>;
  getAllUsersWithRoles(): Promise<(User & { roles: Role[] })[]>;
  hasAnyUsers(): Promise<boolean>;
  updateUserData(id: string, data: Record<string, unknown>): Promise<User | undefined>;
  getUserData(id: string): Promise<Record<string, unknown> | null>;
  
  // Role operations
  getAllRoles(): Promise<Role[]>;
  getRole(id: string): Promise<Role | undefined>;
  createRole(role: InsertRole): Promise<Role>;
  updateRole(id: string, role: Partial<InsertRole>): Promise<Role | undefined>;
  deleteRole(id: string): Promise<boolean>;
  updateRoleSequence(id: string, sequence: number): Promise<Role | undefined>;
  
  // Permission operations (using registry)
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
  getAllRolePermissions(): Promise<(RolePermission & { role: Role })[]>;
  
  // Authorization helpers
  getUserPermissions(userId: string): Promise<PermissionDefinition[]>;
  userHasPermission(userId: string, permissionKey: string): Promise<boolean>;
  getUsersWithAnyPermission(permissionKeys: string[]): Promise<User[]>;
}

export function createUserStorage(contactsStorage?: ContactsStorage): UserStorage {
  const contactSync = contactsStorage ? createUserContactSyncService(contactsStorage) : null;

  return {
    // User operations
    async getUser(id: string): Promise<User | undefined> {
      const client = getClient();
      const [user] = await client.select().from(users).where(eq(users.id, id));
      return user || undefined;
    },

    async getUserByEmail(email: string): Promise<User | undefined> {
      const client = getClient();
      const [user] = await client.select().from(users).where(eq(users.email, email));
      return user || undefined;
    },

    async upsertUser(userData: UpsertUser): Promise<User> {
      const client = getClient();
      const [user] = await client
        .insert(users)
        .values(userData)
        .onConflictDoUpdate({
          target: users.id,
          set: {
            email: userData.email,
            firstName: userData.firstName,
            lastName: userData.lastName,
            profileImageUrl: userData.profileImageUrl,
            updatedAt: new Date(),
          },
        })
        .returning();
      
      if (contactSync) {
        await contactSync.ensureContactForUser(user);
      }
      
      return user;
    },

    async createUser(insertUser: InsertUser): Promise<User> {
      const client = getClient();
      const [user] = await client
        .insert(users)
        .values(insertUser)
        .returning();
      
      if (contactSync) {
        await contactSync.ensureContactForUser(user);
      }
      
      return user;
    },

    async updateUser(id: string, userUpdate: Partial<InsertUser>): Promise<User | undefined> {
      const client = getClient();
      const previousUser = await client.select().from(users).where(eq(users.id, id)).then(r => r[0]);
      const previousEmail = previousUser?.email;
      
      const [user] = await client
        .update(users)
        .set(userUpdate)
        .where(eq(users.id, id))
        .returning();
      
      if (user && contactSync) {
        await contactSync.ensureContactForUser(user, previousEmail);
      }
      
      return user || undefined;
    },

    async updateUserLastLogin(id: string): Promise<User | undefined> {
      const client = getClient();
      const [user] = await client
        .update(users)
        .set({ lastLogin: new Date() })
        .where(eq(users.id, id))
        .returning();
      return user || undefined;
    },

    async deleteUser(id: string): Promise<boolean> {
      const client = getClient();
      const result = await client.delete(users).where(eq(users.id, id)).returning();
      return result.length > 0;
    },

    async getAllUsers(): Promise<User[]> {
      const client = getClient();
      return client.select().from(users);
    },

    async getAllUsersWithRoles(): Promise<(User & { roles: Role[] })[]> {
      const client = getClient();
      const allUsers = await client.select().from(users);
      
      const userRoleData = await client
        .select({
          userId: userRoles.userId,
          roleId: roles.id,
          roleName: roles.name,
          roleDescription: roles.description,
          roleSequence: roles.sequence,
          roleCreatedAt: roles.createdAt,
        })
        .from(userRoles)
        .innerJoin(roles, eq(userRoles.roleId, roles.id));
      
      const rolesByUser = userRoleData.reduce((acc, row) => {
        if (!acc[row.userId]) {
          acc[row.userId] = [];
        }
        acc[row.userId].push({
          id: row.roleId,
          name: row.roleName,
          description: row.roleDescription,
          sequence: row.roleSequence,
          createdAt: row.roleCreatedAt,
        });
        return acc;
      }, {} as Record<string, Role[]>);
      
      return allUsers.map(user => ({
        ...user,
        roles: rolesByUser[user.id] || []
      }));
    },

    async hasAnyUsers(): Promise<boolean> {
      const client = getClient();
      const [result] = await client.select({ count: sql<number>`count(*)` }).from(users);
      return (result?.count ?? 0) > 0;
    },

    async updateUserData(id: string, data: Record<string, unknown>): Promise<User | undefined> {
      const client = getClient();
      const [user] = await client
        .update(users)
        .set({ data, updatedAt: new Date() })
        .where(eq(users.id, id))
        .returning();
      return user || undefined;
    },

    async getUserData(id: string): Promise<Record<string, unknown> | null> {
      const client = getClient();
      const [user] = await client.select({ data: users.data }).from(users).where(eq(users.id, id));
      return (user?.data as Record<string, unknown>) || null;
    },

    // Role operations
    async getAllRoles(): Promise<Role[]> {
      const client = getClient();
      return client.select().from(roles).orderBy(roles.sequence, roles.name);
    },

    async getRole(id: string): Promise<Role | undefined> {
      const client = getClient();
      const [role] = await client.select().from(roles).where(eq(roles.id, id));
      return role || undefined;
    },

    async createRole(insertRole: InsertRole): Promise<Role> {
      const client = getClient();
      const [role] = await client
        .insert(roles)
        .values(insertRole)
        .returning();
      return role;
    },

    async updateRole(id: string, roleUpdate: Partial<InsertRole>): Promise<Role | undefined> {
      const client = getClient();
      const [role] = await client
        .update(roles)
        .set(roleUpdate)
        .where(eq(roles.id, id))
        .returning();
      return role || undefined;
    },

    async deleteRole(id: string): Promise<boolean> {
      const client = getClient();
      const result = await client.delete(roles).where(eq(roles.id, id)).returning();
      return result.length > 0;
    },

    async updateRoleSequence(id: string, sequence: number): Promise<Role | undefined> {
      const client = getClient();
      const [role] = await client
        .update(roles)
        .set({ sequence })
        .where(eq(roles.id, id))
        .returning();
      return role || undefined;
    },

    // Permission operations (using registry)
    async getAllPermissions(): Promise<PermissionDefinition[]> {
      return permissionRegistry.getAll();
    },

    async getPermissionByKey(key: string): Promise<PermissionDefinition | undefined> {
      return permissionRegistry.getByKey(key);
    },

    permissionExists(key: string): boolean {
      return permissionRegistry.exists(key);
    },

    // User-Role assignment operations
    async assignRoleToUser(assignment: AssignRole): Promise<UserRole> {
      const client = getClient();
      const [userRole] = await client
        .insert(userRoles)
        .values(assignment)
        .returning();
      return userRole;
    },

    async unassignRoleFromUser(userId: string, roleId: string): Promise<boolean> {
      const client = getClient();
      const result = await client
        .delete(userRoles)
        .where(and(eq(userRoles.userId, userId), eq(userRoles.roleId, roleId)))
        .returning();
      return result.length > 0;
    },

    async getUserRoles(userId: string): Promise<Role[]> {
      const client = getClient();
      const result = await client
        .select({
          id: roles.id,
          name: roles.name,
          description: roles.description,
          sequence: roles.sequence,
          createdAt: roles.createdAt,
        })
        .from(userRoles)
        .innerJoin(roles, eq(userRoles.roleId, roles.id))
        .where(eq(userRoles.userId, userId))
        .orderBy(roles.sequence, roles.name);
      return result;
    },

    async getUsersWithRole(roleId: string): Promise<User[]> {
      const client = getClient();
      const result = await client
        .select({
          id: users.id,
          email: users.email,
          firstName: users.firstName,
          lastName: users.lastName,
          profileImageUrl: users.profileImageUrl,
          accountStatus: users.accountStatus,
          isActive: users.isActive,
          createdAt: users.createdAt,
          updatedAt: users.updatedAt,
          lastLogin: users.lastLogin,
          data: users.data,
        })
        .from(userRoles)
        .innerJoin(users, eq(userRoles.userId, users.id))
        .where(eq(userRoles.roleId, roleId));
      return result;
    },

    // Role-Permission assignment operations
    async assignPermissionToRole(assignment: AssignPermission): Promise<RolePermission> {
      const client = getClient();
      if (!permissionRegistry.exists(assignment.permissionKey)) {
        throw new Error(`Permission '${assignment.permissionKey}' does not exist in the registry`);
      }
      
      const [rolePermission] = await client
        .insert(rolePermissions)
        .values(assignment)
        .returning();
      return rolePermission;
    },

    async unassignPermissionFromRole(roleId: string, permissionKey: string): Promise<boolean> {
      const client = getClient();
      const result = await client
        .delete(rolePermissions)
        .where(and(eq(rolePermissions.roleId, roleId), eq(rolePermissions.permissionKey, permissionKey)))
        .returning();
      return result.length > 0;
    },

    async getRolePermissions(roleId: string): Promise<PermissionDefinition[]> {
      const client = getClient();
      const result = await client
        .select({
          permissionKey: rolePermissions.permissionKey,
        })
        .from(rolePermissions)
        .where(eq(rolePermissions.roleId, roleId));
      
      return result
        .map(row => permissionRegistry.getByKey(row.permissionKey))
        .filter((permission): permission is PermissionDefinition => permission !== undefined);
    },

    async getRolesWithPermission(permissionKey: string): Promise<Role[]> {
      const client = getClient();
      const result = await client
        .select({
          id: roles.id,
          name: roles.name,
          description: roles.description,
          sequence: roles.sequence,
          createdAt: roles.createdAt,
        })
        .from(rolePermissions)
        .innerJoin(roles, eq(rolePermissions.roleId, roles.id))
        .where(eq(rolePermissions.permissionKey, permissionKey))
        .orderBy(roles.sequence, roles.name);
      return result;
    },

    async getAllRolePermissions(): Promise<(RolePermission & { role: Role })[]> {
      const client = getClient();
      const result = await client
        .select({
          roleId: rolePermissions.roleId,
          permissionKey: rolePermissions.permissionKey,
          assignedAt: rolePermissions.assignedAt,
          role: {
            id: roles.id,
            name: roles.name,
            description: roles.description,
            sequence: roles.sequence,
            createdAt: roles.createdAt,
          }
        })
        .from(rolePermissions)
        .innerJoin(roles, eq(rolePermissions.roleId, roles.id))
        .orderBy(roles.sequence, roles.name);
      
      return result.map(row => ({
        roleId: row.roleId,
        permissionKey: row.permissionKey,
        assignedAt: row.assignedAt,
        role: row.role
      }));
    },

    // Authorization helpers
    async getUserPermissions(userId: string): Promise<PermissionDefinition[]> {
      const client = getClient();
      const result = await client
        .select({
          permissionKey: rolePermissions.permissionKey,
        })
        .from(userRoles)
        .innerJoin(roles, eq(userRoles.roleId, roles.id))
        .innerJoin(rolePermissions, eq(roles.id, rolePermissions.roleId))
        .where(eq(userRoles.userId, userId));
      
      const uniqueKeys = Array.from(new Set(result.map(row => row.permissionKey)));
      return uniqueKeys
        .map(key => permissionRegistry.getByKey(key))
        .filter((permission): permission is PermissionDefinition => permission !== undefined);
    },

    async userHasPermission(userId: string, permissionKey: string): Promise<boolean> {
      const client = getClient();
      const result = await client
        .select({ permissionKey: rolePermissions.permissionKey })
        .from(userRoles)
        .innerJoin(roles, eq(userRoles.roleId, roles.id))
        .innerJoin(rolePermissions, eq(roles.id, rolePermissions.roleId))
        .where(and(eq(userRoles.userId, userId), eq(rolePermissions.permissionKey, permissionKey)));
      return result.length > 0;
    },

    async getUsersWithAnyPermission(permissionKeys: string[]): Promise<User[]> {
      const client = getClient();
      if (permissionKeys.length === 0) {
        return [];
      }
      const result = await client
        .selectDistinct({
          id: users.id,
          email: users.email,
          firstName: users.firstName,
          lastName: users.lastName,
          profileImageUrl: users.profileImageUrl,
          accountStatus: users.accountStatus,
          isActive: users.isActive,
          createdAt: users.createdAt,
          updatedAt: users.updatedAt,
          lastLogin: users.lastLogin,
          data: users.data,
        })
        .from(users)
        .innerJoin(userRoles, eq(users.id, userRoles.userId))
        .innerJoin(rolePermissions, eq(userRoles.roleId, rolePermissions.roleId))
        .where(and(
          eq(users.isActive, true),
          inArray(rolePermissions.permissionKey, permissionKeys)
        ))
        .orderBy(users.lastName, users.firstName);
      return result;
    },
  };
}

/**
 * Logging configuration for user storage operations
 * 
 * Logs all user, role, and permission management operations with full argument capture and change tracking.
 */
export const userLoggingConfig: StorageLoggingConfig<UserStorage> = {
  module: 'users',
  methods: {
    createUser: {
      enabled: true,
      getEntityId: (args) => args[0]?.email || 'new user',
      getHostEntityId: (args, result) => result?.id, // User ID is the host
      after: async (args, result, storage) => {
        return result; // Capture created user
      }
    },
    updateUser: {
      enabled: true,
      getEntityId: (args) => args[0], // User ID
      getHostEntityId: (args) => args[0], // User ID is the host
      before: async (args, storage) => {
        return await storage.getUser(args[0]); // Current state
      },
      after: async (args, result, storage) => {
        return result; // New state (diff auto-calculated)
      },
      getDescription: async (args, result, beforeState, afterState) => {
        const user = afterState || beforeState;
        if (!user) return `Updated user ${args[0]}`;
        const userName = user.firstName && user.lastName
          ? `${user.firstName} ${user.lastName}`
          : user.email;
        
        // Calculate what changed
        const changes: string[] = [];
        if (beforeState && afterState) {
          const allKeys = Array.from(new Set([...Object.keys(beforeState), ...Object.keys(afterState)]));
          for (const key of allKeys) {
            if (JSON.stringify(beforeState[key]) !== JSON.stringify(afterState[key])) {
              changes.push(key);
            }
          }
        }
        
        if (changes.length === 0) {
          return `Updated user "${userName}" (no changes detected)`;
        }
        
        return `Updated user "${userName}" (changed: ${changes.join(', ')})`;
      }
    },
    deleteUser: {
      enabled: true,
      getEntityId: (args) => args[0], // User ID
      getHostEntityId: (args, result, beforeState) => beforeState?.id || args[0], // User ID is the host
      before: async (args, storage) => {
        return await storage.getUser(args[0]); // Capture what's being deleted
      },
      getDescription: async (args, result, beforeState) => {
        const user = beforeState;
        if (!user) return `Deleted user ${args[0]}`;
        const userName = user.firstName && user.lastName
          ? `${user.firstName} ${user.lastName}`
          : user.email;
        return `Deleted user "${userName}"`;
      }
    },
    createRole: {
      enabled: true,
      getEntityId: (args) => args[0]?.name || 'new role',
      after: async (args, result, storage) => {
        return result; // Capture created role
      }
    },
    updateRole: {
      enabled: true,
      getEntityId: (args) => args[0], // Role ID
      before: async (args, storage) => {
        return await storage.getRole(args[0]); // Current state
      },
      after: async (args, result, storage) => {
        return result; // New state (diff auto-calculated)
      }
    },
    deleteRole: {
      enabled: true,
      getEntityId: (args) => args[0], // Role ID
      before: async (args, storage) => {
        return await storage.getRole(args[0]); // Capture what's being deleted
      }
    },
    updateRoleSequence: {
      enabled: true,
      getEntityId: (args) => args[0], // Role ID
      before: async (args, storage) => {
        return await storage.getRole(args[0]); // Current state
      },
      after: async (args, result, storage) => {
        return result; // New state (diff auto-calculated)
      }
    },
    assignRoleToUser: {
      enabled: true,
      getEntityId: (args) => args[0]?.userId || 'user',
      getHostEntityId: (args, result) => result?.userId || args[0]?.userId, // User ID is the host
      after: async (args, result, storage) => {
        return result; // Capture role assignment
      },
      getDescription: async (args, result, beforeState, afterState, storage) => {
        const assignment = args[0];
        const user = await storage.getUser(assignment.userId);
        const role = await storage.getRole(assignment.roleId);
        const userName = user ? `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email : 'Unknown user';
        const roleName = role?.name || 'Unknown role';
        return `Assigned "${roleName}" to ${userName}`;
      }
    },
    unassignRoleFromUser: {
      enabled: true,
      getEntityId: (args) => args[0], // User ID
      getHostEntityId: (args) => args[0], // User ID is the host
      before: async (args, storage) => {
        // Capture the roles before removal
        const roles = await storage.getUserRoles(args[0]);
        return { userId: args[0], roleId: args[1], roles };
      },
      getDescription: async (args, result, beforeState, afterState, storage) => {
        const userId = args[0];
        const roleId = args[1];
        const user = await storage.getUser(userId);
        const role = await storage.getRole(roleId);
        const userName = user ? `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email : 'Unknown user';
        const roleName = role?.name || 'Unknown role';
        return `Unassigned "${roleName}" from ${userName}`;
      }
    },
    assignPermissionToRole: {
      enabled: true,
      getEntityId: (args) => args[0]?.roleId || 'role',
      after: async (args, result, storage) => {
        return result; // Capture permission assignment
      },
      getDescription: async (args, result, beforeState, afterState, storage) => {
        const assignment = args[0];
        const role = await storage.getRole(assignment.roleId);
        const roleName = role?.name || 'Unknown role';
        return `Assigned permission "${assignment.permissionKey}" to role "${roleName}"`;
      }
    },
    unassignPermissionFromRole: {
      enabled: true,
      getEntityId: (args) => args[0], // Role ID
      before: async (args, storage) => {
        // Capture the permissions before removal
        const permissions = await storage.getRolePermissions(args[0]);
        return { roleId: args[0], permissionKey: args[1], permissions };
      },
      getDescription: async (args, result, beforeState, afterState, storage) => {
        const roleId = args[0];
        const permissionKey = args[1];
        const role = await storage.getRole(roleId);
        const roleName = role?.name || 'Unknown role';
        return `Unassigned permission "${permissionKey}" from role "${roleName}"`;
      }
    }
  }
};
