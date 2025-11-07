// Database storage implementation based on blueprint:javascript_database
import { 
  workers, contacts, postalAddresses, phoneNumbers, employers, trustBenefits, trustWmb, optionsGender, optionsWorkerIdType, workerIds, optionsTrustBenefitType, optionsLedgerPaymentType, bookmarks, ledgerStripePaymentMethods, ledgerAccounts,
  type User, type InsertUser, type UpsertUser, type Worker, type InsertWorker,
  type Contact, type InsertContact,
  type Role, type InsertRole, type Variable, type InsertVariable,
  type PostalAddress, type InsertPostalAddress,
  type PhoneNumber, type InsertPhoneNumber,
  type Employer, type InsertEmployer,
  type TrustBenefit, type InsertTrustBenefit,
  type TrustWmb, type InsertTrustWmb,
  type GenderOption, type InsertGenderOption,
  type WorkerIdType, type InsertWorkerIdType,
  type WorkerId, type InsertWorkerId,
  type TrustBenefitType, type InsertTrustBenefitType,
  type LedgerPaymentType, type InsertLedgerPaymentType,
  type Bookmark, type InsertBookmark,
  type LedgerStripePaymentMethod, type InsertLedgerStripePaymentMethod,
  type LedgerAccount, type InsertLedgerAccount,
  type UserRole, type RolePermission, type AssignRole, type AssignPermission
} from "@shared/schema";
import { type PermissionDefinition } from "@shared/permissions";
import { db } from "../db";
import { eq, and, desc, sql } from "drizzle-orm";
import { type VariableStorage, createVariableStorage } from "./variables";
import { type UserStorage, createUserStorage } from "./users";

// modify the interface with any CRUD methods
// you might need

export interface IStorage extends VariableStorage, UserStorage {
  // User/Role/Permission operations - inherited from UserStorage
  
  // Worker CRUD operations
  getAllWorkers(): Promise<Worker[]>;
  getWorker(id: string): Promise<Worker | undefined>;
  createWorker(name: string): Promise<Worker>;
  updateWorkerContactName(id: string, name: string): Promise<Worker | undefined>;
  updateWorkerContactNameComponents(id: string, components: {
    title?: string;
    given?: string;
    middle?: string;
    family?: string;
    generational?: string;
    credentials?: string;
  }): Promise<Worker | undefined>;
  updateWorkerContactEmail(id: string, email: string): Promise<Worker | undefined>;
  updateWorkerContactBirthDate(id: string, birthDate: string | null): Promise<Worker | undefined>;
  updateWorkerContactGender(id: string, gender: string | null, genderNota: string | null): Promise<Worker | undefined>;
  updateWorkerSSN(id: string, ssn: string): Promise<Worker | undefined>;
  deleteWorker(id: string): Promise<boolean>;

  // Employer CRUD operations
  getAllEmployers(): Promise<Employer[]>;
  getEmployer(id: string): Promise<Employer | undefined>;
  createEmployer(employer: InsertEmployer): Promise<Employer>;
  updateEmployer(id: string, employer: Partial<InsertEmployer>): Promise<Employer | undefined>;
  deleteEmployer(id: string): Promise<boolean>;

  // Trust Benefit CRUD operations
  getAllTrustBenefits(): Promise<TrustBenefit[]>;
  getTrustBenefit(id: string): Promise<TrustBenefit | undefined>;
  createTrustBenefit(benefit: InsertTrustBenefit): Promise<TrustBenefit>;
  updateTrustBenefit(id: string, benefit: Partial<InsertTrustBenefit>): Promise<TrustBenefit | undefined>;
  deleteTrustBenefit(id: string): Promise<boolean>;

  // Variable CRUD operations - inherited from VariableStorage

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

  // Gender Option CRUD operations
  getAllGenderOptions(): Promise<GenderOption[]>;
  getGenderOption(id: string): Promise<GenderOption | undefined>;
  createGenderOption(genderOption: InsertGenderOption): Promise<GenderOption>;
  updateGenderOption(id: string, genderOption: Partial<InsertGenderOption>): Promise<GenderOption | undefined>;
  deleteGenderOption(id: string): Promise<boolean>;
  updateGenderOptionSequence(id: string, sequence: number): Promise<GenderOption | undefined>;

  // Trust Benefit Type CRUD operations
  getAllTrustBenefitTypes(): Promise<TrustBenefitType[]>;
  getTrustBenefitType(id: string): Promise<TrustBenefitType | undefined>;
  createTrustBenefitType(trustBenefitType: InsertTrustBenefitType): Promise<TrustBenefitType>;
  updateTrustBenefitType(id: string, trustBenefitType: Partial<InsertTrustBenefitType>): Promise<TrustBenefitType | undefined>;
  deleteTrustBenefitType(id: string): Promise<boolean>;
  updateTrustBenefitTypeSequence(id: string, sequence: number): Promise<TrustBenefitType | undefined>;

