import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { db } from "./db";
import { insertWorkerSchema, insertTrustBenefitTypeSchema, insertTrustBenefitSchema, insertContactSchema, insertWorkerWsSchema, updateWorkerWsSchema, insertEmploymentStatusSchema, updateEmploymentStatusSchema, type InsertEmployer, type InsertTrustBenefit, type InsertContact, winstonLogs, type WorkerId, type PostalAddress, type PhoneNumber } from "@shared/schema";
import { eq, and, inArray, gte, lte, desc } from "drizzle-orm";
import { z } from "zod";
import { registerUserRoutes } from "./modules/users";
import { registerVariableRoutes } from "./modules/variables";
import { registerPostalAddressRoutes } from "./modules/postal-addresses";
import { registerPhoneNumberRoutes } from "./modules/phone-numbers";
import { registerAddressValidationRoutes } from "./modules/address-validation";
import { registerMasqueradeRoutes, getEffectiveUser } from "./modules/masquerade";
import { registerDashboardRoutes } from "./modules/dashboard";
import { registerBookmarkRoutes } from "./modules/bookmarks";
import { registerComponentRoutes } from "./modules/components";
import { registerEmployerUserSettingsRoutes } from "./modules/employer-user-settings";
import { registerLedgerStripeRoutes } from "./modules/ledger/stripe";
import { registerLedgerAccountRoutes } from "./modules/ledger/accounts";
import { registerAccessPolicyRoutes } from "./modules/access-policies";
import { registerLogRoutes } from "./modules/logs";
import { requireAccess } from "./accessControl";
import { policies } from "./policies";
import { addressValidationService } from "./services/address-validation";
import { phoneValidationService } from "./services/phone-validation";
import { isAuthenticated } from "./replitAuth";

// Authentication middleware
const requireAuth = isAuthenticated;

// Permission middleware
const requirePermission = (permissionKey: string) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    const user = req.user as any;
    if (!user || !user.claims) {
      return res.status(401).json({ message: "Authentication required" });
    }
    
    // Get database user ID from Replit user ID
    const replitUserId = user.claims.sub;
    const dbUser = await storage.users.getUserByReplitId(replitUserId);
    if (!dbUser) {
      return res.status(401).json({ message: "User not found" });
    }
    
    const hasPermission = await storage.users.userHasPermission(dbUser.id, permissionKey);
    if (!hasPermission) {
      return res.status(403).json({ message: "Insufficient permissions" });
    }
    
    next();
  };
};

