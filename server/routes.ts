import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { db } from "./db";
import { insertWorkerSchema, type InsertEmployer, winstonLogs, type WorkerId, type ContactPostal, type PhoneNumber, workerHours } from "@shared/schema";
import { eq, and, inArray, gte, lte, desc, sql } from "drizzle-orm";
import { z } from "zod";
import { registerUserRoutes } from "./modules/users";
import { registerVariableRoutes } from "./modules/variables";
import { registerContactPostalRoutes } from "./modules/contact-postal";
import { registerPhoneNumberRoutes } from "./modules/phone-numbers";
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
import { registerComponentRoutes } from "./modules/components";
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
import { registerQuickstartRoutes } from "./modules/quickstart";
import { registerCronJobRoutes } from "./modules/cron_jobs";
import { registerChargePluginRoutes } from "./modules/charge-plugins";
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
  
  // Register trust provider user settings routes
  registerTrustProviderUserSettingsRoutes(app, requireAuth, requirePermission);
  
  // Register contact postal address management routes
  registerContactPostalRoutes(app, requireAuth, requirePermission);
  
  // Register phone number management routes
  registerPhoneNumberRoutes(app, requireAuth, requirePermission);
  
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
  registerLogRoutes(app);
  registerQuickstartRoutes(app);

  // Register cron job management routes
  registerCronJobRoutes(app, requireAuth, requirePermission);

  // Register charge plugin configuration routes
  registerChargePluginRoutes(app, requireAuth, requirePermission);

  // Worker routes (protected with authentication and permissions)
  
  // GET /api/workers/with-details - Get all workers with contact and phone data (optimized for list view)
  app.get("/api/workers/with-details", requireAuth, requirePermission("workers.view"), async (req, res) => {
    try {
      // Optimized query that joins workers, contacts, phone numbers, addresses, and benefit types in a single query
      const result = await db.execute(sql`
        SELECT 
          w.id,
          w.sirius_id,
          w.contact_id,
          w.ssn,
          w.denorm_ws_id,
          w.denorm_home_employer_id,
          w.denorm_employer_ids,
          c.display_name as contact_name,
          c.email as contact_email,
          c.given,
          c.middle,
          c.family,
          p.phone_number,
          p.is_primary,
          a.id as address_id,
          a.friendly_name as address_friendly_name,
          a.street as address_street,
          a.city as address_city,
          a.state as address_state,
          a.postal_code as address_postal_code,
          a.country as address_country,
          a.is_primary as address_is_primary,
          COALESCE(
            (
              SELECT json_agg(DISTINCT bt.name)
              FROM trust_wmb wmb
              INNER JOIN trust_benefits tb ON wmb.benefit_id = tb.id
              INNER JOIN options_trust_benefit_type bt ON tb.benefit_type = bt.id
              WHERE wmb.worker_id = w.id
                AND tb.is_active = true
            ),
            '[]'::json
          ) as benefit_types,
          COALESCE(
            (
              SELECT json_agg(DISTINCT wmb.benefit_id)
              FROM trust_wmb wmb
              INNER JOIN trust_benefits tb ON wmb.benefit_id = tb.id
              WHERE wmb.worker_id = w.id
                AND tb.is_active = true
            ),
            '[]'::json
          ) as benefit_ids,
          COALESCE(
            (
              SELECT json_agg(DISTINCT jsonb_build_object(
                'id', tb.id,
                'name', tb.name,
                'typeName', bt.name,
                'typeIcon', bt.icon
              ))
              FROM trust_wmb wmb
              INNER JOIN trust_benefits tb ON wmb.benefit_id = tb.id
              INNER JOIN options_trust_benefit_type bt ON tb.benefit_type = bt.id
              WHERE wmb.worker_id = w.id
                AND tb.is_active = true
            ),
            '[]'::json
          ) as benefits
        FROM workers w
        INNER JOIN contacts c ON w.contact_id = c.id
        LEFT JOIN LATERAL (
          SELECT phone_number, is_primary
          FROM contact_phone
          WHERE contact_id = c.id
          ORDER BY is_primary DESC NULLS LAST, created_at ASC
          LIMIT 1
        ) p ON true
        LEFT JOIN LATERAL (
          SELECT id, friendly_name, street, city, state, postal_code, country, is_primary
          FROM contact_postal
          WHERE contact_id = c.id AND is_active = true
          ORDER BY is_primary DESC NULLS LAST, created_at ASC
          LIMIT 1
        ) a ON true
        ORDER BY c.family, c.given
      `);
      
      res.json(result.rows);
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
      // Query to get unique employers for each worker from worker_hours
      const result = await db.execute(sql`
        SELECT 
          w.id as worker_id,
          COALESCE(
            json_agg(
              DISTINCT jsonb_build_object(
                'id', e.id,
                'name', e.name,
                'isHome', COALESCE(wh.home, false)
              )
            ) FILTER (WHERE e.id IS NOT NULL),
            '[]'::json
          ) as employers
        FROM workers w
        LEFT JOIN worker_hours wh ON w.id = wh.worker_id
        LEFT JOIN employers e ON wh.employer_id = e.id
        GROUP BY w.id
      `);
      
      // Transform the result into a more usable format
      const workerEmployers = result.rows.map((row: any) => ({
        workerId: row.worker_id,
        employers: row.employers || []
      }));
      
      res.json(workerEmployers);
    } catch (error) {
      console.error("Failed to fetch worker employers:", error);
      res.status(500).json({ message: "Failed to fetch worker employers" });
    }
  });

  // GET /api/workers/benefits/current - Get current month benefits for all workers (requires workers.view permission)
  app.get("/api/workers/benefits/current", requireAuth, requirePermission("workers.view"), async (req, res) => {
    try {
      // Get current month and year
      const now = new Date();
      const currentMonth = now.getMonth() + 1;
      const currentYear = now.getFullYear();

      // Query to get current benefits for each worker
      const result = await db.execute(sql`
        SELECT 
          w.id as worker_id,
          COALESCE(
            (
              SELECT json_agg(benefit_data)
              FROM (
                SELECT DISTINCT ON (tb.id, e.id)
                  jsonb_build_object(
                    'id', tb.id,
                    'name', tb.name,
                    'typeName', tbt.name,
                    'employerName', e.name
                  ) as benefit_data
                FROM trust_wmb wmb
                INNER JOIN trust_benefits tb ON wmb.benefit_id = tb.id
                LEFT JOIN options_trust_benefit_type tbt ON tb.benefit_type = tbt.id
                LEFT JOIN employers e ON wmb.employer_id = e.id
                WHERE wmb.worker_id = w.id
                  AND wmb.month = ${currentMonth}
                  AND wmb.year = ${currentYear}
                ORDER BY tb.id, e.id
              ) benefit_rows
            ),
            '[]'::json
          ) as benefits
        FROM workers w
      `);
      
      // Transform the result into a more usable format
      const workerBenefits = result.rows.map((row: any) => ({
        workerId: row.worker_id,
        benefits: Array.isArray(row.benefits) ? row.benefits : []
      }));
      
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
      
      // Query to get all workers for this employer from worker_hours (one row per worker)
      const result = await db.execute(sql`
        SELECT DISTINCT ON (w.id)
          w.id as "workerId",
          w.sirius_id as "workerSiriusId",
          c.display_name as "contactName",
          wh.id as "employmentHistoryId",
          NULL as "employmentStatusId",
          NULL as "employmentStatusName",
          NULL as position,
          NULL as date,
          wh.home
        FROM workers w
        INNER JOIN worker_hours wh ON w.id = wh.worker_id
        INNER JOIN contacts c ON w.contact_id = c.id
        WHERE wh.employer_id = ${employerId}
        ORDER BY w.id, c.family, c.given
      `);
      
      res.json(result.rows);
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

  // System Mode routes - Control application mode (dev/test/live)
  // GET /api/system-mode - Get current system mode (no auth required for indicator display)
  app.get("/api/system-mode", async (req, res) => {
    try {
      const modeVar = await storage.variables.getByName("system_mode");
      const mode = modeVar ? (modeVar.value as string) : "dev";
      res.json({ mode });
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch system mode" });
    }
  });

  // PUT /api/system-mode - Update system mode (requires admin policy)
  app.put("/api/system-mode", requireAccess(policies.admin), async (req, res) => {
    try {
      const { mode } = req.body;
      
      // Validate mode
      const validModes = ["dev", "test", "live"];
      if (!validModes.includes(mode)) {
        res.status(400).json({ message: "Invalid mode. Must be 'dev', 'test', or 'live'" });
        return;
      }
      
      // Update or create system_mode variable
      const existingVariable = await storage.variables.getByName("system_mode");
      if (existingVariable) {
        await storage.variables.update(existingVariable.id, { value: mode });
      } else {
        await storage.variables.create({ name: "system_mode", value: mode });
      }
      
      res.json({ mode });
    } catch (error) {
      res.status(500).json({ message: "Failed to update system mode" });
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

  // Worker Hours routes

  // GET /api/workers/:workerId/hours - Get hours for a worker with optional view parameter (requires worker policy: staff or worker with matching email)
  app.get("/api/workers/:workerId/hours", requireAuth, requireAccess(policies.worker), async (req, res) => {
    try {
      const { workerId } = req.params;
      const view = (req.query.view as string) || 'daily';
      
      let hours;
      switch (view) {
        case 'current':
          hours = await storage.workers.getWorkerHoursCurrent(workerId);
          break;
        case 'history':
          hours = await storage.workers.getWorkerHoursHistory(workerId);
          break;
        case 'monthly':
          hours = await storage.workers.getWorkerHoursMonthly(workerId);
          break;
        case 'daily':
        default:
          hours = await storage.workers.getWorkerHours(workerId);
          break;
      }
      
      res.json(hours);
    } catch (error) {
      console.error("Failed to fetch worker hours:", error);
      res.status(500).json({ message: "Failed to fetch worker hours" });
    }
  });

  // POST /api/workers/:workerId/hours - Create a new hours entry for a worker (requires workers.manage permission)
  app.post("/api/workers/:workerId/hours", requireAuth, requirePermission("workers.manage"), async (req, res) => {
    try {
      const { workerId } = req.params;
      const { month, year, day, employerId, employmentStatusId, hours, home } = req.body;

      if (!month || !year || !day || !employerId || !employmentStatusId) {
        return res.status(400).json({ message: "Month, year, day, employer ID, and employment status ID are required" });
      }

      const result = await storage.workers.createWorkerHours({
        workerId,
        month,
        year,
        day,
        employerId,
        employmentStatusId,
        hours: hours ?? null,
        home: home ?? false,
      });

      res.status(201).json({
        ...result.data,
        ledgerNotifications: result.notifications || [],
      });
    } catch (error: any) {
      console.error("Failed to create worker hours:", error);
      if (error.message?.includes("duplicate key") || error.code === "23505") {
        return res.status(409).json({ message: "Hours entry already exists for this worker, employer, and date" });
      }
      res.status(500).json({ message: "Failed to create worker hours" });
    }
  });

  // PATCH /api/worker-hours/:id - Update a worker hours entry (requires workers.manage permission)
  app.patch("/api/worker-hours/:id", requireAuth, requirePermission("workers.manage"), async (req, res) => {
    try {
      const { id } = req.params;
      const { year, month, day, employerId, employmentStatusId, hours, home } = req.body;

      const result = await storage.workers.updateWorkerHours(id, {
        year,
        month,
        day,
        employerId,
        employmentStatusId,
        hours,
        home,
      });

      if (!result) {
        return res.status(404).json({ message: "Worker hours entry not found" });
      }

      res.json({
        ...result.data,
        ledgerNotifications: result.notifications || [],
      });
    } catch (error: any) {
      console.error("Failed to update worker hours:", error);
      if (error.message?.includes("duplicate key") || error.code === "23505") {
        return res.status(409).json({ message: "Hours entry already exists for this worker, employer, and date" });
      }
      res.status(500).json({ message: "Failed to update worker hours" });
    }
  });

  // DELETE /api/worker-hours/:id - Delete a worker hours entry (requires workers.manage permission)
  app.delete("/api/worker-hours/:id", requireAuth, requirePermission("workers.manage"), async (req, res) => {
    try {
      const { id } = req.params;
      const result = await storage.workers.deleteWorkerHours(id);

      if (!result.success) {
        return res.status(404).json({ message: "Worker hours entry not found" });
      }

      // Return notifications if any, otherwise 204 No Content
      if (result.notifications && result.notifications.length > 0) {
        res.json({ ledgerNotifications: result.notifications });
      } else {
        res.status(204).send();
      }
    } catch (error) {
      console.error("Failed to delete worker hours:", error);
      res.status(500).json({ message: "Failed to delete worker hours" });
    }
  });

  // GET /api/worker-hours/:id/transactions - Get ledger entries for an hours entry
  app.get("/api/worker-hours/:id/transactions", requireAuth, requirePermission("workers.manage"), async (req, res) => {
    try {
      const { id } = req.params;
      
      // Get the hours entry to build the correct reference format
      const [hoursEntry] = await db.select().from(workerHours).where(eq(workerHours.id, id));
      
      if (!hoursEntry) {
        return res.json([]);
      }
      
      // Build the composite reference ID used by the GBHET plugin
      // Format: workerId:employerId:year:month
      const compositeReferenceId = `${hoursEntry.workerId}:${hoursEntry.employerId}:${hoursEntry.year}:${hoursEntry.month}`;
      
      const transactions = await storage.ledger.entries.getTransactions({
        referenceType: "hour",
        referenceId: compositeReferenceId,
      });
      res.json(transactions);
    } catch (error) {
      console.error("Failed to fetch hours transactions:", error);
      res.status(500).json({ message: "Failed to fetch hours transactions" });
    }
  });

  // Worker Work Status History routes
  
  // GET /api/workers/:workerId/wsh - Get work status history for a worker (requires worker policy: staff or worker with matching email)
  app.get("/api/workers/:workerId/wsh", requireAuth, requireAccess(policies.worker), async (req, res) => {
    try {
      const { workerId } = req.params;
      const wshEntries = await storage.workers.getWorkerWsh(workerId);
      res.json(wshEntries);
    } catch (error) {
      console.error("Failed to fetch worker work status history:", error);
      res.status(500).json({ message: "Failed to fetch worker work status history" });
    }
  });

  // POST /api/workers/:workerId/wsh - Create a new work status history entry for a worker (requires workers.manage permission)
  app.post("/api/workers/:workerId/wsh", requireAuth, requirePermission("workers.manage"), async (req, res) => {
    try {
      const { workerId } = req.params;
      const { date, wsId, data } = req.body;

      const wshEntry = await storage.workers.createWorkerWsh({
        workerId,
        date,
        wsId,
        data,
      });

      res.status(201).json(wshEntry);
    } catch (error: any) {
      console.error("Failed to create worker work status history:", error);
      if (error.message?.includes("duplicate key") || error.code === "23505") {
        return res.status(409).json({ message: "Work status history entry already exists" });
      }
      res.status(500).json({ message: "Failed to create worker work status history" });
    }
  });

  // PATCH /api/worker-wsh/:id - Update a worker work status history entry (requires workers.manage permission)
  app.patch("/api/worker-wsh/:id", requireAuth, requirePermission("workers.manage"), async (req, res) => {
    try {
      const { id } = req.params;
      const { date, wsId, data } = req.body;

      const updated = await storage.workers.updateWorkerWsh(id, {
        date,
        wsId,
        data,
      });

      if (!updated) {
        return res.status(404).json({ message: "Worker work status history entry not found" });
      }

      res.json(updated);
    } catch (error: any) {
      console.error("Failed to update worker work status history:", error);
      if (error.message?.includes("duplicate key") || error.code === "23505") {
        return res.status(409).json({ message: "Work status history entry already exists" });
      }
      res.status(500).json({ message: "Failed to update worker work status history" });
    }
  });

  // DELETE /api/worker-wsh/:id - Delete a worker work status history entry (requires workers.manage permission)
  app.delete("/api/worker-wsh/:id", requireAuth, requirePermission("workers.manage"), async (req, res) => {
    try {
      const { id } = req.params;
      const deleted = await storage.workers.deleteWorkerWsh(id);

      if (!deleted) {
        return res.status(404).json({ message: "Worker work status history entry not found" });
      }

      res.status(204).send();
    } catch (error) {
      console.error("Failed to delete worker work status history:", error);
      res.status(500).json({ message: "Failed to delete worker work status history" });
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

      // Query by host entity IDs: worker ID and contact ID
      // This will capture all logs for:
      // - Worker (hostEntityId = workerId)
      // - Worker IDs (hostEntityId = workerId)
      // - Worker employment history (hostEntityId = workerId)
      // - Contact (hostEntityId = contactId)
      // - Addresses (hostEntityId = contactId)
      // - Phone numbers (hostEntityId = contactId)
      const hostEntityIds: string[] = [workerId];
      if (worker.contactId) {
        hostEntityIds.push(worker.contactId);
      }

      // Build all conditions including the host entity ID filter
      const conditions = [inArray(winstonLogs.hostEntityId, hostEntityIds)];
      
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

      // Query by host entity IDs: employer ID and all contact IDs from employer contacts
      // This will capture all logs for:
      // - Employer (hostEntityId = employerId)
      // - Employer contacts (hostEntityId = employerId)
      // - Contacts (hostEntityId = contactId for each employer contact)
      // - Addresses (hostEntityId = contactId)
      // - Phone numbers (hostEntityId = contactId)
      const hostEntityIds: string[] = [employerId];

      // Get all employer contacts for this employer
      const employerContacts = await storage.employerContacts.listByEmployer(employerId);
      
      // Add all contact IDs from employer contacts
      const contactIds = employerContacts.map(ec => ec.contactId);
      hostEntityIds.push(...contactIds);

      // Build all conditions including the host entity ID filter
      const conditions = [inArray(winstonLogs.hostEntityId, hostEntityIds)];
      
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