  // Worker ID Type CRUD operations
  getAllWorkerIdTypes(): Promise<WorkerIdType[]>;
  getWorkerIdType(id: string): Promise<WorkerIdType | undefined>;
  createWorkerIdType(workerIdType: InsertWorkerIdType): Promise<WorkerIdType>;
  updateWorkerIdType(id: string, workerIdType: Partial<InsertWorkerIdType>): Promise<WorkerIdType | undefined>;
  deleteWorkerIdType(id: string): Promise<boolean>;
  updateWorkerIdTypeSequence(id: string, sequence: number): Promise<WorkerIdType | undefined>;

  // Ledger Payment Type CRUD operations
  getAllLedgerPaymentTypes(): Promise<LedgerPaymentType[]>;
  getLedgerPaymentType(id: string): Promise<LedgerPaymentType | undefined>;
  createLedgerPaymentType(paymentType: InsertLedgerPaymentType): Promise<LedgerPaymentType>;
  updateLedgerPaymentType(id: string, paymentType: Partial<InsertLedgerPaymentType>): Promise<LedgerPaymentType | undefined>;
  deleteLedgerPaymentType(id: string): Promise<boolean>;
  updateLedgerPaymentTypeSequence(id: string, sequence: number): Promise<LedgerPaymentType | undefined>;

  // Worker ID CRUD operations
  getWorkerIdsByWorkerId(workerId: string): Promise<WorkerId[]>;
  getWorkerId(id: string): Promise<WorkerId | undefined>;
  createWorkerId(workerId: InsertWorkerId): Promise<WorkerId>;
  updateWorkerId(id: string, workerId: Partial<InsertWorkerId>): Promise<WorkerId | undefined>;
  deleteWorkerId(id: string): Promise<boolean>;

  // Bookmark CRUD operations
  getUserBookmarks(userId: string): Promise<Bookmark[]>;
  getBookmark(id: string): Promise<Bookmark | undefined>;
  findBookmark(userId: string, entityType: string, entityId: string): Promise<Bookmark | undefined>;
  createBookmark(bookmark: InsertBookmark): Promise<Bookmark>;
  deleteBookmark(id: string): Promise<boolean>;

  // Ledger Stripe Payment Method CRUD operations
  getPaymentMethodsByEntity(entityType: string, entityId: string): Promise<LedgerStripePaymentMethod[]>;
  getPaymentMethod(id: string): Promise<LedgerStripePaymentMethod | undefined>;
  createPaymentMethod(paymentMethod: InsertLedgerStripePaymentMethod): Promise<LedgerStripePaymentMethod>;
  updatePaymentMethod(id: string, paymentMethod: Partial<InsertLedgerStripePaymentMethod>): Promise<LedgerStripePaymentMethod | undefined>;
  deletePaymentMethod(id: string): Promise<boolean>;
  setPaymentMethodAsDefault(id: string, entityType: string, entityId: string): Promise<LedgerStripePaymentMethod | undefined>;

  // Ledger Account CRUD operations
  getAllLedgerAccounts(): Promise<LedgerAccount[]>;
  getLedgerAccount(id: string): Promise<LedgerAccount | undefined>;
  createLedgerAccount(account: InsertLedgerAccount): Promise<LedgerAccount>;
  updateLedgerAccount(id: string, account: Partial<InsertLedgerAccount>): Promise<LedgerAccount | undefined>;
  deleteLedgerAccount(id: string): Promise<boolean>;
}

export class DatabaseStorage implements IStorage {
  private variableStorage: VariableStorage;
  private userStorage: UserStorage;

  constructor() {
    this.variableStorage = createVariableStorage();
    this.userStorage = createUserStorage();
  }

  // User operations - delegated to userStorage module
  async getUser(id: string): Promise<User | undefined> {
    return this.userStorage.getUser(id);
  }

  async getUserByReplitId(replitUserId: string): Promise<User | undefined> {
    return this.userStorage.getUserByReplitId(replitUserId);
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    return this.userStorage.getUserByEmail(email);
  }

  async upsertUser(userData: UpsertUser): Promise<User> {
    return this.userStorage.upsertUser(userData);
  }

  async linkReplitAccount(userId: string, replitUserId: string, userData: Partial<UpsertUser>): Promise<User | undefined> {
    return this.userStorage.linkReplitAccount(userId, replitUserId, userData);
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    return this.userStorage.createUser(insertUser);
  }

