import type { Express, Request, Response, NextFunction } from "express";
import { storage } from "../storage";
import { requireAccess } from "../services/access-policy-evaluator";
import { requireComponent } from "./components";
import { employerMonthlyPluginConfigSchema } from "@shared/schema";
import { getPluginMetadata } from "@shared/pluginMetadata";
import { getEffectiveUser } from "./masquerade";
import { wizardEmployerMonthly, wizards, ledgerEa, ledger, ledgerAccounts } from "@shared/schema";
import { eq, and, or, desc, sql, sum, inArray } from "drizzle-orm";
import { getClient } from "../storage/transaction-context";
import { isComponentEnabledSync } from "../services/component-cache";

// Content resolver context passed to each plugin's content resolver
interface ContentResolverContext {
  userId: string;
  userRoles: Array<{ id: string; name: string }>;
}

// Content resolver function type
type ContentResolver = (ctx: ContentResolverContext) => Promise<any>;

// Registry of content resolvers for each plugin
const contentResolvers: Record<string, ContentResolver> = {
  "welcome-messages": async (ctx) => {
    // Get welcome messages settings
    const variableName = "dashboard_plugin_welcome-messages_settings";
    let variable = await storage.variables.getByName(variableName);
    
    // If unified settings don't exist, try to migrate from legacy format
    if (!variable) {
      const roles = await storage.users.getAllRoles();
      const migratedSettings: Record<string, string> = {};
      
      for (const role of roles) {
        const legacyVarName = `welcome_message_${role.id}`;
        const legacyVar = await storage.variables.getByName(legacyVarName);
        if (legacyVar) {
          migratedSettings[role.id] = legacyVar.value as string;
        }
      }
      
      // Save migrated settings to new unified variable
      if (Object.keys(migratedSettings).length > 0) {
        await storage.variables.create({ 
          name: variableName, 
          value: migratedSettings 
        });
        variable = await storage.variables.getByName(variableName);
      }
    }
    
    const allMessages = variable ? (variable.value as Record<string, string>) : {};
    
    // Filter messages to only include those for the user's roles
    const userRoleIds = new Set(ctx.userRoles.map(r => r.id));
    const userMessages: Array<{ roleId: string; roleName: string; message: string }> = [];
    
    for (const role of ctx.userRoles) {
      const message = allMessages[role.id];
      if (message) {
        userMessages.push({
          roleId: role.id,
          roleName: role.name,
          message,
        });
      }
    }
    
    return { messages: userMessages };
  },
};

type AuthMiddleware = (req: Request, res: Response, next: NextFunction) => void | Promise<any>;
type PermissionMiddleware = (permissionKey: string) => (req: Request, res: Response, next: NextFunction) => void | Promise<any>;

