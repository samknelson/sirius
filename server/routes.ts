import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertWorkerSchema, insertTrustBenefitTypeSchema, insertTrustBenefitSchema, type InsertEmployer, type InsertTrustBenefit } from "@shared/schema";
import { registerUserRoutes } from "./modules/users";
import { registerVariableRoutes } from "./modules/variables";
import { registerPostalAddressRoutes } from "./modules/postal-addresses";
import { registerPhoneNumberRoutes } from "./modules/phone-numbers";
import { registerAddressValidationRoutes } from "./modules/address-validation";
import { registerMasqueradeRoutes, getEffectiveUser } from "./modules/masquerade";
import { registerDashboardRoutes } from "./modules/dashboard";
import { registerBookmarkRoutes } from "./modules/bookmarks";
import { registerComponentRoutes } from "./modules/components";
import { registerLedgerStripeRoutes } from "./modules/ledger/stripe";
import { registerLedgerAccountRoutes } from "./modules/ledger/accounts";
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
    const dbUser = await storage.getUserByReplitId(replitUserId);
    if (!dbUser) {
      return res.status(401).json({ message: "User not found" });
    }
    
    const hasPermission = await storage.userHasPermission(dbUser.id, permissionKey);
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
      const hasUsers = await storage.hasAnyUsers();
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
      const hasUsers = await storage.hasAnyUsers();
      if (hasUsers) {
        return res.status(403).json({ message: "Bootstrap is only allowed when no users exist" });
      }

      // Get all permissions from the registry
      const allPermissions = await storage.getAllPermissions();

      // Create admin role
      const adminRole = await storage.createRole({
        name: "admin",
        description: "Administrator role with all permissions"
      });

      // Assign all permissions to admin role
      for (const permission of allPermissions) {
        await storage.assignPermissionToRole({
          roleId: adminRole.id,
          permissionKey: permission.key
        });
      }

      // Create first user
      const newUser = await storage.createUser({
        email,
        firstName: firstName || null,
        lastName: lastName || null,
        replitUserId: null,
        accountStatus: 'pending',
        isActive: true
      });

      // Assign admin role to user
      await storage.assignRoleToUser({
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

      const userPermissions = await storage.getUserPermissions(dbUser.id);
      
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

  // Register masquerade routes
  registerMasqueradeRoutes(app, requireAuth, requirePermission);
  
  // Register user management routes
  registerUserRoutes(app, requireAuth, requirePermission);
  
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

  // Worker routes (protected with authentication and permissions)
  
  // GET /api/workers - Get all workers (requires workers.view permission)
  app.get("/api/workers", requireAuth, requirePermission("workers.view"), async (req, res) => {
    try {
      const workers = await storage.getAllWorkers();
      res.json(workers);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch workers" });
    }
  });

  // GET /api/workers/:id - Get a specific worker (requires workers.view permission)
  app.get("/api/workers/:id", requireAuth, requirePermission("workers.view"), async (req, res) => {
    try {
      const { id } = req.params;
      const worker = await storage.getWorker(id);
      
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
      const worker = await storage.createWorker(name.trim());
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
        const worker = await storage.updateWorkerContactEmail(id, email);
        
        if (!worker) {
          res.status(404).json({ message: "Worker not found" });
          return;
        }
        
        res.json(worker);
      }
      // Handle birth date updates
      else if (birthDate !== undefined) {
        const worker = await storage.updateWorkerContactBirthDate(id, birthDate);
        
        if (!worker) {
          res.status(404).json({ message: "Worker not found" });
          return;
        }
        
        res.json(worker);
      }
      // Handle SSN updates
      else if (ssn !== undefined) {
        try {
          const worker = await storage.updateWorkerSSN(id, ssn);
          
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
        const worker = await storage.updateWorkerContactGender(id, gender, genderNota);
        
        if (!worker) {
          res.status(404).json({ message: "Worker not found" });
          return;
        }
        
        res.json(worker);
      }
      // Support both old format (name) and new format (nameComponents)
      else if (nameComponents) {
        // New format: name components
        const worker = await storage.updateWorkerContactNameComponents(id, nameComponents);
        
        if (!worker) {
          res.status(404).json({ message: "Worker not found" });
          return;
        }
        
        res.json(worker);
      } else if (name && typeof name === 'string' && name.trim()) {
        // Old format: simple name string (for backwards compatibility)
        const worker = await storage.updateWorkerContactName(id, name.trim());
        
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
      const deleted = await storage.deleteWorker(id);
      
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
  
  // GET /api/employers - Get all employers (requires workers.view permission)
  app.get("/api/employers", requireAuth, requirePermission("workers.view"), async (req, res) => {
    try {
      const includeInactive = req.query.includeInactive === 'true';
      const allEmployers = await storage.getAllEmployers();
      
      // Filter to active only by default
      const employers = includeInactive 
        ? allEmployers 
        : allEmployers.filter(emp => emp.isActive);
      
      res.json(employers);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch employers" });
    }
  });

  // GET /api/employers/:id - Get a specific employer (requires workers.view permission)
  app.get("/api/employers/:id", requireAuth, requirePermission("workers.view"), async (req, res) => {
    try {
      const { id } = req.params;
      const employer = await storage.getEmployer(id);
      
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
      
      const employer = await storage.createEmployer({ 
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
      
      const employer = await storage.updateEmployer(id, updates);
      
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
      const deleted = await storage.deleteEmployer(id);
      
      if (!deleted) {
        res.status(404).json({ message: "Employer not found" });
        return;
      }
      
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Failed to delete employer" });
    }
  });

  // GET /api/trust-benefits - Get all trust benefits (requires workers.view permission)
  app.get("/api/trust-benefits", requireAuth, requirePermission("workers.view"), async (req, res) => {
    try {
      const includeInactive = req.query.includeInactive === 'true';
      const allBenefits = await storage.getAllTrustBenefits();
      
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
      const benefit = await storage.getTrustBenefit(id);
      
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
      
      const benefit = await storage.createTrustBenefit(parsed.data);
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
      
      const benefit = await storage.updateTrustBenefit(id, updates);
      
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
      const deleted = await storage.deleteTrustBenefit(id);
      
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
      const contact = await storage.getContact(id);
      
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
  app.put("/api/variables/address_validation_config", requireAuth, requirePermission("admin.manage"), async (req, res) => {
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
  app.put("/api/variables/phone_validation_config", requireAuth, requirePermission("admin.manage"), async (req, res) => {
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
      
      const configVar = await storage.getVariableByName('phone_validation_config');
      if (configVar) {
        console.log('Updating existing config variable:', configVar.id);
        await storage.updateVariable(configVar.id, {
          value: req.body,
        });
      } else {
        console.log('Creating new config variable');
        await storage.createVariable({
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
      const siteNameVar = await storage.getVariableByName("siteName");
      const siteName = siteNameVar ? (siteNameVar.value as string) : "Sirius";
      
      const siteFooterVar = await storage.getVariableByName("site_footer");
      const footer = siteFooterVar ? (siteFooterVar.value as string) : "";
      
      res.json({ siteName, footer });
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch site settings" });
    }
  });

  // PUT /api/site-settings - Update site settings (requires admin permissions)
  app.put("/api/site-settings", requireAuth, requirePermission("variables.manage"), async (req, res) => {
    try {
      const { siteName, footer } = req.body;
      
      // Update siteName if provided
      if (siteName !== undefined) {
        if (typeof siteName !== "string") {
          res.status(400).json({ message: "Invalid site name" });
          return;
        }
        
        const existingVariable = await storage.getVariableByName("siteName");
        if (existingVariable) {
          await storage.updateVariable(existingVariable.id, { value: siteName });
        } else {
          await storage.createVariable({ name: "siteName", value: siteName });
        }
      }
      
      // Update footer if provided
      if (footer !== undefined) {
        if (typeof footer !== "string") {
          res.status(400).json({ message: "Invalid footer content" });
          return;
        }
        
        const existingFooter = await storage.getVariableByName("site_footer");
        if (existingFooter) {
          await storage.updateVariable(existingFooter.id, { value: footer });
        } else {
          await storage.createVariable({ name: "site_footer", value: footer });
        }
      }
      
      // Return updated values
      const siteNameVar = await storage.getVariableByName("siteName");
      const finalSiteName = siteNameVar ? (siteNameVar.value as string) : "Sirius";
      
      const siteFooterVar = await storage.getVariableByName("site_footer");
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
      const genderOptions = await storage.getAllGenderOptions();
      res.json(genderOptions);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch gender options" });
    }
  });

  // GET /api/gender-options/:id - Get a specific gender option (requires workers.view permission)
  app.get("/api/gender-options/:id", requireAuth, requirePermission("workers.view"), async (req, res) => {
    try {
      const { id } = req.params;
      const genderOption = await storage.getGenderOption(id);
      
      if (!genderOption) {
        res.status(404).json({ message: "Gender option not found" });
        return;
      }
      
      res.json(genderOption);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch gender option" });
    }
  });

  // POST /api/gender-options - Create a new gender option (requires variables.manage permission)
  app.post("/api/gender-options", requireAuth, requirePermission("variables.manage"), async (req, res) => {
    try {
      const { name, code, nota, sequence } = req.body;
      
      if (!name || typeof name !== 'string' || !name.trim()) {
        return res.status(400).json({ message: "Name is required" });
      }
      
      if (!code || typeof code !== 'string' || !code.trim()) {
        return res.status(400).json({ message: "Code is required" });
      }
      
      const genderOption = await storage.createGenderOption({
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

  // PUT /api/gender-options/:id - Update a gender option (requires variables.manage permission)
  app.put("/api/gender-options/:id", requireAuth, requirePermission("variables.manage"), async (req, res) => {
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
      
      const genderOption = await storage.updateGenderOption(id, updates);
      
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

  // DELETE /api/gender-options/:id - Delete a gender option (requires variables.manage permission)
  app.delete("/api/gender-options/:id", requireAuth, requirePermission("variables.manage"), async (req, res) => {
    try {
      const { id } = req.params;
      const deleted = await storage.deleteGenderOption(id);
      
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
      const trustBenefitTypes = await storage.getAllTrustBenefitTypes();
      res.json(trustBenefitTypes);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch trust benefit types" });
    }
  });

  // GET /api/trust-benefit-types/:id - Get a specific trust benefit type (requires workers.view permission)
  app.get("/api/trust-benefit-types/:id", requireAuth, requirePermission("workers.view"), async (req, res) => {
    try {
      const { id } = req.params;
      const trustBenefitType = await storage.getTrustBenefitType(id);
      
      if (!trustBenefitType) {
        res.status(404).json({ message: "Trust benefit type not found" });
        return;
      }
      
      res.json(trustBenefitType);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch trust benefit type" });
    }
  });

  // POST /api/trust-benefit-types - Create a new trust benefit type (requires variables.manage permission)
  app.post("/api/trust-benefit-types", requireAuth, requirePermission("variables.manage"), async (req, res) => {
    try {
      const parsedData = insertTrustBenefitTypeSchema.safeParse(req.body);
      
      if (!parsedData.success) {
        res.status(400).json({ 
          message: "Invalid request data", 
          errors: parsedData.error.errors 
        });
        return;
      }
      
      const trustBenefitType = await storage.createTrustBenefitType(parsedData.data);
      res.status(201).json(trustBenefitType);
    } catch (error: any) {
      if (error.code === "23505") {
        res.status(409).json({ message: "Trust benefit type with this name already exists" });
        return;
      }
      res.status(500).json({ message: "Failed to create trust benefit type" });
    }
  });

  // PUT /api/trust-benefit-types/:id - Update a trust benefit type (requires variables.manage permission)
  app.put("/api/trust-benefit-types/:id", requireAuth, requirePermission("variables.manage"), async (req, res) => {
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
      
      const trustBenefitType = await storage.updateTrustBenefitType(id, parsedData.data);
      
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

  // DELETE /api/trust-benefit-types/:id - Delete a trust benefit type (requires variables.manage permission)
  app.delete("/api/trust-benefit-types/:id", requireAuth, requirePermission("variables.manage"), async (req, res) => {
    try {
      const { id } = req.params;
      const deleted = await storage.deleteTrustBenefitType(id);
      
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
      const workerIdTypes = await storage.getAllWorkerIdTypes();
      res.json(workerIdTypes);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch worker ID types" });
    }
  });

  // GET /api/worker-id-types/:id - Get a specific worker ID type (requires workers.view permission)
  app.get("/api/worker-id-types/:id", requireAuth, requirePermission("workers.view"), async (req, res) => {
    try {
      const { id } = req.params;
      const workerIdType = await storage.getWorkerIdType(id);
      
      if (!workerIdType) {
        res.status(404).json({ message: "Worker ID type not found" });
        return;
      }
      
      res.json(workerIdType);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch worker ID type" });
    }
  });

  // POST /api/worker-id-types - Create a new worker ID type (requires variables.manage permission)
  app.post("/api/worker-id-types", requireAuth, requirePermission("variables.manage"), async (req, res) => {
    try {
      const { name, sequence, validator } = req.body;
      
      if (!name || typeof name !== 'string' || !name.trim()) {
        return res.status(400).json({ message: "Name is required" });
      }
      
      const workerIdType = await storage.createWorkerIdType({
        name: name.trim(),
        sequence: typeof sequence === 'number' ? sequence : 0,
        validator: validator && typeof validator === 'string' ? validator.trim() : null,
      });
      
      res.status(201).json(workerIdType);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to create worker ID type" });
    }
  });

  // PUT /api/worker-id-types/:id - Update a worker ID type (requires variables.manage permission)
  app.put("/api/worker-id-types/:id", requireAuth, requirePermission("variables.manage"), async (req, res) => {
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
      
      const workerIdType = await storage.updateWorkerIdType(id, updates);
      
      if (!workerIdType) {
        res.status(404).json({ message: "Worker ID type not found" });
        return;
      }
      
      res.json(workerIdType);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to update worker ID type" });
    }
  });

  // DELETE /api/worker-id-types/:id - Delete a worker ID type (requires variables.manage permission)
  app.delete("/api/worker-id-types/:id", requireAuth, requirePermission("variables.manage"), async (req, res) => {
    try {
      const { id } = req.params;
      const deleted = await storage.deleteWorkerIdType(id);
      
      if (!deleted) {
        res.status(404).json({ message: "Worker ID type not found" });
        return;
      }
      
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Failed to delete worker ID type" });
    }
  });

  // Worker ID routes
  
  // GET /api/workers/:workerId/ids - Get all IDs for a worker (requires workers.view permission)
  app.get("/api/workers/:workerId/ids", requireAuth, requirePermission("workers.view"), async (req, res) => {
    try {
      const { workerId } = req.params;
      const workerIds = await storage.getWorkerIdsByWorkerId(workerId);
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
      const workerId = await storage.getWorkerId(id);
      
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
      const worker = await storage.getWorker(workerId);
      if (!worker) {
        return res.status(404).json({ message: "Worker not found" });
      }
      
      // Verify the type exists
      const type = await storage.getWorkerIdType(typeId);
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
      
      const newWorkerId = await storage.createWorkerId({
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
        const type = await storage.getWorkerIdType(typeId);
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
        const existingWorkerId = await storage.getWorkerId(id);
        if (!existingWorkerId) {
          return res.status(404).json({ message: "Worker ID not found" });
        }
        
        // Determine which type to validate against
        const typeToValidate = typeId ? typeId.trim() : existingWorkerId.typeId;
        const type = await storage.getWorkerIdType(typeToValidate);
        
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
      
      const updatedWorkerId = await storage.updateWorkerId(id, updates);
      
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
      const deleted = await storage.deleteWorkerId(id);
      
      if (!deleted) {
        res.status(404).json({ message: "Worker ID not found" });
        return;
      }
      
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Failed to delete worker ID" });
    }
  });

  // Worker Benefits (WMB) routes

  // GET /api/workers/:workerId/benefits - Get all benefits for a worker (requires workers.view permission)
  app.get("/api/workers/:workerId/benefits", requireAuth, requirePermission("workers.view"), async (req, res) => {
    try {
      const { workerId } = req.params;
      const benefits = await storage.getWorkerBenefits(workerId);
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

      const wmb = await storage.createWorkerBenefit({
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
      const deleted = await storage.deleteWorkerBenefit(id);

      if (!deleted) {
        return res.status(404).json({ message: "Worker benefit not found" });
      }

      res.status(204).send();
    } catch (error) {
      console.error("Failed to delete worker benefit:", error);
      res.status(500).json({ message: "Failed to delete worker benefit" });
    }
  });

  // Register generic variable management routes (MUST come after specific routes)
  registerVariableRoutes(app, requireAuth, requirePermission);


  const httpServer = createServer(app);
  return httpServer;
}