  async updateUser(id: string, userUpdate: Partial<InsertUser>): Promise<User | undefined> {
    return this.userStorage.updateUser(id, userUpdate);
  }

  async updateUserLastLogin(id: string): Promise<User | undefined> {
    return this.userStorage.updateUserLastLogin(id);
  }

  async deleteUser(id: string): Promise<boolean> {
    return this.userStorage.deleteUser(id);
  }

  async getAllUsers(): Promise<User[]> {
    return this.userStorage.getAllUsers();
  }

  async getAllUsersWithRoles(): Promise<(User & { roles: Role[] })[]> {
    return this.userStorage.getAllUsersWithRoles();
  }

  async hasAnyUsers(): Promise<boolean> {
    return this.userStorage.hasAnyUsers();
  }

  // Role operations - delegated to userStorage module
  async getAllRoles(): Promise<Role[]> {
    return this.userStorage.getAllRoles();
  }

  async getRole(id: string): Promise<Role | undefined> {
    return this.userStorage.getRole(id);
  }

  async createRole(insertRole: InsertRole): Promise<Role> {
    return this.userStorage.createRole(insertRole);
  }

  async updateRole(id: string, roleUpdate: Partial<InsertRole>): Promise<Role | undefined> {
    return this.userStorage.updateRole(id, roleUpdate);
  }

  async deleteRole(id: string): Promise<boolean> {
    return this.userStorage.deleteRole(id);
  }

  async updateRoleSequence(id: string, sequence: number): Promise<Role | undefined> {
    return this.userStorage.updateRoleSequence(id, sequence);
  }

  // Permission operations - delegated to userStorage module
  async getAllPermissions(): Promise<PermissionDefinition[]> {
    return this.userStorage.getAllPermissions();
  }

  async getPermissionByKey(key: string): Promise<PermissionDefinition | undefined> {
    return this.userStorage.getPermissionByKey(key);
  }

  permissionExists(key: string): boolean {
    return this.userStorage.permissionExists(key);
  }

  // User-Role assignment operations - delegated to userStorage module
  async assignRoleToUser(assignment: AssignRole): Promise<UserRole> {
    return this.userStorage.assignRoleToUser(assignment);
  }

  async unassignRoleFromUser(userId: string, roleId: string): Promise<boolean> {
    return this.userStorage.unassignRoleFromUser(userId, roleId);
  }

  async getUserRoles(userId: string): Promise<Role[]> {
    return this.userStorage.getUserRoles(userId);
  }

  async getUsersWithRole(roleId: string): Promise<User[]> {
    return this.userStorage.getUsersWithRole(roleId);
  }

  // Role-Permission assignment operations - delegated to userStorage module
  async assignPermissionToRole(assignment: AssignPermission): Promise<RolePermission> {
    return this.userStorage.assignPermissionToRole(assignment);
  }

  async unassignPermissionFromRole(roleId: string, permissionKey: string): Promise<boolean> {
    return this.userStorage.unassignPermissionFromRole(roleId, permissionKey);
  }

  async getRolePermissions(roleId: string): Promise<PermissionDefinition[]> {
    return this.userStorage.getRolePermissions(roleId);
  }

  async getRolesWithPermission(permissionKey: string): Promise<Role[]> {
    return this.userStorage.getRolesWithPermission(permissionKey);
  }

  async getAllRolePermissions(): Promise<(RolePermission & { role: Role })[]> {
    return this.userStorage.getAllRolePermissions();
  }

  // Authorization helpers - delegated to userStorage module
  async getUserPermissions(userId: string): Promise<PermissionDefinition[]> {
    return this.userStorage.getUserPermissions(userId);
  }

