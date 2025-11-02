// Database storage implementation based on blueprint:javascript_database
import { 
  users, workers, contacts, roles, userRoles, rolePermissions, variables, postalAddresses, phoneNumbers,
  type User, type InsertUser, type Worker, type InsertWorker,
  type Contact, type InsertContact,
  type Role, type InsertRole, type Variable, type InsertVariable,
  type PostalAddress, type InsertPostalAddress,
  type PhoneNumber, type InsertPhoneNumber,
  type UserRole, type RolePermission, type AssignRole, type AssignPermission
} from "@shared/schema";
import { permissionRegistry, type PermissionDefinition } from "@shared/permissions";
import { db } from "./db";
import { eq, and, desc } from "drizzle-orm";
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
  createWorker(name: string): Promise<Worker>;
  updateWorkerContactName(id: string, name: string): Promise<Worker | undefined>;
  deleteWorker(id: string): Promise<boolean>;

  // Variable CRUD operations
  getAllVariables(): Promise<Variable[]>;
  getVariable(id: string): Promise<Variable | undefined>;
  getVariableByName(name: string): Promise<Variable | undefined>;
  createVariable(variable: InsertVariable): Promise<Variable>;
  updateVariable(id: string, variable: Partial<InsertVariable>): Promise<Variable | undefined>;
  deleteVariable(id: string): Promise<boolean>;

  // Postal Address CRUD operations
  getAllPostalAddresses(): Promise<PostalAddress[]>;
  getPostalAddress(id: string): Promise<PostalAddress | undefined>;
  getPostalAddressesByContact(contactId: string): Promise<PostalAddress[]>;
  createPostalAddress(address: InsertPostalAddress): Promise<PostalAddress>;
  updatePostalAddress(id: string, address: Partial<InsertPostalAddress>): Promise<PostalAddress | undefined>;
  deletePostalAddress(id: string): Promise<boolean>;
  setAddressAsPrimary(addressId: string, contactId: string): Promise<PostalAddress | undefined>;

  // Phone Number CRUD operations
  getAllPhoneNumbers(): Promise<PhoneNumber[]>;
  getPhoneNumber(id: string): Promise<PhoneNumber | undefined>;
  getPhoneNumbersByContact(contactId: string): Promise<PhoneNumber[]>;
  createPhoneNumber(phoneNumber: InsertPhoneNumber): Promise<PhoneNumber>;
  updatePhoneNumber(id: string, phoneNumber: Partial<InsertPhoneNumber>): Promise<PhoneNumber | undefined>;
  deletePhoneNumber(id: string): Promise<boolean>;
  setPhoneNumberAsPrimary(phoneNumberId: string, contactId: string): Promise<PhoneNumber | undefined>;
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
    return await db.select().from(workers);
  }

  async getWorker(id: string): Promise<Worker | undefined> {
    const [worker] = await db.select().from(workers).where(eq(workers.id, id));
    return worker || undefined;
  }

  async createWorker(name: string): Promise<Worker> {
    // For simple name input, parse into given/family names
    const nameParts = name.trim().split(' ');
    const given = nameParts[0] || '';
    const family = nameParts.slice(1).join(' ') || '';
    
    // Create contact first with name components
    const [contact] = await db
      .insert(contacts)
      .values({
        given: given || null,
        family: family || null,
        displayName: name,
      })
      .returning();
    
    // Create worker with the contact reference
    const [worker] = await db
      .insert(workers)
      .values({ contactId: contact.id })
      .returning();
    
    return worker;
  }

  async updateWorkerContactName(workerId: string, name: string): Promise<Worker | undefined> {
    // Get the current worker to find its contact
    const currentWorker = await this.getWorker(workerId);
    if (!currentWorker) {
      return undefined;
    }
    
    // For simple name input, parse into given/family names
    const nameParts = name.trim().split(' ');
    const given = nameParts[0] || '';
    const family = nameParts.slice(1).join(' ') || '';
    
    // Update the contact's name components
    await db
      .update(contacts)
      .set({
        given: given || null,
        family: family || null,
        displayName: name,
      })
      .where(eq(contacts.id, currentWorker.contactId));
    
    return currentWorker;
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

  // Contact operations
  async getContact(id: string): Promise<Contact | undefined> {
    const [contact] = await db.select().from(contacts).where(eq(contacts.id, id));
    return contact || undefined;
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

  // Postal Address operations
  async getAllPostalAddresses(): Promise<PostalAddress[]> {
    return await db.select().from(postalAddresses);
  }

  async getPostalAddress(id: string): Promise<PostalAddress | undefined> {
    const [address] = await db.select().from(postalAddresses).where(eq(postalAddresses.id, id));
    return address || undefined;
  }

  async getPostalAddressesByContact(contactId: string): Promise<PostalAddress[]> {
    return await db.select().from(postalAddresses).where(eq(postalAddresses.contactId, contactId)).orderBy(desc(postalAddresses.isPrimary));
  }

  async createPostalAddress(insertPostalAddress: InsertPostalAddress): Promise<PostalAddress> {
    // Validation: Prevent creating an inactive primary address
    if (insertPostalAddress.isPrimary && insertPostalAddress.isActive === false) {
      throw new Error("Cannot create an inactive address as primary. Either activate the address or don't set it as primary.");
    }

    // If creating a primary address, first unset any existing primary addresses for this contact
    if (insertPostalAddress.isPrimary) {
      await db
        .update(postalAddresses)
        .set({ isPrimary: false })
        .where(eq(postalAddresses.contactId, insertPostalAddress.contactId));
    }
    
    const [address] = await db
      .insert(postalAddresses)
      .values(insertPostalAddress)
      .returning();
    return address;
  }

  async updatePostalAddress(id: string, addressUpdate: Partial<InsertPostalAddress>): Promise<PostalAddress | undefined> {
    // Get the current address to perform validation checks
    const currentAddress = await this.getPostalAddress(id);
    if (!currentAddress) {
      throw new Error("Address not found");
    }

    // Validation: Prevent making a primary address inactive
    if (currentAddress.isPrimary && addressUpdate.isActive === false) {
      throw new Error("Cannot deactivate a primary address. Set another address as primary first.");
    }

    // Validation: Prevent making an inactive address primary
    if (!currentAddress.isActive && addressUpdate.isPrimary === true) {
      throw new Error("Cannot set an inactive address as primary. Activate the address first.");
    }

    // If setting as primary, unset any existing primary addresses for this contact
    if (addressUpdate.isPrimary) {
      await db
        .update(postalAddresses)
        .set({ isPrimary: false })
        .where(eq(postalAddresses.contactId, currentAddress.contactId));
    }
    
    const [address] = await db
      .update(postalAddresses)
      .set(addressUpdate)
      .where(eq(postalAddresses.id, id))
      .returning();
    
    return address || undefined;
  }

  async deletePostalAddress(id: string): Promise<boolean> {
    const result = await db.delete(postalAddresses).where(eq(postalAddresses.id, id)).returning();
    return result.length > 0;
  }

  async setAddressAsPrimary(addressId: string, contactId: string): Promise<PostalAddress | undefined> {
    // Get the current address to validate it can be set as primary
    const currentAddress = await this.getPostalAddress(addressId);
    if (!currentAddress) {
      throw new Error("Address not found");
    }

    // Validation: Prevent setting an inactive address as primary
    if (!currentAddress.isActive) {
      throw new Error("Cannot set an inactive address as primary. Activate the address first.");
    }

    // First, unset all primary addresses for this contact
    await db
      .update(postalAddresses)
      .set({ isPrimary: false })
      .where(eq(postalAddresses.contactId, contactId));
    
    // Then set the specified address as primary
    const [address] = await db
      .update(postalAddresses)
      .set({ isPrimary: true })
      .where(and(eq(postalAddresses.id, addressId), eq(postalAddresses.contactId, contactId)))
      .returning();
    
    return address || undefined;
  }

  // Phone Number operations
  async getAllPhoneNumbers(): Promise<PhoneNumber[]> {
    return await db.select().from(phoneNumbers);
  }

  async getPhoneNumber(id: string): Promise<PhoneNumber | undefined> {
    const [phoneNumber] = await db.select().from(phoneNumbers).where(eq(phoneNumbers.id, id));
    return phoneNumber || undefined;
  }

  async getPhoneNumbersByContact(contactId: string): Promise<PhoneNumber[]> {
    return await db.select().from(phoneNumbers).where(eq(phoneNumbers.contactId, contactId)).orderBy(desc(phoneNumbers.isPrimary));
  }

  async createPhoneNumber(insertPhoneNumber: InsertPhoneNumber): Promise<PhoneNumber> {
    // Validation: Prevent creating an inactive primary phone number
    if (insertPhoneNumber.isPrimary && insertPhoneNumber.isActive === false) {
      throw new Error("Cannot create an inactive phone number as primary. Either activate the phone number or don't set it as primary.");
    }

    // If creating a primary phone number, first unset any existing primary phone numbers for this contact
    if (insertPhoneNumber.isPrimary) {
      await db
        .update(phoneNumbers)
        .set({ isPrimary: false })
        .where(eq(phoneNumbers.contactId, insertPhoneNumber.contactId));
    }
    
    const [phoneNumber] = await db
      .insert(phoneNumbers)
      .values(insertPhoneNumber)
      .returning();
    return phoneNumber;
  }

  async updatePhoneNumber(id: string, phoneNumberUpdate: Partial<InsertPhoneNumber>): Promise<PhoneNumber | undefined> {
    // Get the current phone number to perform validation checks
    const currentPhoneNumber = await this.getPhoneNumber(id);
    if (!currentPhoneNumber) {
      throw new Error("Phone number not found");
    }

    // Validation: Prevent making a primary phone number inactive
    if (currentPhoneNumber.isPrimary && phoneNumberUpdate.isActive === false) {
      throw new Error("Cannot deactivate a primary phone number. Set another phone number as primary first.");
    }

    // Validation: Prevent making an inactive phone number primary
    if (!currentPhoneNumber.isActive && phoneNumberUpdate.isPrimary === true) {
      throw new Error("Cannot set an inactive phone number as primary. Activate the phone number first.");
    }

    // If setting as primary, unset any existing primary phone numbers for this contact
    if (phoneNumberUpdate.isPrimary) {
      await db
        .update(phoneNumbers)
        .set({ isPrimary: false })
        .where(eq(phoneNumbers.contactId, currentPhoneNumber.contactId));
    }
    
    const [phoneNumber] = await db
      .update(phoneNumbers)
      .set(phoneNumberUpdate)
      .where(eq(phoneNumbers.id, id))
      .returning();
    
    return phoneNumber || undefined;
  }

  async deletePhoneNumber(id: string): Promise<boolean> {
    const result = await db.delete(phoneNumbers).where(eq(phoneNumbers.id, id)).returning();
    return result.length > 0;
  }

  async setPhoneNumberAsPrimary(phoneNumberId: string, contactId: string): Promise<PhoneNumber | undefined> {
    // Get the current phone number to validate it can be set as primary
    const currentPhoneNumber = await this.getPhoneNumber(phoneNumberId);
    if (!currentPhoneNumber) {
      throw new Error("Phone number not found");
    }

    // Validation: Prevent setting an inactive phone number as primary
    if (!currentPhoneNumber.isActive) {
      throw new Error("Cannot set an inactive phone number as primary. Activate the phone number first.");
    }

    // First, unset all primary phone numbers for this contact
    await db
      .update(phoneNumbers)
      .set({ isPrimary: false })
      .where(eq(phoneNumbers.contactId, contactId));
    
    // Then set the specified phone number as primary
    const [phoneNumber] = await db
      .update(phoneNumbers)
      .set({ isPrimary: true })
      .where(and(eq(phoneNumbers.id, phoneNumberId), eq(phoneNumbers.contactId, contactId)))
      .returning();
    
    return phoneNumber || undefined;
  }
}

export const storage = new DatabaseStorage();
