import type { Express, Request, Response, NextFunction } from "express";
import { storage } from "../storage";
import { insertContactSchema, type InsertContact } from "@shared/schema";
import { requireAccess } from "../accessControl";
import { policies } from "../policies";
import { z } from "zod";
import { storageLogger } from "../logger";

type AuthMiddleware = (req: Request, res: Response, next: NextFunction) => void | Promise<any>;
type PermissionMiddleware = (permissionKey: string) => (req: Request, res: Response, next: NextFunction) => void | Promise<any>;

export function registerTrustProviderContactRoutes(
  app: Express, 
  requireAuth: AuthMiddleware, 
  requirePermission: PermissionMiddleware
) {

  // GET /api/trust-provider-contacts - Get all provider contacts with optional filtering (requires staff policy)
  app.get("/api/trust-provider-contacts", requireAuth, requireAccess(policies.staff), async (req, res) => {
    try {
      const { providerId, contactName, contactTypeId } = req.query;
      
      const filters: { providerId?: string; contactName?: string; contactTypeId?: string } = {};
      
      if (providerId && typeof providerId === 'string') {
        filters.providerId = providerId;
      }
      
      if (contactName && typeof contactName === 'string') {
        filters.contactName = contactName;
      }
      
      if (contactTypeId && typeof contactTypeId === 'string') {
        filters.contactTypeId = contactTypeId;
      }
      
      const providerContacts = await storage.trustProviderContacts.getAll(filters);
      res.json(providerContacts);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch provider contacts" });
    }
  });

  // GET /api/trust-providers/:providerId/contacts - Get all contacts for a provider (requires staff policy)
  app.get("/api/trust-providers/:providerId/contacts", requireAuth, requireAccess(policies.staff), async (req, res) => {
    try {
      const { providerId } = req.params;
      const contacts = await storage.trustProviderContacts.listByProvider(providerId);
      res.json(contacts);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch provider contacts" });
    }
  });

  // POST /api/trust-providers/:providerId/contacts - Create a new contact for a provider (requires admin policy)
  app.post("/api/trust-providers/:providerId/contacts", requireAuth, requireAccess(policies.admin), async (req, res) => {
    try {
      const { providerId } = req.params;
      const parsed = insertContactSchema.extend({ 
        email: z.string().email("Valid email is required"),
        contactTypeId: z.string().optional().nullable()
      }).safeParse(req.body);
      
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid contact data", errors: parsed.error.errors });
      }

      const { contactTypeId, ...contactData } = parsed.data;
      
      const result = await storage.trustProviderContacts.create({
        providerId,
        contactData: contactData as InsertContact & { email: string },
        contactTypeId: contactTypeId || null,
      });
      
      res.status(201).json(result);
    } catch (error: any) {
      if (error.message === "Email is required for provider contacts") {
        return res.status(400).json({ message: error.message });
      }
      // Handle duplicate email constraint violation
      if (error.code === '23505' && error.constraint === 'contacts_email_unique') {
        return res.status(409).json({ message: "A contact with this email already exists. Providers cannot add existing contacts, only create new ones." });
      }
      res.status(500).json({ message: "Failed to create provider contact" });
    }
  });

  // GET /api/trust-provider-contacts/:id - Get a single provider contact (requires staff policy)
  app.get("/api/trust-provider-contacts/:id", requireAuth, requireAccess(policies.staff), async (req, res) => {
    try {
      const { id } = req.params;
      const providerContact = await storage.trustProviderContacts.get(id);
      
      if (!providerContact) {
        res.status(404).json({ message: "Provider contact not found" });
        return;
      }
      
      res.json(providerContact);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch provider contact" });
    }
  });

  // PATCH /api/trust-provider-contacts/:id - Update a provider contact (requires admin policy)
  app.patch("/api/trust-provider-contacts/:id", requireAuth, requireAccess(policies.admin), async (req, res) => {
    try {
      const { id } = req.params;
      const updateSchema = z.object({
        contactTypeId: z.string().nullable().optional(),
      });
      
      const parsed = updateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      }

      const result = await storage.trustProviderContacts.update(id, parsed.data);

      if (!result) {
        return res.status(404).json({ message: "Provider contact not found" });
      }

      res.json(result);
    } catch (error) {
      res.status(500).json({ message: "Failed to update provider contact" });
    }
  });

  // PATCH /api/trust-provider-contacts/:id/contact/email - Update contact email (requires admin policy)
  app.patch("/api/trust-provider-contacts/:id/contact/email", requireAuth, requireAccess(policies.admin), async (req, res) => {
    try {
      const { id } = req.params;
      const emailSchema = z.object({
        email: z.string().email("Valid email is required").nullable(),
      });

      const parsed = emailSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid email", errors: parsed.error.errors });
      }

      const { email } = parsed.data;
      const result = await storage.trustProviderContacts.updateContactEmail(id, email);

      if (!result) {
        return res.status(404).json({ message: "Provider contact not found" });
      }

      res.json(result);
    } catch (error) {
      res.status(500).json({ message: "Failed to update contact email" });
    }
  });

  // PATCH /api/trust-provider-contacts/:id/contact/name - Update contact name components (requires admin policy)
  app.patch("/api/trust-provider-contacts/:id/contact/name", requireAuth, requireAccess(policies.admin), async (req, res) => {
    try {
      const { id } = req.params;
      const nameSchema = z.object({
        title: z.string().optional(),
        given: z.string().optional(),
        middle: z.string().optional(),
        family: z.string().optional(),
        generational: z.string().optional(),
        credentials: z.string().optional(),
      });

      const parsed = nameSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid name data", errors: parsed.error.errors });
      }

      const result = await storage.trustProviderContacts.updateContactName(id, parsed.data);

      if (!result) {
        return res.status(404).json({ message: "Provider contact not found" });
      }

      res.json(result);
    } catch (error) {
      res.status(500).json({ message: "Failed to update contact name" });
    }
  });

  // GET /api/trust-provider-contacts/:contactId/user - Get user linked to provider contact
  app.get("/api/trust-provider-contacts/:contactId/user", requireAuth, requireAccess(policies.trustProviderUserManage), async (req, res) => {
    try {
      const { contactId } = req.params;
      
      // Get provider contact
      const providerContact = await storage.trustProviderContacts.get(contactId);
      if (!providerContact) {
        return res.status(404).json({ message: "Provider contact not found" });
      }
      
      // Check if contact has an email
      if (!providerContact.contact.email) {
        return res.status(400).json({ 
          message: "Contact must have an email address to link a user account",
          hasEmail: false
        });
      }
      
      // Get trust provider user settings (required/optional roles)
      const requiredVariable = await storage.variables.getByName('trust_provider_user_roles_required');
      const optionalVariable = await storage.variables.getByName('trust_provider_user_roles_optional');
      
      const requiredRoleIds: string[] = (Array.isArray(requiredVariable?.value) ? requiredVariable.value : []) as string[];
      const optionalRoleIds: string[] = (Array.isArray(optionalVariable?.value) ? optionalVariable.value : []) as string[];
      
      // Get user by email if exists
      const user = await storage.users.getUserByEmail(providerContact.contact.email);
      
      if (user) {
        // Get user's current roles
        const userRoles = await storage.users.getUserRoles(user.id);
        const userRoleIds = userRoles.map(r => r.id);
        
        return res.json({
          hasUser: true,
          user: {
            id: user.id,
            email: user.email,
            firstName: user.firstName,
            lastName: user.lastName,
            isActive: user.isActive,
            accountStatus: user.accountStatus,
          },
          userRoleIds,
          requiredRoleIds,
          optionalRoleIds,
          contactEmail: providerContact.contact.email,
        });
      } else {
        // No user exists yet
        return res.json({
          hasUser: false,
          user: null,
          userRoleIds: [],
          requiredRoleIds,
          optionalRoleIds,
          contactEmail: providerContact.contact.email,
        });
      }
    } catch (error) {
      console.error("Error fetching provider contact user:", error);
      res.status(500).json({ message: "Failed to fetch provider contact user" });
    }
  });

  // POST /api/trust-provider-contacts/:contactId/user - Create or update user linked to provider contact
  app.post("/api/trust-provider-contacts/:contactId/user", requireAuth, requireAccess(policies.trustProviderUserManage), async (req, res) => {
    try {
      const { contactId } = req.params;
      
      // Validate request body with Zod
      const requestSchema = z.object({
        firstName: z.string().optional().nullable(),
        lastName: z.string().optional().nullable(),
        isActive: z.boolean().optional(),
        optionalRoleIds: z.array(z.string()),
      });
      
      const validationResult = requestSchema.safeParse(req.body);
      if (!validationResult.success) {
        return res.status(400).json({ 
          message: "Invalid request body", 
          errors: validationResult.error.errors 
        });
      }
      
      const { firstName, lastName, isActive, optionalRoleIds } = validationResult.data;
      
      // Get provider contact
      const providerContact = await storage.trustProviderContacts.get(contactId);
      if (!providerContact) {
        return res.status(404).json({ message: "Provider contact not found" });
      }
      
      // Check if contact has an email
      if (!providerContact.contact.email) {
        return res.status(400).json({ message: "Contact must have an email address" });
      }
      
      // Get trust provider user settings (required/optional roles)
      const requiredVariable = await storage.variables.getByName('trust_provider_user_roles_required');
      const optionalVariable = await storage.variables.getByName('trust_provider_user_roles_optional');
      
      const requiredRoleIds: string[] = (Array.isArray(requiredVariable?.value) ? requiredVariable.value : []) as string[];
      const optionalRoleIdsFromSettings: string[] = (Array.isArray(optionalVariable?.value) ? optionalVariable.value : []) as string[];
      
      // Validate that all provided optional role IDs are valid
      for (const roleId of optionalRoleIds) {
        if (!optionalRoleIdsFromSettings.includes(roleId)) {
          return res.status(400).json({ 
            message: `Invalid optional role ID: ${roleId}. Role is not configured as an optional role.` 
          });
        }
      }
      
      // Check if user already exists
      let user = await storage.users.getUserByEmail(providerContact.contact.email);
      const isNewUser = !user;
      
      if (!user) {
        // Create new user
        user = await storage.users.createUser({
          email: providerContact.contact.email,
          firstName: firstName || null,
          lastName: lastName || null,
          isActive: isActive !== undefined ? isActive : true,
          accountStatus: 'active',
        });
        
        // Log user creation for trust provider
        storageLogger.info('Storage operation: trust-provider-user.create', {
          module: 'trust-provider-contacts',
          operation: 'createUser',
          entity_id: user.email,
          host_entity_id: providerContact.providerId,
          description: `Created user account "${user.email}" for trust provider contact "${providerContact.contact.displayName}"`,
          meta: {
            userId: user.id,
            contactId: providerContact.id,
            providerId: providerContact.providerId,
            after: {
              email: user.email,
              firstName: user.firstName,
              lastName: user.lastName,
              isActive: user.isActive,
              accountStatus: user.accountStatus,
            }
          }
        });
      } else {
        const beforeState = {
          firstName: user.firstName,
          lastName: user.lastName,
          isActive: user.isActive,
        };
        
        // Update existing user
        await storage.users.updateUser(user.id, {
          firstName: firstName !== undefined ? firstName : user.firstName,
          lastName: lastName !== undefined ? lastName : user.lastName,
          isActive: isActive !== undefined ? isActive : user.isActive,
        });
        
        // Log user update for trust provider
        const changes: Record<string, { from: any; to: any }> = {};
        if (firstName !== undefined && firstName !== beforeState.firstName) {
          changes.firstName = { from: beforeState.firstName, to: firstName };
        }
        if (lastName !== undefined && lastName !== beforeState.lastName) {
          changes.lastName = { from: beforeState.lastName, to: lastName };
        }
        if (isActive !== undefined && isActive !== beforeState.isActive) {
          changes.isActive = { from: beforeState.isActive, to: isActive };
        }
        
        if (Object.keys(changes).length > 0) {
          const changedFields = Object.keys(changes).join(', ');
          storageLogger.info('Storage operation: trust-provider-user.update', {
            module: 'trust-provider-contacts',
            operation: 'updateUser',
            entity_id: user.email,
            host_entity_id: providerContact.providerId,
            description: `Updated user account "${user.email}" for trust provider contact "${providerContact.contact.displayName}" (changed: ${changedFields})`,
            meta: {
              userId: user.id,
              contactId: providerContact.id,
              providerId: providerContact.providerId,
              before: beforeState,
              changes,
            }
          });
        }
      }
      
      // Get user's current roles
      const currentRoles = await storage.users.getUserRoles(user.id);
      const currentRoleIds = currentRoles.map(r => r.id);
      
      // Track roles assigned/removed for logging
      const rolesAssigned: string[] = [];
      const rolesRemoved: string[] = [];
      
      // Assign all required roles (idempotent)
      for (const roleId of requiredRoleIds) {
        if (!currentRoleIds.includes(roleId)) {
          await storage.users.assignRoleToUser({
            userId: user.id,
            roleId,
          });
          const role = await storage.users.getRole(roleId);
          if (role) {
            rolesAssigned.push(role.name);
          }
        }
      }
      
      // Reconcile optional roles
      // Add new optional roles
      for (const roleId of optionalRoleIds) {
        if (!currentRoleIds.includes(roleId) && !requiredRoleIds.includes(roleId)) {
          await storage.users.assignRoleToUser({
            userId: user.id,
            roleId,
          });
          const role = await storage.users.getRole(roleId);
          if (role) {
            rolesAssigned.push(role.name);
          }
        }
      }
      
      // Remove optional roles that are no longer selected
      // Only remove roles that are:
      // 1. Currently assigned to the user
      // 2. In the optional roles settings (removable)
      // 3. Not in the new selection
      // 4. Not required roles
      for (const currentRoleId of currentRoleIds) {
        const isOptional = optionalRoleIdsFromSettings.includes(currentRoleId);
        const isRequired = requiredRoleIds.includes(currentRoleId);
        const isStillSelected = optionalRoleIds.includes(currentRoleId);
        
        if (isOptional && !isRequired && !isStillSelected) {
          await storage.users.unassignRoleFromUser(user.id, currentRoleId);
          const role = await storage.getRole(currentRoleId);
          if (role) {
            rolesRemoved.push(role.name);
          }
        }
      }
      
      // Log role changes for trust provider
      if (rolesAssigned.length > 0) {
        storageLogger.info('Storage operation: trust-provider-user.assignRoles', {
          module: 'trust-provider-contacts',
          operation: 'assignRoles',
          entity_id: user.email,
          host_entity_id: providerContact.providerId,
          description: `Assigned role(s) to "${user.email}" for trust provider contact "${providerContact.contact.displayName}": ${rolesAssigned.join(', ')}`,
          meta: {
            userId: user.id,
            contactId: providerContact.id,
            providerId: providerContact.providerId,
            rolesAssigned,
          }
        });
      }
      
      if (rolesRemoved.length > 0) {
        storageLogger.info('Storage operation: trust-provider-user.removeRoles', {
          module: 'trust-provider-contacts',
          operation: 'removeRoles',
          entity_id: user.email,
          host_entity_id: providerContact.providerId,
          description: `Removed role(s) from "${user.email}" for trust provider contact "${providerContact.contact.displayName}": ${rolesRemoved.join(', ')}`,
          meta: {
            userId: user.id,
            contactId: providerContact.id,
            providerId: providerContact.providerId,
            rolesRemoved,
          }
        });
      }
      
      res.json({ 
        message: "User account saved successfully",
        userId: user.id,
      });
    } catch (error) {
      console.error("Error saving provider contact user:", error);
      res.status(500).json({ message: "Failed to save user account" });
    }
  });

  // DELETE /api/trust-provider-contacts/:id - Delete a provider contact (requires admin policy)
  app.delete("/api/trust-provider-contacts/:id", requireAuth, requireAccess(policies.admin), async (req, res) => {
    try {
      const { id } = req.params;
      const deleted = await storage.trustProviderContacts.delete(id);

      if (!deleted) {
        return res.status(404).json({ message: "Provider contact not found" });
      }

      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Failed to delete provider contact" });
    }
  });
}