  async userHasPermission(userId: string, permissionKey: string): Promise<boolean> {
    return this.userStorage.userHasPermission(userId, permissionKey);
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

  async updateWorkerContactNameComponents(
    workerId: string,
    components: {
      title?: string;
      given?: string;
      middle?: string;
      family?: string;
      generational?: string;
      credentials?: string;
    }
  ): Promise<Worker | undefined> {
    // Get the current worker to find its contact
    const currentWorker = await this.getWorker(workerId);
    if (!currentWorker) {
      return undefined;
    }
    
    // Import the generateDisplayName function
    const { generateDisplayName } = await import("@shared/schema");
    
    // Generate display name from components
    const displayName = generateDisplayName(components);
    
    // Update the contact's name components
    await db
      .update(contacts)
      .set({
        title: components.title?.trim() || null,
        given: components.given?.trim() || null,
        middle: components.middle?.trim() || null,
        family: components.family?.trim() || null,
        generational: components.generational?.trim() || null,
        credentials: components.credentials?.trim() || null,
        displayName,
      })
      .where(eq(contacts.id, currentWorker.contactId));
    
    return currentWorker;
  }

  async updateWorkerContactEmail(workerId: string, email: string): Promise<Worker | undefined> {
    // Get the current worker to find its contact
    const currentWorker = await this.getWorker(workerId);
    if (!currentWorker) {
      return undefined;
    }
    
    const cleanEmail = email.trim();
    
    // Basic email validation
    if (cleanEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      throw new Error("Invalid email format");
    }
    
    // Update the contact's email
    await db
      .update(contacts)
      .set({ email: cleanEmail || null })
      .where(eq(contacts.id, currentWorker.contactId));
    
    return currentWorker;
  }

  async updateWorkerContactBirthDate(workerId: string, birthDate: string | null): Promise<Worker | undefined> {
    // Get the current worker to find its contact
    const currentWorker = await this.getWorker(workerId);
    if (!currentWorker) {
      return undefined;
    }
    
    // Validate birth date format if provided
    if (birthDate) {
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      if (!dateRegex.test(birthDate)) {
        throw new Error("Invalid date format. Expected YYYY-MM-DD");
      }
      
      // Parse and validate calendar date
      const [yearStr, monthStr, dayStr] = birthDate.split('-');
      const year = parseInt(yearStr, 10);
      const month = parseInt(monthStr, 10);
      const day = parseInt(dayStr, 10);
      
      // Validate month range
      if (month < 1 || month > 12) {
        throw new Error("Invalid month. Must be between 1 and 12");
      }
      
      // Validate day range based on month
      const daysInMonth = [31, (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
      if (day < 1 || day > daysInMonth[month - 1]) {
        throw new Error(`Invalid day. Must be between 1 and ${daysInMonth[month - 1]} for the given month`);
      }
    }
    
    // Update the contact's birth date
    await db
      .update(contacts)
      .set({ birthDate: birthDate || null })
      .where(eq(contacts.id, currentWorker.contactId));
    
    return currentWorker;
  }

  async updateWorkerContactGender(workerId: string, gender: string | null, genderNota: string | null): Promise<Worker | undefined> {
    // Get the current worker to find its contact
    const currentWorker = await this.getWorker(workerId);
    if (!currentWorker) {
      return undefined;
    }
    
    // If clearing gender, clear all gender fields
    if (!gender) {
      await db
        .update(contacts)
        .set({ 
          gender: null,
          genderNota: null,
          genderCalc: null
        })
        .where(eq(contacts.id, currentWorker.contactId));
      
      return currentWorker;
    }
    
    // Fetch the gender option to check if it's nota
    const genderOption = await this.getGenderOption(gender);
    if (!genderOption) {
      throw new Error("Invalid gender option");
    }
    
    // Calculate gender_calc based on whether it's nota or not
    let genderCalc: string;
    let finalGenderNota: string | null = null;
    
    if (genderOption.nota) {
      // For nota options, use the genderNota value
      const cleanGenderNota = genderNota?.trim() || "";
      if (!cleanGenderNota) {
        throw new Error("Gender specification is required for this option");
      }
      genderCalc = cleanGenderNota;
      finalGenderNota = cleanGenderNota;
    } else {
      // For regular options, use the option name
      genderCalc = genderOption.name;
    }
    
    // Update the contact's gender fields
    await db
      .update(contacts)
      .set({ 
        gender,
        genderNota: finalGenderNota,
        genderCalc
      })
      .where(eq(contacts.id, currentWorker.contactId));
    
    return currentWorker;
  }

  async updateWorkerSSN(workerId: string, ssn: string): Promise<Worker | undefined> {
    const cleanSSN = ssn.trim();
    
    // Allow clearing the SSN
    if (!cleanSSN) {
      const [updatedWorker] = await db
        .update(workers)
        .set({ ssn: null })
        .where(eq(workers.id, workerId))
        .returning();
      
      return updatedWorker || undefined;
    }
    
    // Import the validateSSN function
    const { validateSSN } = await import("@shared/schema");
    
    // Validate SSN format and rules
    const validation = validateSSN(cleanSSN);
    if (!validation.valid) {
      throw new Error(validation.error || "Invalid SSN");
    }
    
    try {
      // Update the worker's SSN
      const [updatedWorker] = await db
        .update(workers)
        .set({ ssn: cleanSSN })
        .where(eq(workers.id, workerId))
        .returning();
      
      return updatedWorker || undefined;
    } catch (error: any) {
      // Check for unique constraint violation
      if (error.code === '23505' && error.constraint === 'workers_ssn_unique') {
        throw new Error("This SSN is already assigned to another worker");
      }
      throw error;
    }
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

  // Employer operations
  async getAllEmployers(): Promise<Employer[]> {
    return await db.select().from(employers);
  }

  async getEmployer(id: string): Promise<Employer | undefined> {
    const [employer] = await db.select().from(employers).where(eq(employers.id, id));
    return employer || undefined;
  }

  async createEmployer(employer: InsertEmployer): Promise<Employer> {
    try {
      const [newEmployer] = await db
        .insert(employers)
        .values(employer)
        .returning();
      return newEmployer;
    } catch (error: any) {
      // Check for unique constraint violation
      if (error.code === '23505') {
        throw new Error("An employer with this ID already exists");
      }
      throw error;
    }
  }

  async updateEmployer(id: string, employer: Partial<InsertEmployer>): Promise<Employer | undefined> {
    try {
      const [updatedEmployer] = await db
        .update(employers)
        .set(employer)
        .where(eq(employers.id, id))
        .returning();
      return updatedEmployer || undefined;
    } catch (error: any) {
      // Check for unique constraint violation
      if (error.code === '23505') {
        throw new Error("An employer with this ID already exists");
      }
      throw error;
    }
  }

  async deleteEmployer(id: string): Promise<boolean> {
    const result = await db.delete(employers).where(eq(employers.id, id)).returning();
    return result.length > 0;
  }

  // Trust Benefit operations
  async getAllTrustBenefits(): Promise<any[]> {
    const results = await db
      .select({
        id: trustBenefits.id,
        name: trustBenefits.name,
        benefitType: trustBenefits.benefitType,
        benefitTypeName: optionsTrustBenefitType.name,
        isActive: trustBenefits.isActive,
        description: trustBenefits.description,
      })
      .from(trustBenefits)
      .leftJoin(optionsTrustBenefitType, eq(trustBenefits.benefitType, optionsTrustBenefitType.id));
    return results;
  }

  async getTrustBenefit(id: string): Promise<any | undefined> {
    const [benefit] = await db
      .select({
        id: trustBenefits.id,
        name: trustBenefits.name,
        benefitType: trustBenefits.benefitType,
        benefitTypeName: optionsTrustBenefitType.name,
        isActive: trustBenefits.isActive,
        description: trustBenefits.description,
      })
      .from(trustBenefits)
      .leftJoin(optionsTrustBenefitType, eq(trustBenefits.benefitType, optionsTrustBenefitType.id))
      .where(eq(trustBenefits.id, id));
    return benefit || undefined;
  }

  async createTrustBenefit(benefit: InsertTrustBenefit): Promise<TrustBenefit> {
    try {
      const [newBenefit] = await db
        .insert(trustBenefits)
        .values(benefit)
        .returning();
      return newBenefit;
    } catch (error: any) {
      // Check for unique constraint violation
      if (error.code === '23505') {
        throw new Error("A trust benefit with this ID already exists");
      }
      throw error;
    }
  }

  async updateTrustBenefit(id: string, benefit: Partial<InsertTrustBenefit>): Promise<TrustBenefit | undefined> {
    try {
      const [updatedBenefit] = await db
        .update(trustBenefits)
        .set(benefit)
        .where(eq(trustBenefits.id, id))
        .returning();
      return updatedBenefit || undefined;
    } catch (error: any) {
      // Check for unique constraint violation
      if (error.code === '23505') {
        throw new Error("A trust benefit with this ID already exists");
      }
      throw error;
    }
  }

  async deleteTrustBenefit(id: string): Promise<boolean> {
    const result = await db.delete(trustBenefits).where(eq(trustBenefits.id, id)).returning();
    return result.length > 0;
  }

  // Contact operations
  async getContact(id: string): Promise<Contact | undefined> {
    const [contact] = await db.select().from(contacts).where(eq(contacts.id, id));
    return contact || undefined;
  }

  // Variable operations - delegated to variableStorage module
  async getAllVariables(): Promise<Variable[]> {
    return this.variableStorage.getAllVariables();
  }

  async getVariable(id: string): Promise<Variable | undefined> {
    return this.variableStorage.getVariable(id);
  }

  async getVariableByName(name: string): Promise<Variable | undefined> {
    return this.variableStorage.getVariableByName(name);
  }

  async createVariable(variable: InsertVariable): Promise<Variable> {
    return this.variableStorage.createVariable(variable);
  }

  async updateVariable(id: string, variable: Partial<InsertVariable>): Promise<Variable | undefined> {
    return this.variableStorage.updateVariable(id, variable);
  }

  async deleteVariable(id: string): Promise<boolean> {
    return this.variableStorage.deleteVariable(id);
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

  // Gender Option CRUD operations
  async getAllGenderOptions(): Promise<GenderOption[]> {
    return db.select().from(optionsGender).orderBy(optionsGender.sequence);
  }

  async getGenderOption(id: string): Promise<GenderOption | undefined> {
    const [genderOption] = await db.select().from(optionsGender).where(eq(optionsGender.id, id));
    return genderOption || undefined;
  }

  async createGenderOption(insertGenderOption: InsertGenderOption): Promise<GenderOption> {
    const [genderOption] = await db
      .insert(optionsGender)
      .values(insertGenderOption)
      .returning();
    return genderOption;
  }

  async updateGenderOption(id: string, genderOptionUpdate: Partial<InsertGenderOption>): Promise<GenderOption | undefined> {
    const [genderOption] = await db
      .update(optionsGender)
      .set(genderOptionUpdate)
      .where(eq(optionsGender.id, id))
      .returning();
    return genderOption || undefined;
  }

  async deleteGenderOption(id: string): Promise<boolean> {
    const result = await db.delete(optionsGender).where(eq(optionsGender.id, id)).returning();
    return result.length > 0;
  }

  async updateGenderOptionSequence(id: string, sequence: number): Promise<GenderOption | undefined> {
    return this.updateGenderOption(id, { sequence });
  }

  // Worker ID Type CRUD operations
  async getAllWorkerIdTypes(): Promise<WorkerIdType[]> {
    return db.select().from(optionsWorkerIdType).orderBy(optionsWorkerIdType.sequence);
  }

  async getWorkerIdType(id: string): Promise<WorkerIdType | undefined> {
    const [workerIdType] = await db.select().from(optionsWorkerIdType).where(eq(optionsWorkerIdType.id, id));
    return workerIdType || undefined;
  }

  async createWorkerIdType(insertWorkerIdType: InsertWorkerIdType): Promise<WorkerIdType> {
    const [workerIdType] = await db
      .insert(optionsWorkerIdType)
      .values(insertWorkerIdType)
      .returning();
    return workerIdType;
  }

  async updateWorkerIdType(id: string, workerIdTypeUpdate: Partial<InsertWorkerIdType>): Promise<WorkerIdType | undefined> {
    const [workerIdType] = await db
      .update(optionsWorkerIdType)
      .set(workerIdTypeUpdate)
      .where(eq(optionsWorkerIdType.id, id))
      .returning();
    return workerIdType || undefined;
  }

  async deleteWorkerIdType(id: string): Promise<boolean> {
    const result = await db.delete(optionsWorkerIdType).where(eq(optionsWorkerIdType.id, id)).returning();
    return result.length > 0;
  }

  async updateWorkerIdTypeSequence(id: string, sequence: number): Promise<WorkerIdType | undefined> {
    return this.updateWorkerIdType(id, { sequence });
  }

  // Ledger Payment Type CRUD operations
  async getAllLedgerPaymentTypes(): Promise<LedgerPaymentType[]> {
    return db.select().from(optionsLedgerPaymentType).orderBy(optionsLedgerPaymentType.sequence);
  }

  async getLedgerPaymentType(id: string): Promise<LedgerPaymentType | undefined> {
    const [paymentType] = await db.select().from(optionsLedgerPaymentType).where(eq(optionsLedgerPaymentType.id, id));
    return paymentType || undefined;
  }

  async createLedgerPaymentType(insertPaymentType: InsertLedgerPaymentType): Promise<LedgerPaymentType> {
    const [paymentType] = await db
      .insert(optionsLedgerPaymentType)
      .values(insertPaymentType)
      .returning();
    return paymentType;
  }

  async updateLedgerPaymentType(id: string, paymentTypeUpdate: Partial<InsertLedgerPaymentType>): Promise<LedgerPaymentType | undefined> {
    const [paymentType] = await db
      .update(optionsLedgerPaymentType)
      .set(paymentTypeUpdate)
      .where(eq(optionsLedgerPaymentType.id, id))
      .returning();
    return paymentType || undefined;
  }

  async deleteLedgerPaymentType(id: string): Promise<boolean> {
    const result = await db.delete(optionsLedgerPaymentType).where(eq(optionsLedgerPaymentType.id, id)).returning();
    return result.length > 0;
  }

  async updateLedgerPaymentTypeSequence(id: string, sequence: number): Promise<LedgerPaymentType | undefined> {
    return this.updateLedgerPaymentType(id, { sequence });
  }

  // Worker ID CRUD operations
  async getWorkerIdsByWorkerId(workerId: string): Promise<WorkerId[]> {
    return db.select().from(workerIds).where(eq(workerIds.workerId, workerId));
  }

  async getWorkerId(id: string): Promise<WorkerId | undefined> {
    const [workerId] = await db.select().from(workerIds).where(eq(workerIds.id, id));
    return workerId || undefined;
  }

  async createWorkerId(insertWorkerId: InsertWorkerId): Promise<WorkerId> {
    const [workerId] = await db
      .insert(workerIds)
      .values(insertWorkerId)
      .returning();
    return workerId;
  }

  async updateWorkerId(id: string, workerIdUpdate: Partial<InsertWorkerId>): Promise<WorkerId | undefined> {
    const [workerId] = await db
      .update(workerIds)
      .set(workerIdUpdate)
      .where(eq(workerIds.id, id))
      .returning();
    return workerId || undefined;
  }

  async deleteWorkerId(id: string): Promise<boolean> {
    const result = await db.delete(workerIds).where(eq(workerIds.id, id)).returning();
    return result.length > 0;
  }

  // Trust Benefit Type CRUD operations
  async getAllTrustBenefitTypes(): Promise<TrustBenefitType[]> {
    return db.select().from(optionsTrustBenefitType).orderBy(optionsTrustBenefitType.sequence);
  }

  async getTrustBenefitType(id: string): Promise<TrustBenefitType | undefined> {
    const [trustBenefitType] = await db.select().from(optionsTrustBenefitType).where(eq(optionsTrustBenefitType.id, id));
    return trustBenefitType || undefined;
  }

  async createTrustBenefitType(insertTrustBenefitType: InsertTrustBenefitType): Promise<TrustBenefitType> {
    const [trustBenefitType] = await db
      .insert(optionsTrustBenefitType)
      .values(insertTrustBenefitType)
      .returning();
    return trustBenefitType;
  }

  async updateTrustBenefitType(id: string, trustBenefitTypeUpdate: Partial<InsertTrustBenefitType>): Promise<TrustBenefitType | undefined> {
    const [trustBenefitType] = await db
      .update(optionsTrustBenefitType)
      .set(trustBenefitTypeUpdate)
      .where(eq(optionsTrustBenefitType.id, id))
      .returning();
    return trustBenefitType || undefined;
  }

  async deleteTrustBenefitType(id: string): Promise<boolean> {
    const result = await db.delete(optionsTrustBenefitType).where(eq(optionsTrustBenefitType.id, id)).returning();
    return result.length > 0;
  }

  async updateTrustBenefitTypeSequence(id: string, sequence: number): Promise<TrustBenefitType | undefined> {
    return this.updateTrustBenefitType(id, { sequence });
  }

  // Trust WMB (Worker Month Benefit) methods
  async getWorkerBenefits(workerId: string): Promise<(TrustWmb & { worker: Worker; employer: Employer; benefit: TrustBenefit })[]> {
    const result = await db
      .select({
        id: trustWmb.id,
        month: trustWmb.month,
        year: trustWmb.year,
        workerId: trustWmb.workerId,
        employerId: trustWmb.employerId,
        benefitId: trustWmb.benefitId,
        worker: {
          id: workers.id,
          siriusId: workers.siriusId,
          contactId: workers.contactId,
          ssn: workers.ssn,
        },
        employer: {
          id: employers.id,
          siriusId: employers.siriusId,
          name: employers.name,
          isActive: employers.isActive,
          stripeCustomerId: employers.stripeCustomerId,
        },
        benefit: {
          id: trustBenefits.id,
          name: trustBenefits.name,
          benefitType: trustBenefits.benefitType,
          isActive: trustBenefits.isActive,
          description: trustBenefits.description,
        }
      })
      .from(trustWmb)
      .innerJoin(workers, eq(trustWmb.workerId, workers.id))
      .innerJoin(employers, eq(trustWmb.employerId, employers.id))
      .innerJoin(trustBenefits, eq(trustWmb.benefitId, trustBenefits.id))
      .where(eq(trustWmb.workerId, workerId))
      .orderBy(desc(trustWmb.year), desc(trustWmb.month));

    return result.map(row => ({
      id: row.id,
      month: row.month,
      year: row.year,
      workerId: row.workerId,
      employerId: row.employerId,
      benefitId: row.benefitId,
      worker: row.worker,
      employer: row.employer,
      benefit: row.benefit,
    }));
  }

  async createWorkerBenefit(insertWmb: InsertTrustWmb): Promise<TrustWmb> {
    const [wmb] = await db
      .insert(trustWmb)
      .values(insertWmb)
      .returning();
    return wmb;
  }

  async deleteWorkerBenefit(id: string): Promise<boolean> {
    const result = await db.delete(trustWmb).where(eq(trustWmb.id, id)).returning();
    return result.length > 0;
  }

  // Bookmark CRUD operations
  async getUserBookmarks(userId: string): Promise<Bookmark[]> {
    return db.select().from(bookmarks).where(eq(bookmarks.userId, userId)).orderBy(desc(bookmarks.createdAt));
  }

  async getBookmark(id: string): Promise<Bookmark | undefined> {
    const [bookmark] = await db.select().from(bookmarks).where(eq(bookmarks.id, id));
    return bookmark || undefined;
  }

  async findBookmark(userId: string, entityType: string, entityId: string): Promise<Bookmark | undefined> {
    const [bookmark] = await db
      .select()
      .from(bookmarks)
      .where(
        and(
          eq(bookmarks.userId, userId),
          eq(bookmarks.entityType, entityType),
          eq(bookmarks.entityId, entityId)
        )
      );
    return bookmark || undefined;
  }

  async createBookmark(insertBookmark: InsertBookmark): Promise<Bookmark> {
    const [bookmark] = await db
      .insert(bookmarks)
      .values(insertBookmark)
      .returning();
    return bookmark;
  }

  async deleteBookmark(id: string): Promise<boolean> {
    const result = await db.delete(bookmarks).where(eq(bookmarks.id, id)).returning();
    return result.length > 0;
  }

  // Ledger Stripe Payment Method CRUD operations
  async getPaymentMethodsByEntity(entityType: string, entityId: string): Promise<LedgerStripePaymentMethod[]> {
    return await db.select().from(ledgerStripePaymentMethods)
      .where(and(
        eq(ledgerStripePaymentMethods.entityType, entityType),
        eq(ledgerStripePaymentMethods.entityId, entityId)
      ))
      .orderBy(desc(ledgerStripePaymentMethods.isDefault), desc(ledgerStripePaymentMethods.createdAt));
  }

  async getPaymentMethod(id: string): Promise<LedgerStripePaymentMethod | undefined> {
    const [paymentMethod] = await db.select().from(ledgerStripePaymentMethods)
      .where(eq(ledgerStripePaymentMethods.id, id));
    return paymentMethod || undefined;
  }

  async createPaymentMethod(insertPaymentMethod: InsertLedgerStripePaymentMethod): Promise<LedgerStripePaymentMethod> {
    const [paymentMethod] = await db.insert(ledgerStripePaymentMethods)
      .values(insertPaymentMethod)
      .returning();
    return paymentMethod;
  }

  async updatePaymentMethod(id: string, paymentMethodUpdate: Partial<InsertLedgerStripePaymentMethod>): Promise<LedgerStripePaymentMethod | undefined> {
    const [paymentMethod] = await db.update(ledgerStripePaymentMethods)
      .set(paymentMethodUpdate)
      .where(eq(ledgerStripePaymentMethods.id, id))
      .returning();
    return paymentMethod || undefined;
  }

  async deletePaymentMethod(id: string): Promise<boolean> {
    const result = await db.delete(ledgerStripePaymentMethods)
      .where(eq(ledgerStripePaymentMethods.id, id))
      .returning();
    return result.length > 0;
  }

  async setPaymentMethodAsDefault(id: string, entityType: string, entityId: string): Promise<LedgerStripePaymentMethod | undefined> {
    // First, unset all other payment methods as default for this entity
    await db.update(ledgerStripePaymentMethods)
      .set({ isDefault: false })
      .where(and(
        eq(ledgerStripePaymentMethods.entityType, entityType),
        eq(ledgerStripePaymentMethods.entityId, entityId)
      ));
    
    // Then set the specified payment method as default
    const [paymentMethod] = await db.update(ledgerStripePaymentMethods)
      .set({ isDefault: true })
      .where(eq(ledgerStripePaymentMethods.id, id))
      .returning();
    return paymentMethod || undefined;
  }

  // Ledger Account CRUD operations
  async getAllLedgerAccounts(): Promise<LedgerAccount[]> {
    const results = await db.select().from(ledgerAccounts);
    return results;
  }

  async getLedgerAccount(id: string): Promise<LedgerAccount | undefined> {
    const [account] = await db.select().from(ledgerAccounts).where(eq(ledgerAccounts.id, id));
    return account || undefined;
  }

  async createLedgerAccount(insertAccount: InsertLedgerAccount): Promise<LedgerAccount> {
    const [account] = await db.insert(ledgerAccounts).values(insertAccount).returning();
    return account;
  }

  async updateLedgerAccount(id: string, accountUpdate: Partial<InsertLedgerAccount>): Promise<LedgerAccount | undefined> {
    const [account] = await db.update(ledgerAccounts)
      .set(accountUpdate)
      .where(eq(ledgerAccounts.id, id))
      .returning();
    return account || undefined;
  }

  async deleteLedgerAccount(id: string): Promise<boolean> {
    const result = await db.delete(ledgerAccounts).where(eq(ledgerAccounts.id, id));
    return result.rowCount ? result.rowCount > 0 : false;
  }
}

export const storage = new DatabaseStorage();