export function registerDashboardRoutes(
  app: Express, 
  requireAuth: AuthMiddleware, 
  requirePermission: PermissionMiddleware
) {
  // Dashboard Plugins routes - Manage dashboard plugin configurations
  
  // GET /api/dashboard-plugins/config - Get all plugin configurations
  app.get("/api/dashboard-plugins/config", requireAuth, async (req, res) => {
    try {
      const allVariables = await storage.variables.getAll();
      const pluginConfigs = allVariables
        .filter(v => v.name.startsWith('dashboard_plugin_'))
        .map(v => ({
          pluginId: v.name.replace('dashboard_plugin_', ''),
          enabled: v.value as boolean,
        }));
      
      res.json(pluginConfigs);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch plugin configurations" });
    }
  });

  // PUT /api/dashboard-plugins/config/:pluginId - Update a plugin's configuration
  app.put("/api/dashboard-plugins/config/:pluginId", requireAccess('admin'), async (req, res) => {
    try {
      const { pluginId } = req.params;
      const { enabled } = req.body;
      
      if (typeof enabled !== "boolean") {
        res.status(400).json({ message: "Invalid enabled value" });
        return;
      }
      
      const variableName = `dashboard_plugin_${pluginId}`;
      const existingVariable = await storage.variables.getByName(variableName);
      
      if (existingVariable) {
        await storage.variables.update(existingVariable.id, { value: enabled });
      } else {
        await storage.variables.create({ name: variableName, value: enabled });
      }
      
      res.json({ pluginId, enabled });
    } catch (error) {
      res.status(500).json({ message: "Failed to update plugin configuration" });
    }
  });

  // GET /api/dashboard-plugins/:pluginId/settings - Get plugin settings
  app.get("/api/dashboard-plugins/:pluginId/settings", requireAccess('admin'), async (req, res) => {
    try {
      const { pluginId } = req.params;
      
      // Get plugin metadata to validate plugin exists
      const metadata = getPluginMetadata(pluginId);
      if (!metadata) {
        res.status(404).json({ message: "Plugin not found" });
        return;
      }
      
      const variableName = `dashboard_plugin_${pluginId}_settings`;
      const variable = await storage.variables.getByName(variableName);
      
      // If unified settings don't exist, try to migrate from legacy format
      if (!variable && pluginId === "welcome-messages") {
        // Migrate welcome messages from individual role variables
        const roles = await storage.users.getAllRoles();
        const migratedSettings: Record<string, string> = {};
        
        for (const role of roles) {
          const legacyVarName = `welcome_message_${role.id}`;
          const legacyVar = await storage.variables.getByName(legacyVarName);
          if (legacyVar) {
            migratedSettings[role.id] = legacyVar.value as string;
          }
        }
        
        // Save migrated settings to new unified variable
        if (Object.keys(migratedSettings).length > 0) {
          await storage.variables.create({ 
            name: variableName, 
            value: migratedSettings 
          });
          res.json(migratedSettings);
          return;
        }
      } else if (!variable && pluginId === "employer-monthly-uploads") {
        // Migrate employer monthly config from legacy variable
        const legacyVar = await storage.variables.getByName('employer_monthly_plugin_config');
        if (legacyVar) {
          const migratedSettings = legacyVar.value as Record<string, string[]>;
          await storage.variables.create({ 
            name: variableName, 
            value: migratedSettings 
          });
          res.json(migratedSettings);
          return;
        }
      }
      
      res.json(variable ? variable.value : {});
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch plugin settings" });
    }
  });

  // PUT /api/dashboard-plugins/:pluginId/settings - Update plugin settings
  app.put("/api/dashboard-plugins/:pluginId/settings", requireAccess('admin'), async (req, res) => {
    try {
      const { pluginId } = req.params;
      const settings = req.body;
      
      // Get plugin metadata to validate schema
      const metadata = getPluginMetadata(pluginId);
      if (!metadata) {
        res.status(404).json({ message: "Plugin not found" });
        return;
      }
      
      // Validate settings against schema if provided
      if (metadata.settingsSchema) {
        const result = metadata.settingsSchema.safeParse(settings);
        if (!result.success) {
          res.status(400).json({ 
            message: "Invalid settings format",
            errors: result.error.errors,
          });
          return;
        }
      }
      
      const variableName = `dashboard_plugin_${pluginId}_settings`;
      const existingVariable = await storage.variables.getByName(variableName);
      
      if (existingVariable) {
        await storage.variables.update(existingVariable.id, { value: settings });
      } else {
        await storage.variables.create({ name: variableName, value: settings });
      }
      
      res.json({ success: true, settings });
    } catch (error) {
      res.status(500).json({ message: "Failed to update plugin settings" });
    }
  });

  // GET /api/dashboard-plugins/:pluginId/content - Get user-specific plugin content
  app.get("/api/dashboard-plugins/:pluginId/content", requireAuth, async (req, res) => {
    try {
      const { pluginId } = req.params;
      
      // Check if a content resolver exists for this plugin
      const resolver = contentResolvers[pluginId];
      if (!resolver) {
        res.status(404).json({ message: `No content resolver for plugin '${pluginId}'` });
        return;
      }
      
      // Get effective user
      const user = req.user as any;
      const session = req.session as any;
      const { dbUser } = await getEffectiveUser(session, user);
      
      if (!dbUser) {
        res.status(401).json({ message: "User not found" });
        return;
      }
      
      // Get user's roles
      const userRoles = await storage.users.getUserRoles(dbUser.id);
      
      // Build resolver context
      const ctx: ContentResolverContext = {
        userId: dbUser.id,
        userRoles: userRoles.map(r => ({ id: r.id, name: r.name })),
      };
      
      // Execute the resolver
      const content = await resolver(ctx);
      res.json(content);
    } catch (error) {
      console.error("Error fetching plugin content:", error);
      res.status(500).json({ message: "Failed to fetch plugin content" });
    }
  });

  // Employer Monthly Plugin routes - Manage employer monthly upload statistics and configuration
  
  // GET /api/dashboard-plugins/employer-monthly/stats - Get employer upload statistics for a specific month
  app.get("/api/dashboard-plugins/employer-monthly/stats", requireAuth, async (req, res) => {
    try {
      const { year, month, wizardType } = req.query;
      const user = req.user as any;
      const session = req.session as any;
      const { dbUser } = await getEffectiveUser(session, user);
      
      if (!dbUser) {
        res.status(401).json({ message: "User not found" });
        return;
      }
      
      // Default to current month if not provided
      const now = new Date();
      const yearNum = year ? Number(year) : now.getFullYear();
      const monthNum = month ? Number(month) : now.getMonth() + 1;
      
      if (!wizardType || typeof wizardType !== 'string') {
        res.status(400).json({ message: "Wizard type is required" });
        return;
      }
      
      if (!Number.isInteger(yearNum) || yearNum < 1900 || yearNum > 2100) {
        res.status(400).json({ message: "Year must be a valid integer between 1900 and 2100" });
        return;
      }
      
      if (!Number.isInteger(monthNum) || monthNum < 1 || monthNum > 12) {
        res.status(400).json({ message: "Month must be a valid integer between 1 and 12" });
        return;
      }
      
      // Verify user has access to this wizard type
      const userRoles = await storage.users.getUserRoles(dbUser.id);
      const variable = await storage.variables.getByName('dashboard_plugin_employer-monthly-uploads_settings');
      const config = variable ? (variable.value as Record<string, string[]>) : {};
      
      const allowedWizardTypes = new Set<string>();
      for (const role of userRoles) {
        const roleTypes = config[role.id] || [];
        roleTypes.forEach(type => allowedWizardTypes.add(type));
      }
      
      if (!allowedWizardTypes.has(wizardType)) {
        res.status(403).json({ message: "Access denied: You do not have permission to view statistics for this wizard type" });
        return;
      }
      
      const stats = await storage.wizardEmployerMonthly.getMonthlyStats(
        yearNum,
        monthNum,
        wizardType
      );
      
      res.json(stats);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch employer monthly stats" });
    }
  });

  // GET /api/dashboard-plugins/employer-monthly/my-wizard-types - Get wizard types for current user's roles
  app.get("/api/dashboard-plugins/employer-monthly/my-wizard-types", requireAuth, async (req, res) => {
    try {
      const user = req.user as any;
      const session = req.session as any;
      const { dbUser } = await getEffectiveUser(session, user);
      
      if (!dbUser) {
        res.status(401).json({ message: "User not found" });
        return;
      }

      const userRoles = await storage.users.getUserRoles(dbUser.id);
      const variable = await storage.variables.getByName('dashboard_plugin_employer-monthly-uploads_settings');
      const config = variable ? (variable.value as Record<string, string[]>) : {};
      
      const wizardTypesSet = new Set<string>();
      for (const role of userRoles) {
        const roleTypes = config[role.id] || [];
        roleTypes.forEach(type => wizardTypesSet.add(type));
      }
      
      res.json(Array.from(wizardTypesSet));
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch wizard types for user" });
    }
  });

  // GET /api/dashboard-plugins/my-steward - Get stewards for current user's home employer and bargaining unit
  app.get("/api/dashboard-plugins/my-steward", requireAuth, requireComponent("worker.steward"), async (req, res) => {
    try {
      const user = req.user as any;
      const session = req.session as any;
      
      // Use getEffectiveUser to respect masquerading
      const { dbUser } = await getEffectiveUser(session, user);
      
      if (!dbUser || !dbUser.email) {
        res.json({ stewards: [], worker: null });
        return;
      }

      // Find the worker linked to this user's email
      const worker = await storage.workers.getWorkerByContactEmail(dbUser.email);
      if (!worker) {
        res.json({ stewards: [], worker: null });
        return;
      }

      // Get employer and bargaining unit names for display (if available)
      const employer = worker.denormHomeEmployerId 
        ? await storage.employers.getEmployer(worker.denormHomeEmployerId)
        : null;
      const bargainingUnit = worker.bargainingUnitId
        ? await storage.bargainingUnits.getBargainingUnitById(worker.bargainingUnitId)
        : null;

      // Check if worker has home employer and bargaining unit
      if (!worker.denormHomeEmployerId || !worker.bargainingUnitId) {
        res.json({ 
          stewards: [], 
          worker: { id: worker.id },
          employer: employer ? { id: employer.id, name: employer.name } : null,
          bargainingUnit: bargainingUnit ? { id: bargainingUnit.id, name: bargainingUnit.name } : null,
        });
        return;
      }

      // Get steward assignments for this employer + bargaining unit combination
      const stewardAssignments = await storage.workerStewardAssignments.getStewardsByEmployerAndBargainingUnit(
        worker.denormHomeEmployerId,
        worker.bargainingUnitId
      );

      // Fetch phone numbers for each steward's contact
      const stewardsWithPhones = await Promise.all(
        stewardAssignments.map(async (steward) => {
          // Get the steward's worker record to get their contactId
          const stewardWorker = await storage.workers.getWorker(steward.workerId);
          if (!stewardWorker) {
            return steward;
          }

          // Get phone numbers for the contact
          const phoneNumbers = await storage.contacts.phoneNumbers.getPhoneNumbersByContact(stewardWorker.contactId);
          const primaryPhone = phoneNumbers.find(p => p.isPrimary)?.phoneNumber || phoneNumbers[0]?.phoneNumber || null;

          return {
            ...steward,
            phone: primaryPhone,
          };
        })
      );

      res.json({
        stewards: stewardsWithPhones,
        worker: { id: worker.id },
        employer: employer ? { id: employer.id, name: employer.name } : null,
        bargainingUnit: bargainingUnit ? { id: bargainingUnit.id, name: bargainingUnit.name } : null,
      });
    } catch (error) {
      console.error("Error fetching my steward data:", error);
      res.status(500).json({ message: "Failed to fetch steward data" });
    }
  });

  app.get("/api/dashboard-plugins/my-shops", requireAuth, async (req, res) => {
    try {
      const user = req.user as any;
      const session = req.session as any;
      const { dbUser } = await getEffectiveUser(session, user);

      if (!dbUser?.email) {
        res.json([]);
        return;
      }

      const contact = await storage.contacts?.getContactByEmail?.(dbUser.email);
      if (!contact) {
        res.json([]);
        return;
      }

      const employerContactRecords = await storage.employerContacts.listByContactId(contact.id);
      const employerIds = Array.from(new Set(employerContactRecords.map(ec => ec.employerId)));

      if (employerIds.length === 0) {
        res.json([]);
        return;
      }

      const employersList = await Promise.all(
        employerIds.map(id => storage.employers.getEmployer(id))
      );
      const activeEmployers = employersList
        .filter((emp): emp is NonNullable<typeof emp> => emp !== null && emp !== undefined && emp.isActive);

      if (activeEmployers.length === 0) {
        res.json([]);
        return;
      }

      const client = getClient();
      const activeIds = activeEmployers.map(e => e.id);

      const latestWizards = await client
        .select({
          employerId: wizardEmployerMonthly.employerId,
          year: wizardEmployerMonthly.year,
          month: wizardEmployerMonthly.month,
          wizardType: wizards.type,
          completedAt: wizards.date,
        })
        .from(wizardEmployerMonthly)
        .innerJoin(wizards, eq(wizardEmployerMonthly.wizardId, wizards.id))
        .where(
          and(
            inArray(wizardEmployerMonthly.employerId, activeIds),
            or(eq(wizards.status, "complete"), eq(wizards.status, "completed"))
          )
        )
        .orderBy(desc(wizards.date));

      const latestByEmployer = new Map<string, typeof latestWizards[0]>();
      for (const row of latestWizards) {
        if (!latestByEmployer.has(row.employerId)) {
          latestByEmployer.set(row.employerId, row);
        }
      }

      const ledgerEnabled = isComponentEnabledSync("ledger");
      let eaRows: Array<{ eaId: string; entityId: string; accountId: string; accountName: string | null }> = [];
      let balanceMap = new Map<string, string>();

      if (ledgerEnabled) {
        eaRows = await client
          .select({
            eaId: ledgerEa.id,
            entityId: ledgerEa.entityId,
            accountId: ledgerEa.accountId,
            accountName: ledgerAccounts.name,
          })
          .from(ledgerEa)
          .innerJoin(ledgerAccounts, eq(ledgerEa.accountId, ledgerAccounts.id))
          .where(
            and(
              eq(ledgerEa.entityType, "employer"),
              inArray(ledgerEa.entityId, activeIds)
            )
          );

        const eaIds = eaRows.map(r => r.eaId);

        if (eaIds.length > 0) {
          const balances = await client
            .select({
              eaId: ledger.eaId,
              total: sum(ledger.amount),
            })
            .from(ledger)
            .where(inArray(ledger.eaId, eaIds))
            .groupBy(ledger.eaId);

          for (const b of balances) {
            balanceMap.set(b.eaId, b.total ?? "0.00");
          }
        }
      }

      const result = activeEmployers.map(emp => {
        const latestWiz = latestByEmployer.get(emp.id);
        const empEaRows = eaRows.filter(r => r.entityId === emp.id);

        return {
          employerId: emp.id,
          employerName: emp.name,
          latestWizard: latestWiz
            ? {
                type: latestWiz.wizardType,
                year: latestWiz.year,
                month: latestWiz.month,
                completedAt: latestWiz.completedAt?.toISOString() ?? null,
              }
            : null,
          accounts: empEaRows.map(ea => ({
            accountId: ea.accountId,
            accountName: ea.accountName ?? "Account",
            balance: balanceMap.get(ea.eaId) ?? "0.00",
          })),
        };
      });

      res.json(result);
    } catch (error) {
      console.error("Error fetching my shops data:", error);
      res.status(500).json({ message: "Failed to fetch shop data" });
    }
  });

}
