import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertWorkerSchema, type InsertEmployer, type WorkerId, type ContactPostal, type PhoneNumber } from "@shared/schema";
import { z } from "zod";
import { registerUserRoutes } from "./modules/users";
import { registerVariableRoutes } from "./modules/variables";
import { registerContactPostalRoutes } from "./modules/contact-postal";
import { registerPhoneNumberRoutes } from "./modules/phone-numbers";
import { registerCommRoutes } from "./modules/comm";
import { registerEmployerContactRoutes } from "./modules/employer-contacts";
import { registerTrustBenefitsRoutes } from "./modules/trust-benefits";
import { registerTrustProvidersRoutes } from "./modules/trust-providers";
import { registerTrustProviderContactRoutes } from "./modules/trust-provider-contacts";
import { registerOptionsRoutes } from "./modules/options";
import { registerWorkerIdsRoutes } from "./modules/worker-ids";
import { registerAddressValidationRoutes } from "./modules/address-validation";
import { registerMasqueradeRoutes, getEffectiveUser } from "./modules/masquerade";
import { registerDashboardRoutes } from "./modules/dashboard";
import { registerBookmarkRoutes } from "./modules/bookmarks";
import { registerComponentRoutes, getEnabledComponentIds } from "./modules/components";
import { registerEmployerUserSettingsRoutes } from "./modules/employer-user-settings";
import { registerTrustProviderUserSettingsRoutes } from "./modules/trust-provider-user-settings";
import { registerWizardRoutes } from "./modules/wizards";
import { registerFileRoutes } from "./modules/files";
import { registerLedgerStripeRoutes } from "./modules/ledger/stripe";
import { registerLedgerAccountRoutes } from "./modules/ledger/accounts";
import { registerLedgerEaRoutes } from "./modules/ledger/ea";
import { registerLedgerPaymentRoutes } from "./modules/ledger/payments";
import { registerAccessPolicyRoutes } from "./modules/access-policies";
import { registerLogRoutes } from "./modules/logs";
import { registerWorkerWshRoutes } from "./modules/worker-wsh";
import { registerWorkerHoursRoutes } from "./modules/worker-hours";
import { registerQuickstartRoutes } from "./modules/quickstart";
import { registerCronJobRoutes } from "./modules/cron_jobs";
import { registerChargePluginRoutes } from "./modules/charge-plugins";
import { registerEligibilityPluginRoutes } from "./modules/eligibility-plugins";
import { registerTwilioRoutes } from "./modules/twilio";
import { registerEmailConfigRoutes } from "./modules/email-config";
import { registerPostalConfigRoutes } from "./modules/postal-config";
import { registerSiteSettingsRoutes } from "./modules/site-settings";
import { registerSystemModeRoutes } from "./modules/system-mode";
import { registerBootstrapRoutes } from "./modules/bootstrap";
import { registerPoliciesRoutes } from "./modules/policies";
import { registerEmployerPolicyHistoryRoutes } from "./modules/employer-policy-history";
import { registerWorkerBenefitsScanRoutes } from "./modules/worker-benefits-scan";
import { registerWmbScanQueueRoutes } from "./modules/wmb-scan-queue";
import { requireAccess } from "./accessControl";
import { policies } from "./policies";
import { addressValidationService } from "./services/address-validation";
import { phoneValidationService } from "./services/phone-validation";
import { serviceRegistry } from "./services/service-registry";
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
      const enabledComponents = await getEnabledComponentIds();
      
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
        components: enabledComponents,
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
  
  // Register trust provider user settings routes
  registerTrustProviderUserSettingsRoutes(app, requireAuth, requirePermission);
  
  // Register contact postal address management routes
  registerContactPostalRoutes(app, requireAuth, requirePermission);
  
  // Register phone number management routes
  registerPhoneNumberRoutes(app, requireAuth, requirePermission, requireAccess);
  
  // Register communication routes
  registerCommRoutes(app, requireAuth, requirePermission, requireAccess);
  
  // Register employer contact routes
  registerEmployerContactRoutes(app, requireAuth, requirePermission);
  
  // Register trust benefits routes
  registerTrustBenefitsRoutes(app, requireAuth, requirePermission);
  
  // Register trust providers routes
  registerTrustProvidersRoutes(app, requireAuth, requirePermission, requireAccess);
  
  // Register trust provider contacts routes
  registerTrustProviderContactRoutes(app, requireAuth, requirePermission);
  
  // Register options routes (worker-id-types, employer-contact-types, worker-work-statuses, employment-statuses)
  registerOptionsRoutes(app, requireAuth, requirePermission);
  
  // Register worker IDs routes
  registerWorkerIdsRoutes(app, requireAuth, requirePermission);
  
  // Register address validation routes
  registerAddressValidationRoutes(app, requireAuth, requirePermission);
  
  // Register dashboard routes
  registerDashboardRoutes(app, requireAuth, requirePermission);
  
  // Register bookmark routes
  registerBookmarkRoutes(app, requireAuth, requirePermission);

  // Register wizard routes
  registerWizardRoutes(app, requireAuth, requirePermission);

  // Register file management routes
  registerFileRoutes(app, requireAuth, requirePermission);

  // Register component configuration routes
  registerComponentRoutes(app, requireAuth, requirePermission);

  // Register ledger/stripe routes
  registerLedgerStripeRoutes(app);

  // Register ledger/accounts routes
  registerLedgerAccountRoutes(app);

  // Register ledger/EA routes
  registerLedgerEaRoutes(app);

  // Register ledger/payments routes
  registerLedgerPaymentRoutes(app);

  // Register log management routes
  registerLogRoutes(app, requireAuth, requirePermission, requireAccess, policies);
  registerWorkerWshRoutes(app, requireAuth, requirePermission, requireAccess, policies, storage.workerWsh);
  registerWorkerHoursRoutes(app, requireAuth, requirePermission, requireAccess, policies, storage.workerHours, storage.ledger);
  registerQuickstartRoutes(app);

  // Register cron job management routes
  registerCronJobRoutes(app, requireAuth, requirePermission);

  // Register charge plugin configuration routes
  registerChargePluginRoutes(app, requireAuth, requirePermission);

  // Register eligibility plugin routes
  registerEligibilityPluginRoutes(app, requireAuth, requirePermission);

  // Register Twilio configuration routes
  registerTwilioRoutes(app);

  // Register Email configuration routes
  registerEmailConfigRoutes(app);

  // Register Postal configuration routes
  registerPostalConfigRoutes(app);

  // Register site settings routes
  registerSiteSettingsRoutes(app, requireAuth, requirePermission, requireAccess, policies);

  // Register system mode routes
  registerSystemModeRoutes(app, requireAuth, requirePermission, requireAccess, policies);

  // Register bootstrap routes (no auth required - intentionally public for initial setup)
  registerBootstrapRoutes(app);

  // Register policies configuration routes
  registerPoliciesRoutes(app, requireAuth, requireAccess, storage);

  // Register employer policy history routes
  registerEmployerPolicyHistoryRoutes(app, requireAuth, requireAccess, storage);

  // Register worker benefits scan routes
  registerWorkerBenefitsScanRoutes(app, requireAuth, requireAccess, storage);

  // Register WMB scan queue routes (admin only)
  registerWmbScanQueueRoutes(app, requireAuth, requireAccess, storage);

  // Worker routes (protected with authentication and permissions)
  
  // GET /api/workers/with-details - Get all workers with contact and phone data (optimized for list view)
  app.get("/api/workers/with-details", requireAuth, requirePermission("workers.view"), async (req, res) => {
    try {
      const workers = await storage.workers.getWorkersWithDetails();
      res.json(workers);
    } catch (error) {
      console.error("Failed to fetch workers with details:", error);
      res.status(500).json({ message: "Failed to fetch workers" });
    }
  });
  
  // GET /api/workers - Get all workers (requires workers.view permission)
  app.get("/api/workers", requireAuth, requirePermission("workers.view"), async (req, res) => {
    try {
      const workers = await storage.workers.getAllWorkers();
      res.json(workers);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch workers" });
    }
  });

  // GET /api/workers/employers/summary - Get employer summary for all workers (requires workers.view permission)
  app.get("/api/workers/employers/summary", requireAuth, requirePermission("workers.view"), async (req, res) => {
    try {
      const workerEmployers = await storage.workers.getWorkersEmployersSummary();
      res.json(workerEmployers);
    } catch (error) {
      console.error("Failed to fetch worker employers:", error);
      res.status(500).json({ message: "Failed to fetch worker employers" });
    }
  });

  // GET /api/workers/benefits/current - Get current month benefits for all workers (requires workers.view permission)
  app.get("/api/workers/benefits/current", requireAuth, requirePermission("workers.view"), async (req, res) => {
    try {
      const workerBenefits = await storage.workers.getWorkersCurrentBenefits();
      res.json(workerBenefits);
    } catch (error) {
      console.error("Failed to fetch worker current benefits:", error);
      res.status(500).json({ message: "Failed to fetch worker current benefits" });
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

  // GET /api/employers/:employerId/workers - Get workers for an employer (requires employerUser policy)
  app.get("/api/employers/:employerId/workers", requireAuth, requireAccess(policies.employerUser), async (req, res) => {
    try {
      const { employerId } = req.params;
      
      // Verify employer exists
      const employer = await storage.employers.getEmployer(employerId);
      if (!employer) {
        res.status(404).json({ message: "Employer not found" });
        return;
      }
      
      const workers = await storage.employers.getEmployerWorkers(employerId);
      res.json(workers);
    } catch (error) {
      console.error("Failed to fetch employer workers:", error);
      res.status(500).json({ message: "Failed to fetch employer workers" });
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
  // Now derived from SMS provider selection, with stored settings for each provider
  app.get("/api/variables/phone_validation_config", requireAuth, async (req, res) => {
    try {
      const smsConfig = await serviceRegistry.getCategoryConfig('sms');
      const isTwilioMode = smsConfig.defaultProvider === 'twilio';
      
      // Get stored validation settings from both providers
      const localSettings = await serviceRegistry.getProviderSettings('sms', 'local');
      const twilioSettings = await serviceRegistry.getProviderSettings('sms', 'twilio');
      const localValidation = (localSettings as any)?.phoneValidation || {};
      const twilioValidation = (twilioSettings as any)?.phoneValidation || {};
      
      // Return config in the legacy format for backward compatibility
      // Fallback settings are stored with twilio provider since they control Twilio failure behavior
      res.json({
        mode: isTwilioMode ? 'twilio' : 'local',
        local: {
          enabled: !isTwilioMode,
          defaultCountry: localValidation.defaultCountry || 'US',
          strictValidation: localValidation.strictValidation ?? true
        },
        twilio: {
          enabled: isTwilioMode,
          lookupType: twilioValidation.lookupType || ['line_type_intelligence', 'caller_name']
        },
        fallback: {
          useLocalOnTwilioFailure: twilioValidation.useLocalOnTwilioFailure ?? true,
          logValidationAttempts: twilioValidation.logValidationAttempts ?? true
        }
      });
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch phone validation configuration" });
    }
  });

  // PUT /api/variables/phone_validation_config - Update phone validation configuration
  // Now updates the SMS provider selection and stores validation settings for each provider
  app.put("/api/variables/phone_validation_config", requireAuth, requireAccess(policies.admin), async (req, res) => {
    try {
      const { mode, local, twilio, fallback } = req.body;
      
      if (!mode || (mode !== "local" && mode !== "twilio")) {
        return res.status(400).json({ message: "Invalid validation mode. Must be 'local' or 'twilio'." });
      }
      
      // Store local-specific settings in the local provider
      if (local) {
        const localCurrentSettings = await serviceRegistry.getProviderSettings('sms', 'local');
        const existingLocalValidation = (localCurrentSettings as any)?.phoneValidation || {};
        const localValidationSettings = {
          ...existingLocalValidation,
          defaultCountry: local.defaultCountry ?? existingLocalValidation.defaultCountry ?? 'US',
          strictValidation: local.strictValidation ?? existingLocalValidation.strictValidation ?? true
        };
        await serviceRegistry.saveProviderSettings('sms', 'local', {
          ...localCurrentSettings,
          phoneValidation: localValidationSettings
        });
      }
      
      // Store twilio-specific settings and fallback settings in the twilio provider
      // Fallback settings belong with twilio since they control Twilio failure behavior
      const twilioCurrentSettings = await serviceRegistry.getProviderSettings('sms', 'twilio');
      const existingTwilioValidation = (twilioCurrentSettings as any)?.phoneValidation || {};
      const twilioValidationSettings = {
        ...existingTwilioValidation,
        lookupType: twilio?.lookupType ?? existingTwilioValidation.lookupType ?? ['line_type_intelligence', 'caller_name'],
        useLocalOnTwilioFailure: fallback?.useLocalOnTwilioFailure ?? existingTwilioValidation.useLocalOnTwilioFailure ?? true,
        logValidationAttempts: fallback?.logValidationAttempts ?? existingTwilioValidation.logValidationAttempts ?? true
      };
      await serviceRegistry.saveProviderSettings('sms', 'twilio', {
        ...twilioCurrentSettings,
        phoneValidation: twilioValidationSettings
      });
      
      // Update the SMS provider selection
      await serviceRegistry.setDefaultProvider('sms', mode);
      
      // Fetch updated config from both providers for response
      const localSettings = await serviceRegistry.getProviderSettings('sms', 'local');
      const twilioSettings = await serviceRegistry.getProviderSettings('sms', 'twilio');
      const localValidation = (localSettings as any)?.phoneValidation || {};
      const twilioValidation = (twilioSettings as any)?.phoneValidation || {};
      
      const smsConfig = await serviceRegistry.getCategoryConfig('sms');
      const isTwilioMode = smsConfig.defaultProvider === 'twilio';
      
      // Return config in the legacy format
      res.json({
        mode: isTwilioMode ? 'twilio' : 'local',
        local: {
          enabled: !isTwilioMode,
          defaultCountry: localValidation.defaultCountry || 'US',
          strictValidation: localValidation.strictValidation ?? true
        },
        twilio: {
          enabled: isTwilioMode,
          lookupType: twilioValidation.lookupType || ['line_type_intelligence', 'caller_name']
        },
        fallback: {
          useLocalOnTwilioFailure: twilioValidation.useLocalOnTwilioFailure ?? true,
          logValidationAttempts: twilioValidation.logValidationAttempts ?? true
        }
      });
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

  // Register generic variable management routes (MUST come after specific routes)
  registerVariableRoutes(app, requireAuth, requirePermission);


  const httpServer = createServer(app);
  return httpServer;
}