export async function registerRoutes(app: Express): Promise<Server> {
  // Unauthorized route for failed logins
  app.get("/unauthorized", (req, res) => {
    res.status(401).send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Unauthorized</title>
          <style>
            body {
              font-family: system-ui, -apple-system, sans-serif;
              display: flex;
              align-items: center;
              justify-content: center;
              min-height: 100vh;
              margin: 0;
              background: #f5f5f5;
            }
            .container {
              text-align: center;
              padding: 2rem;
              background: white;
              border-radius: 8px;
              box-shadow: 0 2px 8px rgba(0,0,0,0.1);
              max-width: 500px;
            }
            h1 { color: #d32f2f; margin-bottom: 1rem; }
            p { color: #666; line-height: 1.6; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>Access Denied</h1>
            <p>You do not have permission to access this application.</p>
            <p>Please contact an administrator to set up your account.</p>
          </div>
        </body>
      </html>
    `);
  });

  // GET /api/bootstrap/needed - Check if bootstrap is needed (no users in database)
  app.get("/api/bootstrap/needed", async (req, res) => {
    try {
      const hasUsers = await storage.users.hasAnyUsers();
      res.json({ needed: !hasUsers });
    } catch (error) {
      res.status(500).json({ message: "Failed to check bootstrap status" });
    }
  });

  // POST /api/bootstrap - Create admin role with all permissions and first user (only if no users exist)
  app.post("/api/bootstrap", async (req, res) => {
    try {
      const { email, firstName, lastName } = req.body;

      if (!email) {
        return res.status(400).json({ message: "Email is required" });
      }

      // Check if any users already exist
      const hasUsers = await storage.users.hasAnyUsers();
      if (hasUsers) {
        return res.status(403).json({ message: "Bootstrap is only allowed when no users exist" });
      }

      // Get all permissions from the registry
      const allPermissions = await storage.users.getAllPermissions();

      // Create admin role
      const adminRole = await storage.users.createRole({
        name: "admin",
        description: "Administrator role with all permissions"
      });

      // Assign all permissions to admin role
      for (const permission of allPermissions) {
        await storage.users.assignPermissionToRole({
          roleId: adminRole.id,
          permissionKey: permission.key
        });
      }

      // Create first user
      const newUser = await storage.users.createUser({
        email,
        firstName: firstName || null,
        lastName: lastName || null,
        replitUserId: null,
        accountStatus: 'pending',
        isActive: true
      });

      // Assign admin role to user
      await storage.users.assignRoleToUser({
        userId: newUser.id,
        roleId: adminRole.id
      });

      res.json({
        message: "Bootstrap completed successfully",
        user: {
          id: newUser.id,
          email: newUser.email,
          firstName: newUser.firstName,
          lastName: newUser.lastName
        },
        role: {
          id: adminRole.id,
          name: adminRole.name
        }
      });
    } catch (error) {
      console.error("Bootstrap error:", error);
      res.status(500).json({ message: "Failed to complete bootstrap" });
    }
  });

  // GET /api/auth/user - Get current user from database
  app.get("/api/auth/user", requireAuth, async (req, res) => {
    try {
      const user = req.user as any;
      const replitUserId = user.claims.sub;
      const session = req.session as any;
      
      // Get effective user (handles masquerading)
      const { dbUser, originalUser } = await getEffectiveUser(session, replitUserId);
      
      if (!dbUser) {
        return res.status(404).json({ message: "User not found" });
      }

      const userPermissions = await storage.users.getUserPermissions(dbUser.id);
      
      res.json({
        user: { 
          id: dbUser.id, 
          email: dbUser.email,
          firstName: dbUser.firstName,
          lastName: dbUser.lastName,
          profileImageUrl: dbUser.profileImageUrl,
          isActive: dbUser.isActive 
        },
        permissions: userPermissions.map(p => p.key),
        masquerade: session.masqueradeUserId ? {
          isMasquerading: true,
          originalUser: originalUser ? {
            id: originalUser.id,
            email: originalUser.email,
            firstName: originalUser.firstName,
            lastName: originalUser.lastName,
          } : null
        } : {
          isMasquerading: false
        }
      });
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch user info" });
    }
  });

  // Register access policy evaluation routes
  registerAccessPolicyRoutes(app);
  
  // Register masquerade routes
  registerMasqueradeRoutes(app, requireAuth, requirePermission);
  
  // Register user management routes
  registerUserRoutes(app, requireAuth, requirePermission);
  
  // Register employer user settings routes
  registerEmployerUserSettingsRoutes(app, requireAuth, requirePermission);
  
  // Register postal address management routes
  registerPostalAddressRoutes(app, requireAuth, requirePermission);
  
  // Register phone number management routes
  registerPhoneNumberRoutes(app, requireAuth, requirePermission);
  
  // Register address validation routes
  registerAddressValidationRoutes(app, requireAuth, requirePermission);
  
  // Register dashboard routes
  registerDashboardRoutes(app, requireAuth, requirePermission);
  
  // Register bookmark routes
  registerBookmarkRoutes(app, requireAuth, requirePermission);

  // Register component configuration routes
  registerComponentRoutes(app, requireAuth, requirePermission);

  // Register ledger/stripe routes
  registerLedgerStripeRoutes(app);

  // Register ledger/accounts routes
  registerLedgerAccountRoutes(app);

  // Register log management routes
  registerLogRoutes(app);

  // Worker routes (protected with authentication and permissions)
  
  // GET /api/workers - Get all workers (requires workers.view permission)
  app.get("/api/workers", requireAuth, requirePermission("workers.view"), async (req, res) => {
    try {
      const workers = await storage.workers.getAllWorkers();
      res.json(workers);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch workers" });
    }
  });

  // GET /api/workers/:id - Get a specific worker (requires worker policy: staff or worker with matching email)
  app.get("/api/workers/:id", requireAccess(policies.worker), async (req, res) => {
    try {
      const { id } = req.params;
      const worker = await storage.workers.getWorker(id);
      
      if (!worker) {
        res.status(404).json({ message: "Worker not found" });
        return;
      }
      
      res.json(worker);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch worker" });
    }
  });

  // POST /api/workers - Create a new worker (requires workers.manage permission)
  app.post("/api/workers", requireAuth, requirePermission("workers.manage"), async (req, res) => {
    try {
      const { name } = req.body;
      if (!name || typeof name !== 'string' || !name.trim()) {
        return res.status(400).json({ message: "Worker name is required" });
      }
      const worker = await storage.workers.createWorker(name.trim());
      res.status(201).json(worker);
    } catch (error) {
      res.status(500).json({ message: "Failed to create worker" });
    }
  });

  // PUT /api/workers/:id - Update a worker's contact name, email, birth date, SSN, or gender (requires workers.manage permission)
  app.put("/api/workers/:id", requireAuth, requirePermission("workers.manage"), async (req, res) => {
    try {
      const { id } = req.params;
      const { name, nameComponents, email, birthDate, ssn, gender, genderNota } = req.body;
      
      // Handle email updates
      if (email !== undefined) {
        const worker = await storage.workers.updateWorkerContactEmail(id, email);
        
        if (!worker) {
          res.status(404).json({ message: "Worker not found" });
          return;
        }
        
        res.json(worker);
      }
      // Handle birth date updates
      else if (birthDate !== undefined) {
        const worker = await storage.workers.updateWorkerContactBirthDate(id, birthDate);
        
        if (!worker) {
          res.status(404).json({ message: "Worker not found" });
          return;
        }
        
        res.json(worker);
      }
      // Handle SSN updates
      else if (ssn !== undefined) {
        try {
          const worker = await storage.workers.updateWorkerSSN(id, ssn);
          
          if (!worker) {
            res.status(404).json({ message: "Worker not found" });
            return;
          }
          
          res.json(worker);
        } catch (error: any) {
          if (error.message === "SSN already exists for another worker") {
            res.status(409).json({ message: "This SSN is already assigned to another worker" });
            return;
          }
          throw error;
        }
      }
      // Handle gender updates
      else if (gender !== undefined || genderNota !== undefined) {
        const worker = await storage.workers.updateWorkerContactGender(id, gender, genderNota);
        
        if (!worker) {
          res.status(404).json({ message: "Worker not found" });
          return;
        }
        
        res.json(worker);
      }
      // Support both old format (name) and new format (nameComponents)
      else if (nameComponents) {
        // New format: name components
        const worker = await storage.workers.updateWorkerContactNameComponents(id, nameComponents);
        
        if (!worker) {
          res.status(404).json({ message: "Worker not found" });
          return;
        }
        
        res.json(worker);
      } else if (name && typeof name === 'string' && name.trim()) {
        // Old format: simple name string (for backwards compatibility)
        const worker = await storage.workers.updateWorkerContactName(id, name.trim());
        
        if (!worker) {
          res.status(404).json({ message: "Worker not found" });
          return;
        }
        
        res.json(worker);
      } else {
        return res.status(400).json({ message: "Worker name, name components, email, birth date, or SSN are required" });
      }
    } catch (error) {
      res.status(500).json({ message: "Failed to update worker" });
    }
  });

  // DELETE /api/workers/:id - Delete a worker (requires workers.manage permission)
  app.delete("/api/workers/:id", requireAuth, requirePermission("workers.manage"), async (req, res) => {
    try {
      const { id } = req.params;
      const deleted = await storage.workers.deleteWorker(id);
      
      if (!deleted) {
        res.status(404).json({ message: "Worker not found" });
        return;
      }
      
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Failed to delete worker" });
    }
  });

  // Employer routes (protected with authentication and permissions)
  
  // GET /api/employers - Get all employers (requires employersView policy)
  app.get("/api/employers", requireAuth, requireAccess(policies.employersView), async (req, res) => {
    try {
      const includeInactive = req.query.includeInactive === 'true';
      const allEmployers = await storage.employers.getAllEmployers();
      
      // Filter to active only by default
      const employers = includeInactive 
        ? allEmployers 
        : allEmployers.filter(emp => emp.isActive);
      
      res.json(employers);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch employers" });
    }
  });

  // GET /api/employers/:id - Get a specific employer (requires employerUser policy)
  app.get("/api/employers/:id", requireAuth, requireAccess(policies.employerUser), async (req, res) => {
    try {
      const { id } = req.params;
      const employer = await storage.employers.getEmployer(id);
      
      if (!employer) {
        res.status(404).json({ message: "Employer not found" });
        return;
      }
      
      res.json(employer);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch employer" });
    }
  });

  // POST /api/employers - Create a new employer (requires workers.manage permission)
  app.post("/api/employers", requireAuth, requirePermission("workers.manage"), async (req, res) => {
    try {
      const { name, isActive = true } = req.body;
      
      if (!name || typeof name !== 'string' || !name.trim()) {
        return res.status(400).json({ message: "Employer name is required" });
      }
      
      const employer = await storage.employers.createEmployer({ 
        name: name.trim(),
        isActive: typeof isActive === 'boolean' ? isActive : true
      });
      
      res.status(201).json(employer);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to create employer" });
    }
  });

  // PUT /api/employers/:id - Update an employer (requires workers.manage permission)
  app.put("/api/employers/:id", requireAuth, requirePermission("workers.manage"), async (req, res) => {
    try {
      const { id } = req.params;
      const { name, isActive } = req.body;
      
      const updates: Partial<InsertEmployer> = {};
      
      if (name !== undefined) {
        if (!name || typeof name !== 'string' || !name.trim()) {
          return res.status(400).json({ message: "Employer name cannot be empty" });
        }
        updates.name = name.trim();
      }
      
      if (isActive !== undefined) {
        if (typeof isActive !== 'boolean') {
          return res.status(400).json({ message: "isActive must be a boolean" });
        }
        updates.isActive = isActive;
      }
      
      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ message: "No fields to update" });
      }
      
      const employer = await storage.employers.updateEmployer(id, updates);
      
      if (!employer) {
        res.status(404).json({ message: "Employer not found" });
        return;
      }
      
      res.json(employer);
    } catch (error) {
      res.status(500).json({ message: "Failed to update employer" });
    }
  });

  // DELETE /api/employers/:id - Delete an employer (requires workers.manage permission)
  app.delete("/api/employers/:id", requireAuth, requirePermission("workers.manage"), async (req, res) => {
    try {
      const { id } = req.params;
      const deleted = await storage.employers.deleteEmployer(id);
      
      if (!deleted) {
        res.status(404).json({ message: "Employer not found" });
        return;
      }
      
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Failed to delete employer" });
    }
  });

  // Employer Contacts routes
  
  // GET /api/employer-contacts - Get all employer contacts with optional filtering (requires staff policy)
  app.get("/api/employer-contacts", requireAuth, requireAccess(policies.staff), async (req, res) => {
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
  
  // GET /api/employers/:employerId/contacts - Get all contacts for an employer (requires employersView policy)
  app.get("/api/employers/:employerId/contacts", requireAuth, requireAccess(policies.employersView), async (req, res) => {
    try {
      const { employerId } = req.params;
      const contacts = await storage.employerContacts.listByEmployer(employerId);
      res.json(contacts);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch employer contacts" });
    }
  });

  // POST /api/employers/:employerId/contacts - Create a new contact for an employer (requires workers.manage permission)
  app.post("/api/employers/:employerId/contacts", requireAuth, requirePermission("workers.manage"), async (req, res) => {
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

  // GET /api/employer-contacts/:id - Get a single employer contact (requires workers.view or workers.manage permission)
  app.get("/api/employer-contacts/:id", requireAuth, requirePermission("workers.view"), async (req, res) => {
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

  // PATCH /api/employer-contacts/:id - Update an employer contact (requires workers.manage permission)
  app.patch("/api/employer-contacts/:id", requireAuth, requirePermission("workers.manage"), async (req, res) => {
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

  // DELETE /api/employer-contacts/:id - Delete an employer contact (requires workers.manage permission)
  app.delete("/api/employer-contacts/:id", requireAuth, requirePermission("workers.manage"), async (req, res) => {
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
  app.get("/api/employer-contacts/:contactId/user", requireAccess(policies.employerUserManage), async (req, res) => {
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
  app.post("/api/employer-contacts/:contactId/user", requireAccess(policies.employerUserManage), async (req, res) => {
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
  app.post("/api/employer-contacts/user-status", requireAuth, requireAccess(policies.employerUserManage), async (req, res) => {
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

  // GET /api/trust-benefits - Get all trust benefits (requires workers.view permission)
  app.get("/api/trust-benefits", requireAuth, requirePermission("workers.view"), async (req, res) => {
    try {
      const includeInactive = req.query.includeInactive === 'true';
      const allBenefits = await storage.trustBenefits.getAllTrustBenefits();
      
      const benefits = includeInactive 
        ? allBenefits 
        : allBenefits.filter(benefit => benefit.isActive);
      
      res.json(benefits);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch trust benefits" });
    }
  });

  // GET /api/trust-benefits/:id - Get a specific trust benefit (requires workers.view permission)
  app.get("/api/trust-benefits/:id", requireAuth, requirePermission("workers.view"), async (req, res) => {
    try {
      const { id } = req.params;
      const benefit = await storage.trustBenefits.getTrustBenefit(id);
      
      if (!benefit) {
        res.status(404).json({ message: "Trust benefit not found" });
        return;
      }
      
      res.json(benefit);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch trust benefit" });
    }
  });

  // POST /api/trust-benefits - Create a new trust benefit (requires workers.manage permission)
  app.post("/api/trust-benefits", requireAuth, requirePermission("workers.manage"), async (req, res) => {
    try {
      const parsed = insertTrustBenefitSchema.safeParse(req.body);
      
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid trust benefit data", errors: parsed.error.errors });
      }
      
      const benefit = await storage.trustBenefits.createTrustBenefit(parsed.data);
      res.status(201).json(benefit);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to create trust benefit" });
    }
  });

  // PUT /api/trust-benefits/:id - Update a trust benefit (requires workers.manage permission)
  app.put("/api/trust-benefits/:id", requireAuth, requirePermission("workers.manage"), async (req, res) => {
    try {
      const { id } = req.params;
      const { name, benefitType, isActive, description } = req.body;
      
      const updates: Partial<InsertTrustBenefit> = {};
      
      if (name !== undefined) {
        if (!name || typeof name !== 'string' || !name.trim()) {
          return res.status(400).json({ message: "Trust benefit name cannot be empty" });
        }
        updates.name = name.trim();
      }
      
      if (benefitType !== undefined) {
        updates.benefitType = benefitType;
      }
      
      if (isActive !== undefined) {
        if (typeof isActive !== 'boolean') {
          return res.status(400).json({ message: "isActive must be a boolean" });
        }
        updates.isActive = isActive;
      }
      
      if (description !== undefined) {
        updates.description = description;
      }
      
      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ message: "No fields to update" });
      }
      
      const benefit = await storage.trustBenefits.updateTrustBenefit(id, updates);
      
      if (!benefit) {
        res.status(404).json({ message: "Trust benefit not found" });
        return;
      }
      
      res.json(benefit);
    } catch (error) {
      res.status(500).json({ message: "Failed to update trust benefit" });
    }
  });

  // DELETE /api/trust-benefits/:id - Delete a trust benefit (requires workers.manage permission)
  app.delete("/api/trust-benefits/:id", requireAuth, requirePermission("workers.manage"), async (req, res) => {
    try {
      const { id } = req.params;
      const deleted = await storage.trustBenefits.deleteTrustBenefit(id);
      
      if (!deleted) {
        res.status(404).json({ message: "Trust benefit not found" });
        return;
      }
      
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Failed to delete trust benefit" });
    }
  });

  // GET /api/contacts/:id - Get a contact by ID (requires workers.view permission)
  app.get("/api/contacts/:id", requireAuth, requirePermission("workers.view"), async (req, res) => {
    try {
      const { id } = req.params;
      const contact = await storage.contacts.getContact(id);
      
      if (!contact) {
        res.status(404).json({ message: "Contact not found" });
        return;
      }
      
      res.json(contact);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch contact" });
    }
  });

  // IMPORTANT: Register specific variable routes BEFORE generic variable routes
  // GET /api/variables/address_validation_config - Get address validation configuration
  app.get("/api/variables/address_validation_config", requireAuth, async (req, res) => {
    try {
      const config = await addressValidationService.getConfig();
      res.json(config);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch address validation configuration" });
    }
  });

  // PUT /api/variables/address_validation_config - Update address validation configuration
  app.put("/api/variables/address_validation_config", requireAuth, requireAccess(policies.admin), async (req, res) => {
    try {
      // Basic validation for the configuration update
      const { mode, local, google } = req.body;
      
      if (!mode || (mode !== "local" && mode !== "google")) {
        return res.status(400).json({ message: "Invalid validation mode. Must be 'local' or 'google'." });
      }
      
      if (!local || typeof local.enabled !== "boolean") {
        return res.status(400).json({ message: "Invalid local configuration." });
      }
      
      if (!google || typeof google.enabled !== "boolean") {
        return res.status(400).json({ message: "Invalid google configuration." });
      }
      
      await addressValidationService.updateConfig(req.body);
      const updatedConfig = await addressValidationService.getConfig();
      res.json(updatedConfig);
    } catch (error) {
      res.status(500).json({ message: "Failed to update address validation configuration" });
    }
  });

  // GET /api/variables/phone_validation_config - Get phone validation configuration
  app.get("/api/variables/phone_validation_config", requireAuth, async (req, res) => {
    try {
      const config = await phoneValidationService.loadConfig();
      res.json(config);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch phone validation configuration" });
    }
  });

  // PUT /api/variables/phone_validation_config - Update phone validation configuration
  app.put("/api/variables/phone_validation_config", requireAuth, requireAccess(policies.admin), async (req, res) => {
    try {
      const { mode, local, twilio, fallback } = req.body;
      
      console.log('Received phone validation config update:', JSON.stringify(req.body, null, 2));
      
      if (!mode || (mode !== "local" && mode !== "twilio")) {
        return res.status(400).json({ message: "Invalid validation mode. Must be 'local' or 'twilio'." });
      }
      
      if (!local || typeof local.enabled !== "boolean") {
        return res.status(400).json({ message: "Invalid local configuration." });
      }
      
      if (!twilio || typeof twilio.enabled !== "boolean") {
        return res.status(400).json({ message: "Invalid twilio configuration." });
      }
      
      if (!fallback || typeof fallback.useLocalOnTwilioFailure !== "boolean") {
        return res.status(400).json({ message: "Invalid fallback configuration." });
      }
      
      const configVar = await storage.variables.getByName('phone_validation_config');
      if (configVar) {
        console.log('Updating existing config variable:', configVar.id);
        await storage.variables.update(configVar.id, {
          value: req.body,
        });
      } else {
        console.log('Creating new config variable');
        await storage.variables.create({
          name: 'phone_validation_config',
          value: req.body,
        });
      }
      
      const updatedConfig = await phoneValidationService.loadConfig();
      console.log('Loaded config after update:', JSON.stringify(updatedConfig, null, 2));
      res.json(updatedConfig);
    } catch (error) {
      console.error('Error updating phone validation config:', error);
      res.status(500).json({ 
        message: "Failed to update phone validation configuration",
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  // POST /api/geocode - Geocode an address
  app.post("/api/geocode", requireAuth, async (req, res) => {
    try {
      const { street, city, state, postalCode, country } = req.body;
      
      const result = await addressValidationService.geocodeAddress({
        street: street || "",
        city: city || "",
        state: state || "",
        postalCode: postalCode || "",
        country: country || "",
      });
      
      res.json(result);
    } catch (error) {
      res.status(500).json({ 
        success: false, 
        error: "Failed to geocode address" 
      });
    }
  });

  // Site Settings routes - Simple API for common site configuration
  // GET /api/site-settings - Get site settings (no auth required for public settings)
  app.get("/api/site-settings", async (req, res) => {
    try {
      const siteNameVar = await storage.variables.getByName("site_name");
      const siteName = siteNameVar ? (siteNameVar.value as string) : "Sirius";
      
      const siteFooterVar = await storage.variables.getByName("site_footer");
      const footer = siteFooterVar ? (siteFooterVar.value as string) : "";
      
      res.json({ siteName, footer });
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch site settings" });
    }
  });

  // PUT /api/site-settings - Update site settings (requires admin permissions)
  app.put("/api/site-settings", requireAccess(policies.admin), async (req, res) => {
    try {
      const { siteName, footer } = req.body;
      
      // Update siteName if provided
      if (siteName !== undefined) {
        if (typeof siteName !== "string") {
          res.status(400).json({ message: "Invalid site name" });
          return;
        }
        
        const existingVariable = await storage.variables.getByName("site_name");
        if (existingVariable) {
          await storage.variables.update(existingVariable.id, { value: siteName });
        } else {
          await storage.variables.create({ name: "site_name", value: siteName });
        }
      }
      
      // Update footer if provided
      if (footer !== undefined) {
        if (typeof footer !== "string") {
          res.status(400).json({ message: "Invalid footer content" });
          return;
        }
        
        const existingFooter = await storage.variables.getByName("site_footer");
        if (existingFooter) {
          await storage.variables.update(existingFooter.id, { value: footer });
        } else {
          await storage.variables.create({ name: "site_footer", value: footer });
        }
      }
      
      // Return updated values
      const siteNameVar = await storage.variables.getByName("site_name");
      const finalSiteName = siteNameVar ? (siteNameVar.value as string) : "Sirius";
      
      const siteFooterVar = await storage.variables.getByName("site_footer");
      const finalFooter = siteFooterVar ? (siteFooterVar.value as string) : "";
      
      res.json({ siteName: finalSiteName, footer: finalFooter });
    } catch (error) {
      res.status(500).json({ message: "Failed to update site settings" });
    }
  });

  // Gender Options routes
  // GET /api/gender-options - Get all gender options (requires workers.view permission)
  app.get("/api/gender-options", requireAuth, requirePermission("workers.view"), async (req, res) => {
    try {
      const genderOptions = await storage.options.gender.getAllGenderOptions();
      res.json(genderOptions);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch gender options" });
    }
  });

  // GET /api/gender-options/:id - Get a specific gender option (requires workers.view permission)
  app.get("/api/gender-options/:id", requireAuth, requirePermission("workers.view"), async (req, res) => {
    try {
      const { id } = req.params;
      const genderOption = await storage.options.gender.getGenderOption(id);
      
      if (!genderOption) {
        res.status(404).json({ message: "Gender option not found" });
        return;
      }
      
      res.json(genderOption);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch gender option" });
    }
  });

  // POST /api/gender-options - Create a new gender option (requires admin permission)
  app.post("/api/gender-options", requireAccess(policies.admin), async (req, res) => {
    try {
      const { name, code, nota, sequence } = req.body;
      
      if (!name || typeof name !== 'string' || !name.trim()) {
        return res.status(400).json({ message: "Name is required" });
      }
      
      if (!code || typeof code !== 'string' || !code.trim()) {
        return res.status(400).json({ message: "Code is required" });
      }
      
      const genderOption = await storage.options.gender.createGenderOption({
        name: name.trim(),
        code: code.trim(),
        nota: typeof nota === 'boolean' ? nota : false,
        sequence: typeof sequence === 'number' ? sequence : 0,
      });
      
      res.status(201).json(genderOption);
    } catch (error: any) {
      if (error.message?.includes('unique constraint') || error.code === '23505') {
        return res.status(409).json({ message: "A gender option with this code already exists" });
      }
      res.status(500).json({ message: "Failed to create gender option" });
    }
  });

  // PUT /api/gender-options/:id - Update a gender option (requires admin permission)
  app.put("/api/gender-options/:id", requireAccess(policies.admin), async (req, res) => {
    try {
      const { id } = req.params;
      const { name, code, nota, sequence } = req.body;
      
      const updates: any = {};
      
      if (name !== undefined) {
        if (typeof name !== 'string' || !name.trim()) {
          return res.status(400).json({ message: "Name must be a non-empty string" });
        }
        updates.name = name.trim();
      }
      
      if (code !== undefined) {
        if (typeof code !== 'string' || !code.trim()) {
          return res.status(400).json({ message: "Code must be a non-empty string" });
        }
        updates.code = code.trim();
      }
      
      if (nota !== undefined) {
        if (typeof nota !== 'boolean') {
          return res.status(400).json({ message: "Nota must be a boolean" });
        }
        updates.nota = nota;
      }
      
      if (sequence !== undefined) {
        if (typeof sequence !== 'number') {
          return res.status(400).json({ message: "Sequence must be a number" });
        }
        updates.sequence = sequence;
      }
      
      const genderOption = await storage.options.gender.updateGenderOption(id, updates);
      
      if (!genderOption) {
        res.status(404).json({ message: "Gender option not found" });
        return;
      }
      
      res.json(genderOption);
    } catch (error: any) {
      if (error.message?.includes('unique constraint') || error.code === '23505') {
        return res.status(409).json({ message: "A gender option with this code already exists" });
      }
      res.status(500).json({ message: "Failed to update gender option" });
    }
  });

  // DELETE /api/gender-options/:id - Delete a gender option (requires admin permission)
  app.delete("/api/gender-options/:id", requireAccess(policies.admin), async (req, res) => {
    try {
      const { id } = req.params;
      const deleted = await storage.options.gender.deleteGenderOption(id);
      
      if (!deleted) {
        res.status(404).json({ message: "Gender option not found" });
        return;
      }
      
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Failed to delete gender option" });
    }
  });

  // Trust Benefit Type routes

  // GET /api/trust-benefit-types - Get all trust benefit types (requires workers.view permission)
  app.get("/api/trust-benefit-types", requireAuth, requirePermission("workers.view"), async (req, res) => {
    try {
      const trustBenefitTypes = await storage.options.trustBenefitTypes.getAllTrustBenefitTypes();
      res.json(trustBenefitTypes);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch trust benefit types" });
    }
  });

  // GET /api/trust-benefit-types/:id - Get a specific trust benefit type (requires workers.view permission)
  app.get("/api/trust-benefit-types/:id", requireAuth, requirePermission("workers.view"), async (req, res) => {
    try {
      const { id } = req.params;
      const trustBenefitType = await storage.options.trustBenefitTypes.getTrustBenefitType(id);
      
      if (!trustBenefitType) {
        res.status(404).json({ message: "Trust benefit type not found" });
        return;
      }
      
      res.json(trustBenefitType);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch trust benefit type" });
    }
  });

  // POST /api/trust-benefit-types - Create a new trust benefit type (requires admin permission)
  app.post("/api/trust-benefit-types", requireAccess(policies.admin), async (req, res) => {
    try {
      const parsedData = insertTrustBenefitTypeSchema.safeParse(req.body);
      
      if (!parsedData.success) {
        res.status(400).json({ 
          message: "Invalid request data", 
          errors: parsedData.error.errors 
        });
        return;
      }
      
      const trustBenefitType = await storage.options.trustBenefitTypes.createTrustBenefitType(parsedData.data);
      res.status(201).json(trustBenefitType);
    } catch (error: any) {
      if (error.code === "23505") {
        res.status(409).json({ message: "Trust benefit type with this name already exists" });
        return;
      }
      res.status(500).json({ message: "Failed to create trust benefit type" });
    }
  });

  // PUT /api/trust-benefit-types/:id - Update a trust benefit type (requires admin permission)
  app.put("/api/trust-benefit-types/:id", requireAccess(policies.admin), async (req, res) => {
    try {
      const { id } = req.params;
      const parsedData = insertTrustBenefitTypeSchema.partial().safeParse(req.body);
      
      if (!parsedData.success) {
        res.status(400).json({ 
          message: "Invalid request data", 
          errors: parsedData.error.errors 
        });
        return;
      }
      
      const trustBenefitType = await storage.options.trustBenefitTypes.updateTrustBenefitType(id, parsedData.data);
      
      if (!trustBenefitType) {
        res.status(404).json({ message: "Trust benefit type not found" });
        return;
      }
      
      res.json(trustBenefitType);
    } catch (error: any) {
      if (error.code === "23505") {
        res.status(409).json({ message: "Trust benefit type with this name already exists" });
        return;
      }
      res.status(500).json({ message: "Failed to update trust benefit type" });
    }
  });

  // DELETE /api/trust-benefit-types/:id - Delete a trust benefit type (requires admin permission)
  app.delete("/api/trust-benefit-types/:id", requireAccess(policies.admin), async (req, res) => {
    try {
      const { id } = req.params;
      const deleted = await storage.options.trustBenefitTypes.deleteTrustBenefitType(id);
      
      if (!deleted) {
        res.status(404).json({ message: "Trust benefit type not found" });
        return;
      }
      
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Failed to delete trust benefit type" });
    }
  });

  // Worker ID Type routes
  
  // GET /api/worker-id-types - Get all worker ID types (requires workers.view permission)
  app.get("/api/worker-id-types", requireAuth, requirePermission("workers.view"), async (req, res) => {
    try {
      const workerIdTypes = await storage.options.workerIdTypes.getAllWorkerIdTypes();
      res.json(workerIdTypes);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch worker ID types" });
    }
  });

  // GET /api/worker-id-types/:id - Get a specific worker ID type (requires workers.view permission)
  app.get("/api/worker-id-types/:id", requireAuth, requirePermission("workers.view"), async (req, res) => {
    try {
      const { id } = req.params;
      const workerIdType = await storage.options.workerIdTypes.getWorkerIdType(id);
      
      if (!workerIdType) {
        res.status(404).json({ message: "Worker ID type not found" });
        return;
      }
      
      res.json(workerIdType);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch worker ID type" });
    }
  });

  // POST /api/worker-id-types - Create a new worker ID type (requires admin permission)
  app.post("/api/worker-id-types", requireAccess(policies.admin), async (req, res) => {
    try {
      const { name, sequence, validator } = req.body;
      
      if (!name || typeof name !== 'string' || !name.trim()) {
        return res.status(400).json({ message: "Name is required" });
      }
      
      const workerIdType = await storage.workers.createWorkerIdType({
        name: name.trim(),
        sequence: typeof sequence === 'number' ? sequence : 0,
        validator: validator && typeof validator === 'string' ? validator.trim() : null,
      });
      
      res.status(201).json(workerIdType);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to create worker ID type" });
    }
  });

  // PUT /api/worker-id-types/:id - Update a worker ID type (requires admin permission)
  app.put("/api/worker-id-types/:id", requireAccess(policies.admin), async (req, res) => {
    try {
      const { id } = req.params;
      const { name, sequence, validator } = req.body;
      
      const updates: any = {};
      
      if (name !== undefined) {
        if (typeof name !== 'string' || !name.trim()) {
          return res.status(400).json({ message: "Name must be a non-empty string" });
        }
        updates.name = name.trim();
      }
      
      if (sequence !== undefined) {
        if (typeof sequence !== 'number') {
          return res.status(400).json({ message: "Sequence must be a number" });
        }
        updates.sequence = sequence;
      }
      
      if (validator !== undefined) {
        if (validator === null || validator === '') {
          updates.validator = null;
        } else if (typeof validator === 'string') {
          updates.validator = validator.trim();
        } else {
          return res.status(400).json({ message: "Validator must be a string or null" });
        }
      }
      
      const workerIdType = await storage.options.workerIdTypes.updateWorkerIdType(id, updates);
      
      if (!workerIdType) {
        res.status(404).json({ message: "Worker ID type not found" });
        return;
      }
      
      res.json(workerIdType);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to update worker ID type" });
    }
  });

  // DELETE /api/worker-id-types/:id - Delete a worker ID type (requires admin permission)
  app.delete("/api/worker-id-types/:id", requireAccess(policies.admin), async (req, res) => {
    try {
      const { id } = req.params;
      const deleted = await storage.workers.deleteWorkerIdType(id);
      
      if (!deleted) {
        res.status(404).json({ message: "Worker ID type not found" });
        return;
      }
      
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Failed to delete worker ID type" });
    }
  });

  // Ledger Payment Type routes

  // GET /api/ledger-payment-types - Get all ledger payment types (requires ledgerStaff policy)
  app.get("/api/ledger-payment-types", requireAccess(policies.ledgerStaff), async (req, res) => {
    try {
      const paymentTypes = await storage.options.ledgerPaymentTypes.getAllLedgerPaymentTypes();
      res.json(paymentTypes);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch ledger payment types" });
    }
  });

  // GET /api/ledger-payment-types/:id - Get a specific ledger payment type (requires ledgerStaff policy)
  app.get("/api/ledger-payment-types/:id", requireAccess(policies.ledgerStaff), async (req, res) => {
    try {
      const { id } = req.params;
      const paymentType = await storage.options.ledgerPaymentTypes.getLedgerPaymentType(id);
      
      if (!paymentType) {
        res.status(404).json({ message: "Ledger payment type not found" });
        return;
      }
      
      res.json(paymentType);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch ledger payment type" });
    }
  });

  // POST /api/ledger-payment-types - Create a new ledger payment type (requires ledgerStaff policy)
  app.post("/api/ledger-payment-types", requireAccess(policies.ledgerStaff), async (req, res) => {
    try {
      const { name, description, sequence } = req.body;
      
      if (!name || typeof name !== 'string' || !name.trim()) {
        return res.status(400).json({ message: "Name is required" });
      }
      
      const paymentType = await storage.options.ledgerPaymentTypes.createLedgerPaymentType({
        name: name.trim(),
        description: description && typeof description === 'string' ? description.trim() : null,
        sequence: typeof sequence === 'number' ? sequence : 0,
      });
      
      res.status(201).json(paymentType);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to create ledger payment type" });
    }
  });

  // PUT /api/ledger-payment-types/:id - Update a ledger payment type (requires ledgerStaff policy)
  app.put("/api/ledger-payment-types/:id", requireAccess(policies.ledgerStaff), async (req, res) => {
    try {
      const { id } = req.params;
      const { name, description, sequence } = req.body;
      
      const updates: any = {};
      
      if (name !== undefined) {
        if (typeof name !== 'string' || !name.trim()) {
          return res.status(400).json({ message: "Name must be a non-empty string" });
        }
        updates.name = name.trim();
      }
      
      if (description !== undefined) {
        if (description === null || description === '') {
          updates.description = null;
        } else if (typeof description === 'string') {
          updates.description = description.trim();
        } else {
          return res.status(400).json({ message: "Description must be a string or null" });
        }
      }
      
      if (sequence !== undefined) {
        if (typeof sequence !== 'number') {
          return res.status(400).json({ message: "Sequence must be a number" });
        }
        updates.sequence = sequence;
      }
      
      const paymentType = await storage.options.ledgerPaymentTypes.updateLedgerPaymentType(id, updates);
      
      if (!paymentType) {
        res.status(404).json({ message: "Ledger payment type not found" });
        return;
      }
      
      res.json(paymentType);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to update ledger payment type" });
    }
  });

  // DELETE /api/ledger-payment-types/:id - Delete a ledger payment type (requires ledgerStaff policy)
  app.delete("/api/ledger-payment-types/:id", requireAccess(policies.ledgerStaff), async (req, res) => {
    try {
      const { id } = req.params;
      const deleted = await storage.options.ledgerPaymentTypes.deleteLedgerPaymentType(id);
      
      if (!deleted) {
        res.status(404).json({ message: "Ledger payment type not found" });
        return;
      }
      
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Failed to delete ledger payment type" });
    }
  });

  // Employer Contact Type routes

  // GET /api/employer-contact-types - Get all employer contact types (requires admin permission)
  app.get("/api/employer-contact-types", requireAccess(policies.admin), async (req, res) => {
    try {
      const contactTypes = await storage.options.employerContactTypes.getAll();
      res.json(contactTypes);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch employer contact types" });
    }
  });

  // GET /api/employer-contact-types/:id - Get a specific employer contact type (requires admin permission)
  app.get("/api/employer-contact-types/:id", requireAccess(policies.admin), async (req, res) => {
    try {
      const { id } = req.params;
      const contactType = await storage.options.employerContactTypes.get(id);
      
      if (!contactType) {
        res.status(404).json({ message: "Employer contact type not found" });
        return;
      }
      
      res.json(contactType);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch employer contact type" });
    }
  });

  // POST /api/employer-contact-types - Create a new employer contact type (requires admin permission)
  app.post("/api/employer-contact-types", requireAccess(policies.admin), async (req, res) => {
    try {
      const { name, description } = req.body;
      
      if (!name || typeof name !== 'string' || !name.trim()) {
        return res.status(400).json({ message: "Name is required" });
      }
      
      const contactType = await storage.options.employerContactTypes.create({
        name: name.trim(),
        description: description && typeof description === 'string' ? description.trim() : null,
      });
      
      res.status(201).json(contactType);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to create employer contact type" });
    }
  });

  // PUT /api/employer-contact-types/:id - Update an employer contact type (requires admin permission)
  app.put("/api/employer-contact-types/:id", requireAccess(policies.admin), async (req, res) => {
    try {
      const { id } = req.params;
      const { name, description } = req.body;
      
      const updates: any = {};
      
      if (name !== undefined) {
        if (typeof name !== 'string' || !name.trim()) {
          return res.status(400).json({ message: "Name must be a non-empty string" });
        }
        updates.name = name.trim();
      }
      
      if (description !== undefined) {
        if (description === null || description === '') {
          updates.description = null;
        } else if (typeof description === 'string') {
          updates.description = description.trim();
        } else {
          return res.status(400).json({ message: "Description must be a string or null" });
        }
      }
      
      const contactType = await storage.options.employerContactTypes.update(id, updates);
      
      if (!contactType) {
        res.status(404).json({ message: "Employer contact type not found" });
        return;
      }
      
      res.json(contactType);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to update employer contact type" });
    }
  });

  // DELETE /api/employer-contact-types/:id - Delete an employer contact type (requires admin permission)
  app.delete("/api/employer-contact-types/:id", requireAccess(policies.admin), async (req, res) => {
    try {
      const { id} = req.params;
      const deleted = await storage.options.employerContactTypes.delete(id);
      
      if (!deleted) {
        res.status(404).json({ message: "Employer contact type not found" });
        return;
      }
      
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Failed to delete employer contact type" });
    }
  });

  // Worker Work Status routes

  // GET /api/worker-work-statuses - Get all worker work statuses (requires admin permission)
  app.get("/api/worker-work-statuses", requireAccess(policies.admin), async (req, res) => {
    try {
      const statuses = await storage.options.workerWs.getAll();
      res.json(statuses);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch worker work statuses" });
    }
  });

  // GET /api/worker-work-statuses/:id - Get a specific worker work status (requires admin permission)
  app.get("/api/worker-work-statuses/:id", requireAccess(policies.admin), async (req, res) => {
    try {
      const { id } = req.params;
      const status = await storage.options.workerWs.get(id);
      
      if (!status) {
        res.status(404).json({ message: "Worker work status not found" });
        return;
      }
      
      res.json(status);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch worker work status" });
    }
  });

  // POST /api/worker-work-statuses - Create a new worker work status (requires admin permission)
  app.post("/api/worker-work-statuses", requireAccess(policies.admin), async (req, res) => {
    try {
      const validation = insertWorkerWsSchema.safeParse(req.body);
      
      if (!validation.success) {
        return res.status(400).json({ 
          message: "Invalid request data",
          errors: validation.error.errors 
        });
      }
      
      const status = await storage.options.workerWs.create(validation.data);
      
      res.status(201).json(status);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to create worker work status" });
    }
  });

  // PUT /api/worker-work-statuses/:id - Update a worker work status (requires admin permission)
  app.put("/api/worker-work-statuses/:id", requireAccess(policies.admin), async (req, res) => {
    try {
      const { id } = req.params;
      const validation = updateWorkerWsSchema.safeParse(req.body);
      
      if (!validation.success) {
        return res.status(400).json({ 
          message: "Invalid request data",
          errors: validation.error.errors 
        });
      }
      
      const status = await storage.options.workerWs.update(id, validation.data);
      
      if (!status) {
        res.status(404).json({ message: "Worker work status not found" });
        return;
      }
      
      res.json(status);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to update worker work status" });
    }
  });

  // DELETE /api/worker-work-statuses/:id - Delete a worker work status (requires admin permission)
  app.delete("/api/worker-work-statuses/:id", requireAccess(policies.admin), async (req, res) => {
    try {
      const { id } = req.params;
      const deleted = await storage.options.workerWs.delete(id);
      
      if (!deleted) {
        res.status(404).json({ message: "Worker work status not found" });
        return;
      }
      
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Failed to delete worker work status" });
    }
  });

  // Employment Status routes

  // GET /api/employment-statuses - Get all employment statuses (requires admin permission)
  app.get("/api/employment-statuses", requireAccess(policies.admin), async (req, res) => {
    try {
      const statuses = await storage.options.employmentStatus.getAll();
      res.json(statuses);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch employment statuses" });
    }
  });

  // GET /api/employment-statuses/:id - Get a specific employment status (requires admin permission)
  app.get("/api/employment-statuses/:id", requireAccess(policies.admin), async (req, res) => {
    try {
      const { id } = req.params;
      const status = await storage.options.employmentStatus.get(id);
      
      if (!status) {
        res.status(404).json({ message: "Employment status not found" });
        return;
      }
      
      res.json(status);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch employment status" });
    }
  });

  // POST /api/employment-statuses - Create a new employment status (requires admin permission)
  app.post("/api/employment-statuses", requireAccess(policies.admin), async (req, res) => {
    try {
      const validation = insertEmploymentStatusSchema.safeParse(req.body);
      
      if (!validation.success) {
        return res.status(400).json({ 
          message: "Invalid request data",
          errors: validation.error.errors 
        });
      }
      
      const status = await storage.options.employmentStatus.create(validation.data);
      res.status(201).json(status);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to create employment status" });
    }
  });

  // PUT /api/employment-statuses/:id - Update an employment status (requires admin permission)
  app.put("/api/employment-statuses/:id", requireAccess(policies.admin), async (req, res) => {
    try {
      const { id } = req.params;
      const validation = updateEmploymentStatusSchema.safeParse(req.body);
      
      if (!validation.success) {
        return res.status(400).json({ 
          message: "Invalid request data",
          errors: validation.error.errors 
        });
      }
      
      const status = await storage.options.employmentStatus.update(id, validation.data);
      
      if (!status) {
        res.status(404).json({ message: "Employment status not found" });
        return;
      }
      
      res.json(status);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to update employment status" });
    }
  });

  // DELETE /api/employment-statuses/:id - Delete an employment status (requires admin permission)
  app.delete("/api/employment-statuses/:id", requireAccess(policies.admin), async (req, res) => {
    try {
      const { id } = req.params;
      const deleted = await storage.options.employmentStatus.delete(id);
      
      if (!deleted) {
        res.status(404).json({ message: "Employment status not found" });
        return;
      }
      
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Failed to delete employment status" });
    }
  });

  // Worker ID routes
  
  // GET /api/workers/:workerId/ids - Get all IDs for a worker (requires worker policy: staff or worker with matching email)
  app.get("/api/workers/:workerId/ids", requireAccess(policies.worker), async (req, res) => {
    try {
      const { workerId } = req.params;
      const workerIds = await storage.workerIds.getWorkerIdsByWorkerId(workerId);
      res.json(workerIds);
    } catch (error) {
      console.error("Error fetching worker IDs:", error);
      res.status(500).json({ message: "Failed to fetch worker IDs" });
    }
  });

  // GET /api/worker-ids/:id - Get a specific worker ID (requires workers.view permission)
  app.get("/api/worker-ids/:id", requireAuth, requirePermission("workers.view"), async (req, res) => {
    try {
      const { id } = req.params;
      const workerId = await storage.workerIds.getWorkerId(id);
      
      if (!workerId) {
        res.status(404).json({ message: "Worker ID not found" });
        return;
      }
      
      res.json(workerId);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch worker ID" });
    }
  });

  // POST /api/workers/:workerId/ids - Create a new worker ID (requires workers.manage permission)
  app.post("/api/workers/:workerId/ids", requireAuth, requirePermission("workers.manage"), async (req, res) => {
    try {
      const { workerId } = req.params;
      const { typeId, value } = req.body;
      
      if (!typeId || typeof typeId !== 'string' || !typeId.trim()) {
        return res.status(400).json({ message: "Type ID is required" });
      }
      
      if (!value || typeof value !== 'string' || !value.trim()) {
        return res.status(400).json({ message: "Value is required" });
      }
      
      // Verify the worker exists
      const worker = await storage.workers.getWorker(workerId);
      if (!worker) {
        return res.status(404).json({ message: "Worker not found" });
      }
      
      // Verify the type exists
      const type = await storage.options.workerIdTypes.getWorkerIdType(typeId);
      if (!type) {
        return res.status(404).json({ message: "Worker ID type not found" });
      }
      
      // Validate against regex if type has a validator
      if (type.validator) {
        try {
          const regex = new RegExp(type.validator);
          if (!regex.test(value.trim())) {
            return res.status(400).json({ 
              message: `Value does not match the required format for ${type.name}` 
            });
          }
        } catch (regexError) {
          // If regex is invalid, log but don't block the creation
          console.error(`Invalid regex pattern for type ${type.name}:`, regexError);
        }
      }
      
      const newWorkerId = await storage.workerIds.createWorkerId({
        workerId,
        typeId: typeId.trim(),
        value: value.trim(),
      });
      
      res.status(201).json(newWorkerId);
    } catch (error: any) {
      console.error("Error creating worker ID:", error);
      
      // Check for unique constraint violation
      if (error.code === '23505' && error.constraint === 'worker_ids_type_id_value_unique') {
        return res.status(409).json({ 
          message: "This ID value already exists for this type. Worker IDs must be unique." 
        });
      }
      
      res.status(500).json({ message: "Failed to create worker ID" });
    }
  });

  // PUT /api/worker-ids/:id - Update a worker ID (requires workers.manage permission)
  app.put("/api/worker-ids/:id", requireAuth, requirePermission("workers.manage"), async (req, res) => {
    try {
      const { id } = req.params;
      const { typeId, value } = req.body;
      
      const updates: any = {};
      
      if (typeId !== undefined) {
        if (typeof typeId !== 'string' || !typeId.trim()) {
          return res.status(400).json({ message: "Type ID must be a non-empty string" });
        }
        
        // Verify the type exists
        const type = await storage.options.workerIdTypes.getWorkerIdType(typeId);
        if (!type) {
          return res.status(404).json({ message: "Worker ID type not found" });
        }
        
        updates.typeId = typeId.trim();
      }
      
      if (value !== undefined) {
        if (typeof value !== 'string' || !value.trim()) {
          return res.status(400).json({ message: "Value must be a non-empty string" });
        }
        
        // Get the worker ID to check its type
        const existingWorkerId = await storage.workerIds.getWorkerId(id);
        if (!existingWorkerId) {
          return res.status(404).json({ message: "Worker ID not found" });
        }
        
        // Determine which type to validate against
        const typeToValidate = typeId ? typeId.trim() : existingWorkerId.typeId;
        const type = await storage.options.workerIdTypes.getWorkerIdType(typeToValidate);
        
        // Validate against regex if type has a validator
        if (type && type.validator) {
          try {
            const regex = new RegExp(type.validator);
            if (!regex.test(value.trim())) {
              return res.status(400).json({ 
                message: `Value does not match the required format for ${type.name}` 
              });
            }
          } catch (regexError) {
            console.error(`Invalid regex pattern for type ${type.name}:`, regexError);
          }
        }
        
        updates.value = value.trim();
      }
      
      const updatedWorkerId = await storage.workerIds.updateWorkerId(id, updates);
      
      if (!updatedWorkerId) {
        res.status(404).json({ message: "Worker ID not found" });
        return;
      }
      
      res.json(updatedWorkerId);
    } catch (error: any) {
      console.error("Error updating worker ID:", error);
      
      // Check for unique constraint violation
      if (error.code === '23505' && error.constraint === 'worker_ids_type_id_value_unique') {
        return res.status(409).json({ 
          message: "This ID value already exists for this type. Worker IDs must be unique." 
        });
      }
      
      res.status(500).json({ message: "Failed to update worker ID" });
    }
  });

  // DELETE /api/worker-ids/:id - Delete a worker ID (requires workers.manage permission)
  app.delete("/api/worker-ids/:id", requireAuth, requirePermission("workers.manage"), async (req, res) => {
    try {
      const { id } = req.params;
      const deleted = await storage.workerIds.deleteWorkerId(id);
      
      if (!deleted) {
        res.status(404).json({ message: "Worker ID not found" });
        return;
      }
      
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Failed to delete worker ID" });
    }
  });

  // Worker Employment History routes

  // GET /api/workers/:workerId/emphist - Get all employment history for a worker (requires worker policy: staff or worker with matching email)
  app.get("/api/workers/:workerId/emphist", requireAccess(policies.worker), async (req, res) => {
    try {
      const { workerId } = req.params;
      const emphist = await storage.workerEmphist.getWorkerEmphistByWorkerId(workerId);
      res.json(emphist);
    } catch (error) {
      console.error("Error fetching worker employment history:", error);
      res.status(500).json({ message: "Failed to fetch employment history" });
    }
  });

  // GET /api/worker-emphist/:id - Get a specific employment history record (requires workers.view permission)
  app.get("/api/worker-emphist/:id", requireAuth, requirePermission("workers.view"), async (req, res) => {
    try {
      const { id } = req.params;
      const emphist = await storage.workerEmphist.getWorkerEmphist(id);
      
      if (!emphist) {
        res.status(404).json({ message: "Employment history record not found" });
        return;
      }
      
      res.json(emphist);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch employment history record" });
    }
  });

  // POST /api/workers/:workerId/emphist - Create a new employment history record (requires workers.manage permission)
  app.post("/api/workers/:workerId/emphist", requireAuth, requirePermission("workers.manage"), async (req, res) => {
    try {
      const { workerId } = req.params;
      
      // Verify the worker exists
      const worker = await storage.workers.getWorker(workerId);
      if (!worker) {
        return res.status(404).json({ message: "Worker not found" });
      }
      
      // Validate request body
      const result = insertWorkerEmphistSchema.safeParse({
        ...req.body,
        workerId
      });
      
      if (!result.success) {
        return res.status(400).json({ 
          message: "Invalid employment history data",
          errors: result.error.errors 
        });
      }
      
      // If employerId is provided, verify it exists
      if (result.data.employerId) {
        const employer = await storage.employers.getEmployer(result.data.employerId);
        if (!employer) {
          return res.status(404).json({ message: "Employer not found" });
        }
      }
      
      // If employmentStatus is provided, verify it exists
      if (result.data.employmentStatus) {
        const status = await storage.options.employmentStatus.get(result.data.employmentStatus);
        if (!status) {
          return res.status(404).json({ message: "Employment status not found" });
        }
      }
      
      const emphist = await storage.workerEmphist.createWorkerEmphist(result.data);
      res.status(201).json(emphist);
    } catch (error: any) {
      console.error("Error creating employment history:", error);
      res.status(500).json({ message: "Failed to create employment history" });
    }
  });

  // PUT /api/worker-emphist/:id - Update an employment history record (requires workers.manage permission)
  app.put("/api/worker-emphist/:id", requireAuth, requirePermission("workers.manage"), async (req, res) => {
    try {
      const { id } = req.params;
      
      // Verify the record exists
      const existing = await storage.workerEmphist.getWorkerEmphist(id);
      if (!existing) {
        return res.status(404).json({ message: "Employment history record not found" });
      }
      
      // Validate partial update
      const result = insertWorkerEmphistSchema.partial().safeParse(req.body);
      
      if (!result.success) {
        return res.status(400).json({ 
          message: "Invalid employment history data",
          errors: result.error.errors 
        });
      }
      
      // If employerId is being updated, verify it exists
      if (result.data.employerId !== undefined && result.data.employerId !== null) {
        const employer = await storage.employers.getEmployer(result.data.employerId);
        if (!employer) {
          return res.status(404).json({ message: "Employer not found" });
        }
      }
      
      // If employmentStatus is being updated, verify it exists
      if (result.data.employmentStatus !== undefined && result.data.employmentStatus !== null) {
        const status = await storage.options.employmentStatus.get(result.data.employmentStatus);
        if (!status) {
          return res.status(404).json({ message: "Employment status not found" });
        }
      }
      
      const emphist = await storage.workerEmphist.updateWorkerEmphist(id, result.data);
      
      if (!emphist) {
        res.status(404).json({ message: "Employment history record not found" });
        return;
      }
      
      res.json(emphist);
    } catch (error: any) {
      console.error("Error updating employment history:", error);
      res.status(500).json({ message: "Failed to update employment history" });
    }
  });

  // DELETE /api/worker-emphist/:id - Delete an employment history record (requires workers.manage permission)
  app.delete("/api/worker-emphist/:id", requireAuth, requirePermission("workers.manage"), async (req, res) => {
    try {
      const { id } = req.params;
      const deleted = await storage.workerEmphist.deleteWorkerEmphist(id);
      
      if (!deleted) {
        res.status(404).json({ message: "Employment history record not found" });
        return;
      }
      
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Failed to delete employment history" });
    }
  });

  // Worker Benefits (WMB) routes

  // GET /api/workers/:workerId/benefits - Get all benefits for a worker (requires worker policy: staff or worker with matching email)
  app.get("/api/workers/:workerId/benefits", requireAccess(policies.worker), async (req, res) => {
    try {
      const { workerId } = req.params;
      const benefits = await storage.workers.getWorkerBenefits(workerId);
      res.json(benefits);
    } catch (error) {
      console.error("Failed to fetch worker benefits:", error);
      res.status(500).json({ message: "Failed to fetch worker benefits" });
    }
  });

  // POST /api/workers/:workerId/benefits - Create a new benefit entry for a worker (requires workers.manage permission)
  app.post("/api/workers/:workerId/benefits", requireAuth, requirePermission("workers.manage"), async (req, res) => {
    try {
      const { workerId } = req.params;
      const { month, year, employerId, benefitId } = req.body;

      if (!month || !year || !employerId || !benefitId) {
        return res.status(400).json({ message: "Month, year, employer ID, and benefit ID are required" });
      }

      const wmb = await storage.workers.createWorkerBenefit({
        workerId,
        month,
        year,
        employerId,
        benefitId,
      });

      res.status(201).json(wmb);
    } catch (error: any) {
      console.error("Failed to create worker benefit:", error);
      if (error.message?.includes("duplicate key") || error.code === "23505") {
        return res.status(409).json({ message: "This benefit entry already exists for this worker, employer, and month/year" });
      }
      res.status(500).json({ message: "Failed to create worker benefit" });
    }
  });

  // DELETE /api/worker-benefits/:id - Delete a worker benefit entry (requires workers.manage permission)
  app.delete("/api/worker-benefits/:id", requireAuth, requirePermission("workers.manage"), async (req, res) => {
    try {
      const { id } = req.params;
      const deleted = await storage.workers.deleteWorkerBenefit(id);

      if (!deleted) {
        return res.status(404).json({ message: "Worker benefit not found" });
      }

      res.status(204).send();
    } catch (error) {
      console.error("Failed to delete worker benefit:", error);
      res.status(500).json({ message: "Failed to delete worker benefit" });
    }
  });

  // GET /api/workers/:workerId/logs - Get all logs related to a worker (requires staff permission)
  app.get("/api/workers/:workerId/logs", requireAuth, requireAccess(policies.staff), async (req, res) => {
    try {
      const { workerId } = req.params;
      const { module, operation, startDate, endDate } = req.query;

      // Get the worker to ensure it exists and get the contactId
      const worker = await storage.workers.getWorker(workerId);
      if (!worker) {
        return res.status(404).json({ message: "Worker not found" });
      }

      // Collect all entity IDs related to this worker
      const entityIds: string[] = [workerId];

      // Add contact ID
      if (worker.contactId) {
        entityIds.push(worker.contactId);

        // Get all addresses for this contact
        const addresses = await storage.contacts.addresses.getPostalAddressesByContact(worker.contactId);
        entityIds.push(...addresses.map((addr: PostalAddress) => addr.id));

        // Get all phone numbers for this contact
        const phoneNumbers = await storage.contacts.phoneNumbers.getPhoneNumbersByContact(worker.contactId);
        entityIds.push(...phoneNumbers.map((phone: PhoneNumber) => phone.id));
      }

      // Get all worker IDs for this worker
      const workerIds = await storage.workerIds.getWorkerIdsByWorkerId(workerId);
      entityIds.push(...workerIds.map((wid: WorkerId) => wid.id));

      // Build all conditions including the entity ID filter
      const conditions = [inArray(winstonLogs.entityId, entityIds)];
      
      if (module && typeof module === 'string') {
        conditions.push(eq(winstonLogs.module, module));
      }
      if (operation && typeof operation === 'string') {
        conditions.push(eq(winstonLogs.operation, operation));
      }
      if (startDate && typeof startDate === 'string') {
        conditions.push(gte(winstonLogs.timestamp, new Date(startDate)));
      }
      if (endDate && typeof endDate === 'string') {
        conditions.push(lte(winstonLogs.timestamp, new Date(endDate)));
      }

      // Execute query with all conditions and order by timestamp descending (newest first)
      const logs = await db
        .select()
        .from(winstonLogs)
        .where(and(...conditions))
        .orderBy(desc(winstonLogs.timestamp));

      res.json(logs);
    } catch (error) {
      console.error("Failed to fetch worker logs:", error);
      res.status(500).json({ message: "Failed to fetch worker logs" });
    }
  });

  // GET /api/users/:userId/logs - Get all logs related to a user (requires staff permission)
  app.get("/api/users/:userId/logs", requireAuth, requireAccess(policies.staff), async (req, res) => {
    try {
      const { userId } = req.params;
      const { module, operation, startDate, endDate } = req.query;

      // Build all conditions including the entity ID filter
      const conditions = [eq(winstonLogs.entityId, userId)];
      
      if (module && typeof module === 'string') {
        conditions.push(eq(winstonLogs.module, module));
      }
      if (operation && typeof operation === 'string') {
        conditions.push(eq(winstonLogs.operation, operation));
      }
      if (startDate && typeof startDate === 'string') {
        conditions.push(gte(winstonLogs.timestamp, new Date(startDate)));
      }
      if (endDate && typeof endDate === 'string') {
        conditions.push(lte(winstonLogs.timestamp, new Date(endDate)));
      }

      // Query logs with filters
      const logs = await db
        .select()
        .from(winstonLogs)
        .where(and(...conditions))
        .orderBy(desc(winstonLogs.timestamp))
        .limit(500);

      res.json(logs);
    } catch (error) {
      console.error("Failed to fetch user logs:", error);
      res.status(500).json({ message: "Failed to fetch user logs" });
    }
  });

  // GET /api/employers/:employerId/logs - Get all logs related to an employer (requires staff permission)
  app.get("/api/employers/:employerId/logs", requireAuth, requireAccess(policies.staff), async (req, res) => {
    try {
      const { employerId } = req.params;
      const { module, operation, startDate, endDate } = req.query;

      // Get the employer to ensure it exists
      const employer = await storage.employers.getEmployer(employerId);
      if (!employer) {
        return res.status(404).json({ message: "Employer not found" });
      }

      // Collect all entity IDs related to this employer
      const entityIds: string[] = [employerId];

      // Get all employer contacts for this employer
      const employerContacts = await storage.employerContacts.listByEmployer(employerId);
      entityIds.push(...employerContacts.map(ec => ec.id));

      // Get all contact IDs from employer contacts
      const contactIds = employerContacts.map(ec => ec.contactId);
      entityIds.push(...contactIds);

      // For each contact, get their addresses and phone numbers
      for (const contactId of contactIds) {
        const addresses = await storage.contacts.addresses.getPostalAddressesByContact(contactId);
        entityIds.push(...addresses.map(addr => addr.id));

        const phoneNumbers = await storage.contacts.phoneNumbers.getPhoneNumbersByContact(contactId);
        entityIds.push(...phoneNumbers.map(pn => pn.id));
      }

      // Get all Stripe payment methods for this employer
      const paymentMethods = await storage.ledger.stripePaymentMethods.getByEntity('employer', employerId);
      entityIds.push(...paymentMethods.map(pm => pm.id));

      // Build all conditions including the entity ID filter
      const conditions = [inArray(winstonLogs.entityId, entityIds)];
      
      if (module && typeof module === 'string') {
        conditions.push(eq(winstonLogs.module, module));
      }
      if (operation && typeof operation === 'string') {
        conditions.push(eq(winstonLogs.operation, operation));
      }
      if (startDate && typeof startDate === 'string') {
        conditions.push(gte(winstonLogs.timestamp, new Date(startDate)));
      }
      if (endDate && typeof endDate === 'string') {
        conditions.push(lte(winstonLogs.timestamp, new Date(endDate)));
      }

      // Execute query with all conditions and order by timestamp descending (newest first)
      const logs = await db
        .select()
        .from(winstonLogs)
        .where(and(...conditions))
        .orderBy(desc(winstonLogs.timestamp));

      res.json(logs);
    } catch (error) {
      console.error("Failed to fetch employer logs:", error);
      res.status(500).json({ message: "Failed to fetch employer logs" });
    }
  });

  // Register generic variable management routes (MUST come after specific routes)
  registerVariableRoutes(app, requireAuth, requirePermission);


  const httpServer = createServer(app);
  return httpServer;
}
