import type { Express, Request, Response, NextFunction } from "express";
import { storage } from "../storage";
import { insertContactSchema, type InsertContact } from "@shared/schema";
import { requireAccess } from "../services/access-policy-evaluator";
import { z } from "zod";

type AuthMiddleware = (req: Request, res: Response, next: NextFunction) => void | Promise<any>;
type PermissionMiddleware = (permissionKey: string) => (req: Request, res: Response, next: NextFunction) => void | Promise<any>;

async function getEmployerIdFromContactId(req: Request): Promise<string | undefined> {
  const contactId = req.params.contactId || req.params.id;
  if (!contactId) return undefined;
  
  const employerContact = await storage.employerContacts.get(contactId);
  return employerContact?.employerId;
}

export function registerEmployerContactRoutes(
  app: Express, 
  requireAuth: AuthMiddleware, 
  requirePermission: PermissionMiddleware
) {
  
  // GET /api/employer-contacts - Get all employer contacts with optional filtering (requires staff policy)
  app.get("/api/employer-contacts", requireAuth, requireAccess('staff'), async (req, res) => {
    try {
      const { employerId, contactName, contactTypeId } = req.query;
      
      const filters: { employerId?: string; contactName?: string; contactTypeId?: string } = {};
      
      if (employerId && typeof employerId === 'string') {
        filters.employerId = employerId;
      }
      
      if (contactName && typeof contactName === 'string') {
        filters.contactName = contactName;
      }
      
      if (contactTypeId && typeof contactTypeId === 'string') {
        filters.contactTypeId = contactTypeId;
      }
      
      const contacts = await storage.employerContacts.getAll(filters);
      res.json(contacts);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch employer contacts" });
    }
  });
  
  // GET /api/employers/:employerId/contacts - Get all contacts for an employer
  app.get("/api/employers/:employerId/contacts", requireAuth, requireAccess('employer.mine', (req) => req.params.employerId), async (req, res) => {
    try {
      const { employerId } = req.params;
      const contacts = await storage.employerContacts.listByEmployer(employerId);
      res.json(contacts);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch employer contacts" });
    }
  });

  // POST /api/employers/:employerId/contacts - Create a new contact for an employer
  app.post("/api/employers/:employerId/contacts", requireAuth, requireAccess('employer.manage', (req) => req.params.employerId), async (req, res) => {
    try {
      const { employerId } = req.params;
      const parsed = insertContactSchema.extend({ 
        email: z.string().email("Valid email is required"),
        contactTypeId: z.string().optional().nullable()
      }).safeParse(req.body);
      
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid contact data", errors: parsed.error.errors });
      }

      const { contactTypeId, ...contactData } = parsed.data;
      
      const result = await storage.employerContacts.create({
        employerId,
        contactData: contactData as InsertContact & { email: string },
        contactTypeId: contactTypeId || null,
      });
      
      res.status(201).json(result);
    } catch (error: any) {
      if (error.message === "Email is required for employer contacts") {
        return res.status(400).json({ message: error.message });
      }
      // Handle duplicate email constraint violation
      if (error.code === '23505' && error.constraint === 'contacts_email_unique') {
        return res.status(409).json({ message: "A contact with this email already exists. Employers cannot add existing contacts, only create new ones." });
      }
      res.status(500).json({ message: "Failed to create employer contact" });
    }
  });

  // GET /api/employer-contacts/:id - Get a single employer contact
  app.get("/api/employer-contacts/:id", requireAuth, requireAccess('employer.manage', getEmployerIdFromContactId), async (req, res) => {
    try {
      const { id } = req.params;
      const employerContact = await storage.employerContacts.get(id);
      
      if (!employerContact) {
        res.status(404).json({ message: "Employer contact not found" });
        return;
      }
      
      res.json(employerContact);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch employer contact" });
    }
  });

  // PATCH /api/employer-contacts/:id - Update an employer contact
  app.patch("/api/employer-contacts/:id", requireAuth, requireAccess('employer.manage', getEmployerIdFromContactId), async (req, res) => {
    try {
      const { id } = req.params;
      const { contactTypeId, email, nameComponents } = req.body;
      
      // Handle name component updates
      if (nameComponents) {
        const updated = await storage.employerContacts.updateContactName(id, nameComponents);
        
        if (!updated) {
          res.status(404).json({ message: "Employer contact not found" });
          return;
        }
        
        res.json(updated);
        return;
      }
      
      // Validate and parse other fields
      const parsed = z.object({
        contactTypeId: z.string().uuid().nullable().optional(),
        email: z.string().email().or(z.literal("")).nullable().optional().transform(val => {
          if (val === null || val === "" || val === "null") return null;
          return val?.trim() || null;
        }),
      }).safeParse(req.body);
      
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid update data", errors: parsed.error.errors });
      }
      
      // Handle contactTypeId updates - check this FIRST before email
      if ("contactTypeId" in req.body) {
        const updateData = {
          contactTypeId: parsed.data.contactTypeId === null || parsed.data.contactTypeId === undefined 
            ? null 
            : parsed.data.contactTypeId,
        };
        
        const updated = await storage.employerContacts.update(id, updateData);
        
        if (!updated) {
          res.status(404).json({ message: "Employer contact not found" });
          return;
        }
        
        res.json(updated);
        return;
      }
      
      // Handle email updates
      if ("email" in req.body) {
        const updated = await storage.employerContacts.updateContactEmail(id, parsed.data.email);
        
        if (!updated) {
          res.status(404).json({ message: "Employer contact not found" });
          return;
        }
        
        res.json(updated);
        return;
      }
      
      res.status(400).json({ message: "No valid update fields provided" });
    } catch (error) {
      res.status(500).json({ message: "Failed to update employer contact" });
    }
  });

  // DELETE /api/employer-contacts/:id - Delete an employer contact
  app.delete("/api/employer-contacts/:id", requireAuth, requireAccess('employer.manage', getEmployerIdFromContactId), async (req, res) => {
    try {
      const { id } = req.params;
      const deleted = await storage.employerContacts.delete(id);
      
      if (!deleted) {
        res.status(404).json({ message: "Employer contact not found" });
        return;
      }
      
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Failed to delete employer contact" });
    }
  });

  // GET /api/employer-contacts/:contactId/user - Get user linked to employer contact
  app.get("/api/employer-contacts/:contactId/user", requireAccess('employer.manage', getEmployerIdFromContactId), async (req, res) => {
    try {
      const { contactId } = req.params;
      
      // Get employer contact
      const employerContact = await storage.employerContacts.get(contactId);
      if (!employerContact) {
        return res.status(404).json({ message: "Employer contact not found" });
      }
      
      // Check if contact has an email
      if (!employerContact.contact.email) {
        return res.status(400).json({ 
          message: "Contact must have an email address to link a user account",
          hasEmail: false
        });
      }
      
      // Get employer user settings (required/optional roles)
      const requiredVariable = await storage.variables.getByName('employer_user_roles_required');
      const optionalVariable = await storage.variables.getByName('employer_user_roles_optional');
      
      const requiredRoleIds: string[] = (Array.isArray(requiredVariable?.value) ? requiredVariable.value : []) as string[];
      const optionalRoleIds: string[] = (Array.isArray(optionalVariable?.value) ? optionalVariable.value : []) as string[];
      
      // Get user by email if exists
      const user = await storage.users.getUserByEmail(employerContact.contact.email);
      
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
          contactEmail: employerContact.contact.email,
        });
      } else {
        // No user exists yet
        return res.json({
          hasUser: false,
          user: null,
          userRoleIds: [],
          requiredRoleIds,
          optionalRoleIds,
          contactEmail: employerContact.contact.email,
        });
      }
    } catch (error) {
      console.error("Error fetching employer contact user:", error);
      res.status(500).json({ message: "Failed to fetch employer contact user" });
    }
  });

  // POST /api/employer-contacts/:contactId/user - Create or update user linked to employer contact
  app.post("/api/employer-contacts/:contactId/user", requireAccess('employer.manage', getEmployerIdFromContactId), async (req, res) => {
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
      
      // Get employer contact
      const employerContact = await storage.employerContacts.get(contactId);
      if (!employerContact) {
        return res.status(404).json({ message: "Employer contact not found" });
      }
      
      // Check if contact has an email
      if (!employerContact.contact.email) {
        return res.status(400).json({ 
          message: "Contact must have an email address to link a user account"
        });
      }
      
      const email = employerContact.contact.email;
      
      // Get employer user settings - both required and optional roles
      const requiredVariable = await storage.variables.getByName('employer_user_roles_required');
      const optionalVariable = await storage.variables.getByName('employer_user_roles_optional');
      
      const requiredRoleIds: string[] = (Array.isArray(requiredVariable?.value) ? requiredVariable.value : []) as string[];
      const allowedOptionalRoleIds: string[] = (Array.isArray(optionalVariable?.value) ? optionalVariable.value : []) as string[];
      
      // Validate that client-provided optional roles are actually in the allowed optional roles
      const invalidRoleIds = optionalRoleIds.filter(roleId => !allowedOptionalRoleIds.includes(roleId));
      if (invalidRoleIds.length > 0) {
        return res.status(400).json({ 
          message: "Invalid optional role IDs provided",
          invalidRoleIds
        });
      }
      
      // Check if user exists
      let user = await storage.users.getUserByEmail(email);
      
      if (!user) {
        // Create new user
        user = await storage.users.createUser({
          email,
          firstName: firstName || null,
          lastName: lastName || null,
          isActive: isActive !== undefined ? isActive : true,
          accountStatus: 'active',
        });
      } else {
        // Update existing user
        user = await storage.users.updateUser(user.id, {
          firstName: firstName !== undefined ? firstName : user.firstName,
          lastName: lastName !== undefined ? lastName : user.lastName,
          isActive: isActive !== undefined ? isActive : user.isActive,
        });
        
        if (!user) {
          return res.status(500).json({ message: "Failed to update user" });
        }
      }
      
      // Get user's current roles
      const currentRoles = await storage.users.getUserRoles(user.id);
      const currentRoleIds = currentRoles.map(r => r.id);
      
      // Assign all required roles (idempotent)
      for (const roleId of requiredRoleIds) {
        if (!currentRoleIds.includes(roleId)) {
          await storage.users.assignRoleToUser({
            userId: user.id,
            roleId,
          });
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
        }
      }
      
      // Remove optional roles that are no longer selected
      const allDesiredRoleIds = [...requiredRoleIds, ...optionalRoleIds];
      for (const roleId of currentRoleIds) {
        if (!allDesiredRoleIds.includes(roleId)) {
          // Only remove if it's not a required role
          if (!requiredRoleIds.includes(roleId)) {
            await storage.users.unassignRoleFromUser(user.id, roleId);
          }
        }
      }
      
      // Get updated user roles
      const updatedRoles = await storage.users.getUserRoles(user.id);
      const updatedRoleIds = updatedRoles.map(r => r.id);
      
      res.json({
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          isActive: user.isActive,
          accountStatus: user.accountStatus,
        },
        userRoleIds: updatedRoleIds,
      });
    } catch (error) {
      console.error("Error creating/updating employer contact user:", error);
      res.status(500).json({ message: "Failed to create or update user" });
    }
  });

  // POST /api/employer-contacts/user-status - Batch fetch user account status for multiple employer contacts
  app.post("/api/employer-contacts/user-status", requireAuth, requireAccess('staff'), async (req, res) => {
    try {
      // Validate request body with Zod
      const requestSchema = z.object({
        employerContactIds: z.array(z.string().uuid()).max(200, "Maximum 200 employer contact IDs allowed"),
      });
      
      const validationResult = requestSchema.safeParse(req.body);
      if (!validationResult.success) {
        return res.status(400).json({ 
          message: "Invalid request body", 
          errors: validationResult.error.errors 
        });
      }
      
      const { employerContactIds } = validationResult.data;
      
      // Fetch user account statuses for all employer contacts in one query
      const statuses = await storage.employerContacts.getUserAccountStatuses(employerContactIds);
      
      res.json({ statuses });
    } catch (error) {
      console.error("Error fetching employer contact user statuses:", error);
      res.status(500).json({ message: "Failed to fetch user statuses" });
    }
  });
}
