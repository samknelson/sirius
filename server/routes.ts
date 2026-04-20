import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { stringify } from "csv-stringify/sync";
import { sql } from "drizzle-orm";
import multer from "multer";
import { storage } from "./storage";
import { insertWorkerSchema, insertWorkerDispatchHfeSchema, type WorkerId, type ContactPostal, type PhoneNumber } from "@shared/schema";
import { z } from "zod";
import { registerUserRoutes } from "./modules/users";
import { registerVariableRoutes } from "./modules/variables";
import { registerContactPostalRoutes } from "./modules/contact-postal";
import { registerPhoneNumberRoutes } from "./modules/phone-numbers";
import { registerCommRoutes } from "./modules/comm";
import { registerEmployerContactRoutes } from "./modules/employer-contacts";
import { registerTrustBenefitsRoutes } from "./modules/trust/benefits";
import { registerTrustProvidersRoutes } from "./modules/trust/providers";
import { registerTrustProviderContactRoutes } from "./modules/trust/provider/contacts";
import { registerConsolidatedOptionsRoutes } from "./modules/options-routes";
import { getOptionsType } from "./modules/options-registry";
import { registerWorkerIdsRoutes } from "./modules/worker-ids";
import { registerAddressValidationRoutes } from "./modules/address-validation";
import {
  registerMasqueradeRoutes,
  getEffectiveUser,
} from "./modules/masquerade";
import { registerDashboardRoutes } from "./modules/dashboard";
import { registerBookmarkRoutes } from "./modules/bookmarks";
import {
  registerComponentRoutes,
  getEnabledComponentIds,
} from "./modules/components";
import { registerEmployerUserSettingsRoutes } from "./modules/employer-user-settings";
import { registerTrustProviderUserSettingsRoutes } from "./modules/trust/provider/user-settings";
import { registerWorkerUserSettingsRoutes } from "./modules/worker-user-settings";
import { registerWorkerUsersRoutes } from "./modules/worker-users";
import { registerWizardRoutes } from "./modules/wizards";
import { registerFileRoutes } from "./modules/files";
import { registerLedgerStripeRoutes } from "./modules/ledger/stripe";
import { registerLedgerAccountRoutes } from "./modules/ledger/accounts";
import { registerLedgerEaRoutes } from "./modules/ledger/ea";
import { registerLedgerPaymentRoutes } from "./modules/ledger/payments";
import { registerLedgerPaymentBatchRoutes } from "./modules/ledger/payment-batches";
import { registerAccessPolicyRoutes } from "./modules/access-policies";
import { registerLogRoutes } from "./modules/logs";
import { registerWorkerWshRoutes } from "./modules/worker-wsh";
import { registerWorkerMshRoutes } from "./modules/worker-msh";
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
import { registerBargainingUnitsRoutes } from "./modules/bargaining-units";
import { registerSftpClientDestinationRoutes } from "./modules/sftp-client-destinations";
import { registerTrustProviderEdiRoutes } from "./modules/trust/provider/edi";
import { registerBulkMessageRoutes } from "./modules/bulk/messages";
import { registerEmployerRoutes } from "./modules/employers";
import { registerEmployerPolicyHistoryRoutes } from "./modules/employer-policy-history";
import { registerWorkerBenefitsScanRoutes } from "./modules/worker-benefits-scan";
import { registerWmbScanQueueRoutes } from "./modules/wmb-scan-queue";
import { registerStaffAlertRoutes } from "./modules/staff-alerts";
import { registerDispatchDncConfigRoutes } from "./modules/dispatch/dnc-config";
import { registerDispatchEbaConfigRoutes } from "./modules/dispatch/eba-config";
import { registerWorkerBanConfigRoutes } from "./modules/worker-ban-config";
import { registerCardcheckDefinitionsRoutes } from "./modules/cardcheck-definitions";
import { registerCardchecksRoutes } from "./modules/cardchecks";
import { registerEsigsRoutes } from "./modules/esigs";
import { registerSessionRoutes } from "./modules/sessions";
import { registerFloodEventRoutes } from "./modules/flood-events";
import { registerEventsRoutes } from "./modules/events";
import { registerDispatchJobsRoutes } from "./modules/dispatch/jobs";
import { registerDispatchJobGroupsRoutes } from "./modules/dispatch/job-groups";
import { registerFacilityRoutes } from "./modules/facility/facilities";
import { registerDispatchesRoutes } from "./modules/dispatch/dispatches";
import { registerWorkerDispatchStatusRoutes } from "./modules/worker-dispatch-status";
import { registerWorkerDispatchDncRoutes } from "./modules/worker-dispatch-dnc";
import { registerWorkerDispatchHfeRoutes } from "./modules/worker-dispatch-hfe";
import { registerWorkerDispatchEbaRoutes } from "./modules/worker-dispatch-eba";
import { registerWorkerBansRoutes } from "./modules/worker-bans";
import { registerWorkerSkillsRoutes } from "./modules/worker-skills";
import { registerWorkerCertificationsRoutes } from "./modules/worker-certifications";
import { registerWorkerRatingsRoutes } from "./modules/worker-ratings";
import { requireComponent } from "./modules/components";
import { registerWorkerStewardAssignmentRoutes } from "./modules/worker-steward-assignments";
import { registerBtuCsgRoutes } from "./modules/sitespecific/btu/csg";
import { registerHtaRoutes } from "./modules/hta";
import { registerBtuTerritoriesRoutes } from "./modules/sitespecific/btu/territories";
import { registerBtuSchoolRoutes } from "./modules/sitespecific/btu/school";
import { registerBtuSigImportRoutes } from "./modules/sitespecific/btu/sig-import";
import { registerBtuScraperImportRoutes } from "./modules/sitespecific/btu/scraper-import";
import { registerBtuBuildingRepImportRoutes } from "./modules/sitespecific/btu/building-rep-import";
import { registerBtuPoliticalRoutes } from "./modules/sitespecific/btu/political";
import { registerT631ClientFetchRoutes } from "./modules/sitespecific/t631/client/fetch";
import { registerFreemanSecondShiftRoutes } from "./modules/sitespecific/freeman/second-shift";
import { registerEdlsSheetsRoutes } from "./modules/edls/sheets";
import { registerEdlsTasksRoutes } from "./modules/edls/tasks";
import { registerWorkerEdlsRoutes } from "./modules/edls/workers";
import { registerWebServiceBundle } from "./modules/webservices";
import { setupEdlsRoutes, EDLS_BUNDLE_CODE } from "./modules/webservices/edls";
import { registerWebServiceAdminRoutes } from "./modules/webservices/admin";
import { registerTerminologyRoutes } from "./modules/terminology";
import { registerCompaniesRoutes } from "./modules/companies";
import { registerPoliciesRoutes } from "./modules/policies";
import { requireAccess } from "./services/access-policy-evaluator";
import { addressValidationService } from "./services/address-validation";
import { phoneValidationService } from "./services/phone-validation";
import { serviceRegistry } from "./services/service-registry";
import { isAuthenticated } from "./auth";

// Authentication middleware
const requireAuth = isAuthenticated;

// Permission middleware
const requirePermission = (permissionKey: string) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    const user = req.user as any;
    if (!user || !user.claims) {
      return res.status(401).json({ message: "Authentication required" });
    }
    
    // Get database user ID from external ID, respecting masquerade
    const session = req.session as any;
    const { getEffectiveUser } = await import("./modules/masquerade");
    const { dbUser } = await getEffectiveUser(session, user);
    if (!dbUser) {
      return res.status(401).json({ message: "User not found" });
    }

    const hasPermission = await storage.users.userHasPermission(
      dbUser.id,
      permissionKey,
    );
    if (!hasPermission) {
      return res.status(403).json({ message: "Insufficient permissions" });
    }

    next();
  };
};

export async function registerRoutes(app: Express, existingServer?: Server): Promise<Server> {
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
      const session = req.session as any;

      // Get effective user (handles masquerading)
      const { dbUser, originalUser } = await getEffectiveUser(session, user);
      
      if (!dbUser) {
        return res.status(404).json({ message: "User not found" });
      }

      const userPermissions = await storage.users.getUserPermissions(dbUser.id);
      const enabledComponents = await getEnabledComponentIds();
      
      // Get user's associated worker if they have one
      let workerId: string | null = null;
      if (dbUser.email) {
        const worker = await storage.workers.getWorkerByContactEmail(dbUser.email);
        if (worker) {
          workerId = worker.id;
        }
      }
      
      res.json({
        user: {
          id: dbUser.id,
          email: dbUser.email,
          firstName: dbUser.firstName,
          lastName: dbUser.lastName,
          profileImageUrl: dbUser.profileImageUrl,
          isActive: dbUser.isActive,
          workerId: workerId
        },
        permissions: userPermissions.map((p) => p.key),
        components: enabledComponents,
        capabilities: {
          workerEdls: await (await import('./modules/edls/capability')).isWorkerEdlsAvailable(),
        },
        masquerade: session.masqueradeUserId
          ? {
              isMasquerading: true,
              originalUser: originalUser
                ? {
                    id: originalUser.id,
                    email: originalUser.email,
                    firstName: originalUser.firstName,
                    lastName: originalUser.lastName,
                  }
                : null,
            }
          : {
              isMasquerading: false,
            },
      });
    } catch (error) {
      console.error("Failed to fetch user info:", error);
      res.status(500).json({ message: "Failed to fetch user info" });
    }
  });

  // Register access policy evaluation routes
  registerAccessPolicyRoutes(app);

  // Register masquerade routes
  registerMasqueradeRoutes(app, requireAuth, requirePermission);

  // Register session management routes
  registerSessionRoutes(app, requireAuth, storage);

  // Register flood events routes
  registerFloodEventRoutes(app, requireAuth, storage);

  // Register user management routes
  registerUserRoutes(app, requireAuth, requirePermission);

  // Register employer user settings routes
  registerEmployerUserSettingsRoutes(app, requireAuth, requirePermission);

  // Register trust provider user settings routes
  registerTrustProviderUserSettingsRoutes(app, requireAuth, requirePermission);
  
  // Register worker user settings routes
  registerWorkerUserSettingsRoutes(app, requireAuth, requirePermission);
  
  // Register worker users routes (create/manage user accounts for workers)
  registerWorkerUsersRoutes(app, requireAuth, requirePermission);
  
  // Register contact postal address management routes
  registerContactPostalRoutes(app, requireAuth, requirePermission, requireAccess);
  
  // Register phone number management routes
  registerPhoneNumberRoutes(app, requireAuth, requirePermission, requireAccess);

  // Register communication routes
  registerCommRoutes(app, requireAuth, requirePermission, requireAccess);

  // Register employer contact routes
  registerEmployerContactRoutes(app, requireAuth, requirePermission);

  // Register trust benefits routes
  registerTrustBenefitsRoutes(app, requireAuth, requirePermission);

  // Register trust providers routes
  registerTrustProvidersRoutes(
    app,
    requireAuth,
    requirePermission,
    requireAccess,
  );

  // Register trust provider contacts routes
  registerTrustProviderContactRoutes(app, requireAuth, requirePermission);
  
  // Register consolidated options routes (/api/options/:type)
  registerConsolidatedOptionsRoutes(app);
  
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

  // Register ledger/payment-batches routes
  registerLedgerPaymentBatchRoutes(app);

  // Register log management routes
  registerLogRoutes(app, requireAuth, requirePermission, requireAccess);
  registerWorkerWshRoutes(app, requireAuth, requirePermission, requireAccess, storage.workerWsh);
  registerWorkerMshRoutes(app, requireAuth, requirePermission, requireAccess, storage.workerMsh);
  registerWorkerHoursRoutes(app, requireAuth, requirePermission, requireAccess, storage.workerHours, storage.ledger);
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
  registerSiteSettingsRoutes(app, requireAuth, requirePermission, requireAccess);

  // Register terminology routes
  registerTerminologyRoutes(app, requireAuth, requirePermission, requireAccess);

  // Register system mode routes
  registerSystemModeRoutes(app, requireAuth, requirePermission, requireAccess);

  // Register bootstrap routes (no auth required - intentionally public for initial setup)
  registerBootstrapRoutes(app);

  // Register policies configuration routes
  registerPoliciesRoutes(app, requireAuth, requireAccess, storage);

  // Register bargaining units configuration routes
  registerBargainingUnitsRoutes(app, requireAuth, requireAccess, storage);

  // Register SFTP client destination routes
  registerSftpClientDestinationRoutes(app, requireAuth, requireAccess, storage);

  // Register trust provider EDI routes
  registerTrustProviderEdiRoutes(app, requireAuth, requireAccess, storage);

  // Register bulk message routes
  registerBulkMessageRoutes(app, requireAuth, requireAccess, storage);

  // Register worker steward assignments routes
  registerWorkerStewardAssignmentRoutes(app, requireAuth, requireAccess, storage);

  // Register employer policy history routes
  registerEmployerPolicyHistoryRoutes(app, requireAuth, requireAccess, storage);

  // Register worker benefits scan routes
  registerWorkerBenefitsScanRoutes(app, requireAuth, requireAccess, storage);

  // Register WMB scan queue routes (admin only)
  registerWmbScanQueueRoutes(app, requireAuth, requireAccess, storage);
  
  // Register staff alert configuration routes
  registerStaffAlertRoutes(app, requireAuth, requireAccess, storage);
  
  // Register dispatch DNC configuration routes
  registerDispatchDncConfigRoutes(app, requireAuth, requireAccess, storage);
  
  // Register dispatch EBA configuration routes
  registerDispatchEbaConfigRoutes(app, requireAuth, requireAccess, storage);
  
  // Register worker ban configuration routes
  registerWorkerBanConfigRoutes(app, requireAuth, requireAccess, storage);
  
  // Register cardcheck definitions routes
  registerCardcheckDefinitionsRoutes(
    app,
    requireAuth,
    requirePermission,
    requireAccess,
  );

  // Register cardchecks routes
  registerCardchecksRoutes(app, requireAuth, requirePermission, requireAccess);

  // Register e-signature routes
  registerEsigsRoutes(app, requireAuth, requirePermission, requireAccess, storage);

  // Worker routes (protected with authentication and permissions)

  // GET /api/workers/with-details - Get all workers with contact and phone data (optimized for list view)
  app.get("/api/workers/with-details", requireAuth, requirePermission("staff"), async (req, res) => {
    try {
      const workers = await storage.workers.getWorkersWithDetails();
      res.json(workers);
    } catch (error) {
      console.error("Failed to fetch workers with details:", error);
      res.status(500).json({ message: "Failed to fetch workers" });
    }
  });

  // Shared parser for the workers-with-details listing filters. Both the paginated
  // listing and the "all matching IDs" endpoint route through this single helper
  // so the two query interpretations cannot drift.
  const parseWorkersWithDetailsFilters = (query: Request['query']) => {
    const search = typeof query.search === 'string' ? query.search : undefined;
    const sortOrderParam = query.sortOrder as string;
    const sortOrder: 'asc' | 'desc' = sortOrderParam === 'desc' ? 'desc' : 'asc';
    const sortByParam = query.sortBy as string;
    const validSortByValues = ['lastName', 'firstName', 'employer'] as const;
    const sortBy = (validSortByValues as readonly string[]).includes(sortByParam)
      ? (sortByParam as 'lastName' | 'firstName' | 'employer')
      : 'lastName';

    const employerId = typeof query.employerId === 'string' && query.employerId !== 'all' ? query.employerId : undefined;
    const employerTypeId = typeof query.employerTypeId === 'string' && query.employerTypeId !== 'all' ? query.employerTypeId : undefined;
    const bargainingUnitId = typeof query.bargainingUnitId === 'string' && query.bargainingUnitId !== 'all' ? query.bargainingUnitId : undefined;
    const benefitId = typeof query.benefitId === 'string' && query.benefitId !== 'all' ? query.benefitId : undefined;
    const contactStatusParam = query.contactStatus as string;
    const validContactStatuses = ['all', 'has_email', 'missing_email', 'has_phone', 'missing_phone', 'has_address', 'missing_address', 'complete', 'incomplete'];
    const contactStatus = validContactStatuses.includes(contactStatusParam) ? (contactStatusParam as any) : 'all';
    const hasMultipleEmployers = query.hasMultipleEmployers === 'true';
    const jobTitle = typeof query.jobTitle === 'string' && query.jobTitle.trim() ? query.jobTitle.trim() : undefined;
    const memberStatusId = typeof query.memberStatusId === 'string' && query.memberStatusId !== 'all' ? query.memberStatusId : undefined;
    const representativeId = typeof query.representativeId === 'string' && query.representativeId !== 'all' ? query.representativeId : undefined;

    return {
      search,
      sortOrder,
      sortBy,
      employerId,
      employerTypeId,
      bargainingUnitId,
      benefitId,
      contactStatus,
      hasMultipleEmployers,
      jobTitle,
      memberStatusId,
      representativeId,
    };
  };

  // GET /api/workers/with-details/paginated - Get paginated workers with contact data
  app.get("/api/workers/with-details/paginated", requireAuth, requirePermission("staff"), async (req, res) => {
    try {
      const rawPage = parseInt(req.query.page as string);
      const rawPageSize = parseInt(req.query.pageSize as string);
      const page = isNaN(rawPage) || rawPage < 1 ? 1 : rawPage;
      const pageSize = isNaN(rawPageSize) || rawPageSize < 1 ? 50 : Math.min(rawPageSize, 100);
      const filters = parseWorkersWithDetailsFilters(req.query);

      const result = await storage.workers.getWorkersWithDetailsPaginated({
        page,
        pageSize,
        ...filters,
      });
      res.json(result);
    } catch (error) {
      console.error("Failed to fetch paginated workers:", error);
      res.status(500).json({ message: "Failed to fetch workers" });
    }
  });

  // GET /api/workers/with-details/all-ids - Return all matching contact IDs for the same filters as the paginated list
  app.get("/api/workers/with-details/all-ids", requireAuth, requirePermission("staff"), async (req, res) => {
    try {
      const filters = parseWorkersWithDetailsFilters(req.query);
      const contactIds = await storage.workers.getAllMatchingContactIds(filters);
      res.json({ contactIds, total: contactIds.length });
    } catch (error) {
      console.error("Failed to fetch matching worker contact IDs:", error);
      res.status(500).json({ message: "Failed to fetch matching workers" });
    }
  });

  // POST /api/workers/latest-dues - Get latest dues payment info for a batch of workers
  app.post("/api/workers/latest-dues", requireAuth, requirePermission("staff"), async (req, res) => {
    try {
      const { workerIds } = req.body;
      if (!Array.isArray(workerIds) || workerIds.length === 0) {
        return res.json({});
      }
      const limitedWorkerIds = workerIds.slice(0, 100);
      const duesMap = await storage.readOnly.query(async (client) => {
        const configResult = await client.execute(sql`
          SELECT settings FROM charge_plugin_configs WHERE plugin_id = 'btu-dues-allocation' AND enabled = true LIMIT 1
        `);
        if (configResult.rows.length === 0) {
          return {};
        }
        const settings = (configResult.rows[0] as any).settings as { accountIds?: string[] } | null;
        const duesAccountId = settings?.accountIds?.[0];
        if (!duesAccountId) {
          return {};
        }
        const workerIdArray = sql`ARRAY[${sql.join(limitedWorkerIds.map(id => sql`${id}`), sql`, `)}]::varchar[]`;
        const result = await client.execute(sql`
          SELECT DISTINCT ON (ea.entity_id)
            ea.entity_id as worker_id,
            l.amount,
            l.date
          FROM ledger_ea ea
          INNER JOIN ledger l ON l.ea_id = ea.id
          WHERE ea.entity_type = 'worker'
            AND ea.account_id = ${duesAccountId}
            AND ea.entity_id = ANY(${workerIdArray})
          ORDER BY ea.entity_id, l.date DESC
        `);
        const map: Record<string, { amount: string; date: string }> = {};
        for (const row of result.rows as any[]) {
          map[row.worker_id] = { amount: row.amount, date: row.date };
        }
        return map;
      });
      res.json(duesMap);
    } catch (error) {
      console.error("Failed to fetch latest dues:", error);
      res.status(500).json({ message: "Failed to fetch latest dues" });
    }
  });

  // GET /api/workers/export - Export workers to CSV with filters
  app.get("/api/workers/export", requireAuth, requirePermission("staff"), async (req, res) => {
    try {
      const search = typeof req.query.search === 'string' ? req.query.search : undefined;
      const sortOrderParam = req.query.sortOrder as string;
      const sortOrder = sortOrderParam === 'desc' ? 'desc' : 'asc';
      
      // Filter parameters
      const employerId = typeof req.query.employerId === 'string' && req.query.employerId !== 'all' ? req.query.employerId : undefined;
      const employerTypeId = typeof req.query.employerTypeId === 'string' && req.query.employerTypeId !== 'all' ? req.query.employerTypeId : undefined;
      const bargainingUnitId = typeof req.query.bargainingUnitId === 'string' && req.query.bargainingUnitId !== 'all' ? req.query.bargainingUnitId : undefined;
      const benefitId = typeof req.query.benefitId === 'string' && req.query.benefitId !== 'all' ? req.query.benefitId : undefined;
      const contactStatusParam = req.query.contactStatus as string;
      const validContactStatuses = ['all', 'has_email', 'missing_email', 'has_phone', 'missing_phone', 'has_address', 'missing_address', 'complete', 'incomplete'];
      const contactStatus = validContactStatuses.includes(contactStatusParam) ? contactStatusParam as any : 'all';
      const jobTitle = typeof req.query.jobTitle === 'string' && req.query.jobTitle.trim() ? req.query.jobTitle.trim() : undefined;
      const memberStatusId = typeof req.query.memberStatusId === 'string' && req.query.memberStatusId !== 'all' ? req.query.memberStatusId : undefined;
      const representativeId = typeof req.query.representativeId === 'string' && req.query.representativeId !== 'all' ? req.query.representativeId : undefined;
      const includeBenefits = req.query.includeBenefits === 'true';
      
      // Get all workers matching filters
      const workers = await storage.workers.getWorkersForExport({
        search,
        sortOrder,
        employerId,
        employerTypeId,
        bargainingUnitId,
        benefitId,
        contactStatus,
        jobTitle,
        memberStatusId,
        representativeId,
      });
      
      // Helper to format SSN
      const formatSSN = (ssn: string | null) => {
        if (!ssn) return '';
        const digits = ssn.replace(/\D/g, '');
        if (digits.length === 9) {
          return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;
        }
        return ssn;
      };

      const workerIdsList = workers.map(w => w.id);

      const [showOnListsTypes, workerIdRecords, allEmployers, memberStatusOptions] = await Promise.all([
        storage.workerIds.getShowOnListsIdTypes(),
        workerIdsList.length > 0 ? storage.workerIds.getWorkerIdsForListByWorkerIds(workerIdsList) : Promise.resolve([]),
        storage.employers.getAllEmployers(),
        (async () => {
          const config = getOptionsType("worker-ms");
          return config ? config.getAll() : [];
        })(),
      ]);

      const employerNameMap = new Map<string, string>();
      for (const emp of allEmployers) {
        employerNameMap.set(emp.id, emp.name);
      }

      const memberStatusNameMap = new Map<string, string>();
      for (const ms of memberStatusOptions) {
        memberStatusNameMap.set(ms.id, ms.name);
      }

      const workerIdMap = new Map<string, Map<string, string>>();
      for (const wid of workerIdRecords) {
        if (!workerIdMap.has(wid.workerId)) {
          workerIdMap.set(wid.workerId, new Map());
        }
        workerIdMap.get(wid.workerId)!.set(wid.typeId, wid.value);
      }

      // Build CSV data
      const csvData = workers.map(worker => {
        const baseData: Record<string, string> = {
          'First Name': worker.given || '',
          'Middle Name': worker.middle || '',
          'Last Name': worker.family || '',
          'SSN': formatSSN(worker.ssn),
        };

        for (const idType of showOnListsTypes) {
          const idValue = workerIdMap.get(worker.id)?.get(idType.id) || '';
          baseData[idType.name] = idValue;
        }

        baseData['Job Title'] = (worker as any).denorm_job_title || '';
        baseData['Bargaining Unit'] = (worker as any).bargaining_unit_name || '';

        const msIds: string[] = (worker as any).denorm_ms_ids || [];
        const msNames = msIds
          .map(id => memberStatusNameMap.get(id))
          .filter((n): n is string => !!n);
        baseData['Member Status'] = msNames.join('; ');

        const employerIds: string[] = (worker as any).denorm_employer_ids || [];
        const empNames = employerIds
          .map(id => employerNameMap.get(id))
          .filter((n): n is string => !!n);
        baseData['Employer(s)'] = empNames.join('; ');

        baseData['Street'] = worker.address_street || '';
        baseData['City'] = worker.address_city || '';
        baseData['State'] = worker.address_state || '';
        baseData['Postal Code'] = worker.address_postal_code || '';
        baseData['Country'] = worker.address_country || '';
        baseData['Email'] = worker.contact_email || '';
        baseData['Phone Number'] = worker.phone_number || '';
        
        if (includeBenefits) {
          const benefits = worker.benefits || [];
          const benefitsString = benefits
            .filter((b: any) => b && b.name)
            .map((b: any) => b.name)
            .join('; ');
          baseData['Current Benefits'] = benefitsString;
        }
        
        return baseData;
      });
      
      // Define columns
      const columns = [
        'First Name',
        'Middle Name',
        'Last Name',
        'SSN',
        ...showOnListsTypes.map(t => t.name),
        'Job Title',
        'Bargaining Unit',
        'Member Status',
        'Employer(s)',
        'Street',
        'City',
        'State',
        'Postal Code',
        'Country',
        'Email',
        'Phone Number',
        ...(includeBenefits ? ['Current Benefits'] : [])
      ];
      
      // Generate CSV
      const csv = stringify(csvData, {
        header: true,
        columns
      });
      
      // Send CSV response
      const filename = `workers_export_${new Date().toISOString().split('T')[0]}.csv`;
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(csv);
    } catch (error) {
      console.error("Failed to export workers:", error);
      res.status(500).json({ message: "Failed to export workers" });
    }
  });

  const contactExportUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
  });

  app.post("/api/workers/contact-export", requireAuth, requirePermission("staff"), contactExportUpload.single("file"), async (req, res) => {
    try {
      const file = (req as any).file;
      const typeId = typeof req.body.typeId === "string" ? req.body.typeId : null;

      if (!file) {
        return res.status(400).json({ message: "No file uploaded" });
      }
      if (!typeId) {
        return res.status(400).json({ message: "Worker ID type is required" });
      }

      const fileContent = file.buffer.toString("utf-8");
      const rawIds = fileContent
        .split(/[\r\n]+/)
        .map((line: string) => line.trim())
        .filter((line: string) => line.length > 0);

      if (rawIds.length === 0) {
        return res.status(400).json({ message: "File contains no IDs" });
      }
      if (rawIds.length > 10000) {
        return res.status(400).json({ message: "File contains more than 10,000 IDs. Please split into smaller batches." });
      }

      const workerIdRecords = await storage.readOnly.query(async (queryClient: any) => {
        const result = await queryClient.execute(sql`
          SELECT wi.value, wi.worker_id
          FROM worker_ids wi
          WHERE wi.type_id = ${typeId}
            AND wi.value = ANY(ARRAY[${sql.join(rawIds.map((id: string) => sql`${id}`), sql`, `)}]::text[])
        `);
        return result.rows as Array<{ value: string; worker_id: string }>;
      });

      const idToWorkerMap = new Map<string, string>();
      for (const rec of workerIdRecords) {
        idToWorkerMap.set(rec.value, rec.worker_id);
      }

      const matchedIds: string[] = [];
      const unmatchedIds: string[] = [];
      const workerIdSet = new Set<string>();

      for (const rawId of rawIds) {
        const workerId = idToWorkerMap.get(rawId);
        if (workerId) {
          matchedIds.push(rawId);
          workerIdSet.add(workerId);
        } else {
          unmatchedIds.push(rawId);
        }
      }

      const workerIds = [...workerIdSet];

      if (workerIds.length === 0) {
        return res.json({
          matched: 0,
          unmatched: unmatchedIds.length,
          unmatchedIds,
          csvData: null,
        });
      }

      const workerData = await storage.readOnly.query(async (queryClient: any) => {
        const result = await queryClient.execute(sql`
          SELECT
            w.id,
            c.given,
            c.family,
            c.email,
            w.denorm_ms_ids,
            w.denorm_employer_ids,
            (SELECT cp2.phone_number FROM contact_phone cp2 WHERE cp2.contact_id = c.id AND cp2.is_active = true ORDER BY cp2.is_primary DESC NULLS LAST LIMIT 1) as phone_number,
            (SELECT cpo.street FROM contact_postal cpo WHERE cpo.contact_id = c.id AND cpo.is_active = true ORDER BY cpo.is_primary DESC NULLS LAST LIMIT 1) as address_street,
            (SELECT cpo.city FROM contact_postal cpo WHERE cpo.contact_id = c.id AND cpo.is_active = true ORDER BY cpo.is_primary DESC NULLS LAST LIMIT 1) as address_city,
            (SELECT cpo.state FROM contact_postal cpo WHERE cpo.contact_id = c.id AND cpo.is_active = true ORDER BY cpo.is_primary DESC NULLS LAST LIMIT 1) as address_state,
            (SELECT cpo.postal_code FROM contact_postal cpo WHERE cpo.contact_id = c.id AND cpo.is_active = true ORDER BY cpo.is_primary DESC NULLS LAST LIMIT 1) as address_postal_code
          FROM workers w
          INNER JOIN contacts c ON w.contact_id = c.id
          WHERE w.id = ANY(ARRAY[${sql.join(workerIds.map((id: string) => sql`${id}`), sql`, `)}]::varchar[])
        `);
        return result.rows as Array<{
          id: string;
          given: string | null;
          family: string | null;
          email: string | null;
          denorm_ms_ids: string[] | null;
          denorm_employer_ids: string[] | null;
          phone_number: string | null;
          address_street: string | null;
          address_city: string | null;
          address_state: string | null;
          address_postal_code: string | null;
        }>;
      });

      const workerMap = new Map<string, (typeof workerData)[0]>();
      for (const w of workerData) {
        workerMap.set(w.id, w);
      }

      const allEmployerIds = new Set<string>();
      const allMsIds = new Set<string>();
      for (const w of workerData) {
        (w.denorm_employer_ids || []).forEach(id => allEmployerIds.add(id));
        (w.denorm_ms_ids || []).forEach(id => allMsIds.add(id));
      }

      const [allEmployers, memberStatusOptions] = await Promise.all([
        storage.employers.getAllEmployers(),
        (async () => {
          const config = getOptionsType("worker-ms");
          return config ? config.getAll() : [];
        })(),
      ]);

      const employerNameMap = new Map<string, string>();
      for (const emp of allEmployers) {
        employerNameMap.set(emp.id, emp.name);
      }
      const memberStatusNameMap = new Map<string, string>();
      for (const ms of memberStatusOptions) {
        memberStatusNameMap.set(ms.id, ms.name);
      }

      const workerIdTypeRecords = await storage.workerIds.getWorkerIdsForListByWorkerIds(workerIds);
      const workerIdValueMap = new Map<string, string>();
      for (const wid of workerIdTypeRecords) {
        if (wid.typeId === typeId) {
          workerIdValueMap.set(wid.workerId, wid.value);
        }
      }

      const csvRows = [];
      for (const rawId of rawIds) {
        const workerId = idToWorkerMap.get(rawId);
        if (!workerId) continue;
        const w = workerMap.get(workerId);
        if (!w) continue;

        const msNames = (w.denorm_ms_ids || [])
          .map(id => memberStatusNameMap.get(id))
          .filter((n): n is string => !!n);

        const empNames = (w.denorm_employer_ids || [])
          .map(id => employerNameMap.get(id))
          .filter((n): n is string => !!n);

        csvRows.push({
          'ID': rawId,
          'First Name': w.given || '',
          'Last Name': w.family || '',
          'Email': w.email || '',
          'Phone': w.phone_number || '',
          'Street': w.address_street || '',
          'City': w.address_city || '',
          'State': w.address_state || '',
          'Postal Code': w.address_postal_code || '',
          'Member Status': msNames.join('; '),
          'Employer(s)': empNames.join('; '),
        });
      }

      const columns = [
        'ID', 'First Name', 'Last Name', 'Email', 'Phone',
        'Street', 'City', 'State', 'Postal Code',
        'Member Status', 'Employer(s)',
      ];

      const csv = stringify(csvRows, { header: true, columns });

      res.json({
        matched: matchedIds.length,
        unmatched: unmatchedIds.length,
        unmatchedIds,
        csv,
      });
    } catch (error) {
      console.error("Failed to export contacts:", error);
      res.status(500).json({ message: "Failed to export contacts" });
    }
  });

  // GET /api/workers - Get all workers (requires staff permission)
  app.get("/api/workers", requireAuth, requirePermission("staff"), async (req, res) => {
    try {
      const workers = await storage.workers.getAllWorkers();
      res.json(workers);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch workers" });
    }
  });

  // GET /api/workers/search - Search workers by name or ID (requires workers.view permission)
  app.get("/api/workers/search", requireAuth, requirePermission("staff"), async (req, res) => {
    try {
      const { q, limit: limitParam } = req.query;
      const query = typeof q === 'string' ? q.trim() : '';
      const limit = Math.min(parseInt(limitParam as string) || 10, 50);
      
      if (!query || query.length < 2) {
        res.json({ workers: [], total: 0 });
        return;
      }
      
      const result = await storage.workers.searchWorkers(query, limit);
      res.json(result);
    } catch (error) {
      console.error("Failed to search workers:", error);
      res.status(500).json({ message: "Failed to search workers" });
    }
  });

  // GET /api/workers/employers/summary - Get employer summary for all workers (requires staff permission)
  app.get("/api/workers/employers/summary", requireAuth, requirePermission("staff"), async (req, res) => {
    try {
      const workerEmployers = await storage.workers.getWorkersEmployersSummary();
      res.json(workerEmployers);
    } catch (error) {
      console.error("Failed to fetch worker employers:", error);
      res.status(500).json({ message: "Failed to fetch worker employers" });
    }
  });

  // GET /api/workers/benefits/current - Get current month benefits for all workers (requires staff permission)
  app.get("/api/workers/benefits/current", requireAuth, requirePermission("staff"), async (req, res) => {
    try {
      const workerBenefits = await storage.workers.getWorkersCurrentBenefits();
      res.json(workerBenefits);
    } catch (error) {
      console.error("Failed to fetch worker current benefits:", error);
      res.status(500).json({ message: "Failed to fetch worker current benefits" });
    }
  });

  // GET /api/workers/:id - Get a specific worker (requires worker.view policy: staff or worker with matching email)
  app.get("/api/workers/:id", requireAccess('worker.view', req => req.params.id), async (req, res) => {
    try {
      const { id } = req.params;
      const worker = await storage.workers.getWorker(id);

      if (!worker) {
        res.status(404).json({ message: "Worker not found" });
        return;
      }

      // Fetch contact to get name fields
      const contact = await storage.contacts.getContact(worker.contactId);
      
      res.json({
        ...worker,
        firstName: contact?.given || null,
        lastName: contact?.family || null,
        displayName: contact?.displayName || null,
      });
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch worker" });
    }
  });

  // POST /api/workers - Create a new worker (requires staff permission)
  app.post("/api/workers", requireAuth, requirePermission("staff"), async (req, res) => {
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

  // PUT /api/workers/:id - Update a worker's contact name, email, birth date, SSN, or gender
  // Email updates require staff permission; other fields allow worker self-service via worker.edit
  app.put("/api/workers/:id", requireAuth, async (req, res, next) => {
    const { email } = req.body;
    
    // Email updates are staff-only (emails shouldn't be self-service editable)
    if (email !== undefined) {
      return requirePermission("staff")(req, res, next);
    }
    
    // Other fields use worker.edit policy (allows staff or workers editing their own record)
    return requireAccess('worker.edit', (req: any) => req.params.id)(req, res, next);
  }, async (req, res) => {
    try {
      const { id } = req.params;
      const { name, nameComponents, email, birthDate, ssn, gender, genderNota } = req.body;
      
      // Handle email updates (staff only)
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
            res.status(409).json({
              message: "This SSN is already assigned to another worker",
            });
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
      } else if (name && typeof name === "string" && name.trim()) {
        // Old format: simple name string (for backwards compatibility)
        const worker = await storage.workers.updateWorkerContactName(id, name.trim());

        if (!worker) {
          res.status(404).json({ message: "Worker not found" });
          return;
        }

        res.json(worker);
      } else {
        return res.status(400).json({
          message: "Worker name, name components, email, birth date, or SSN are required",
        });
      }
    } catch (error) {
      res.status(500).json({ message: "Failed to update worker" });
    }
  });

  // PATCH /api/workers/:id - Partially update a worker (requires staff permission)
  app.patch("/api/workers/:id", requireAuth, requirePermission("staff"), async (req, res) => {
    try {
      const { id } = req.params;
      const { bargainingUnitId } = req.body;
      
      // Handle bargaining unit updates
      if (bargainingUnitId !== undefined) {
        // Validate bargainingUnitId - must be null/empty or a valid existing bargaining unit
        const normalizedId = bargainingUnitId && typeof bargainingUnitId === 'string' && bargainingUnitId.trim() 
          ? bargainingUnitId.trim() 
          : null;
        
        // If setting a bargaining unit, verify it exists
        if (normalizedId) {
          const bargainingUnit = await storage.bargainingUnits.getBargainingUnitById(normalizedId);
          if (!bargainingUnit) {
            res.status(400).json({ message: "Invalid bargaining unit ID" });
            return;
          }
        }

        const worker = await storage.workers.updateWorkerBargainingUnit(id, normalizedId);

        if (!worker) {
          res.status(404).json({ message: "Worker not found" });
          return;
        }

        res.json(worker);
        return;
      }

      res.status(400).json({ message: "No valid update fields provided" });
    } catch (error) {
      res.status(500).json({ message: "Failed to update worker" });
    }
  });

  // DELETE /api/workers/:id - Delete a worker (requires staff permission)
  app.delete("/api/workers/:id", requireAuth, requirePermission("staff"), async (req, res) => {
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
  
  // GET /api/my-employers - Get employers associated with current user's contact
  // Returns employers where the user's contact is linked as an employer contact
  // No permission required beyond auth - users only see their own associated employers
  app.get("/api/my-employers", requireAuth, async (req, res) => {
    try {
      // Use getEffectiveUser to support masquerade
      const user = (req as any).user;
      const session = req.session as any;
      const { dbUser } = await getEffectiveUser(session, user);
      
      if (!dbUser?.email) {
        res.json([]);
        return;
      }
      
      // Find the contact matching the effective user's email
      const contact = await storage.contacts?.getContactByEmail?.(dbUser.email);
      if (!contact) {
        res.json([]);
        return;
      }
      
      // Find all employer contacts for this contact
      const employerContactRecords = await storage.employerContacts.listByContactId(contact.id);
      
      // Get unique employer IDs
      const employerIds = Array.from(new Set(employerContactRecords.map(ec => ec.employerId)));
      
      // Fetch employer details
      const employers = await Promise.all(
        employerIds.map(id => storage.employers.getEmployer(id))
      );
      
      // Filter out nulls and inactive employers, return minimal data
      const activeEmployers = employers
        .filter((emp): emp is NonNullable<typeof emp> => emp !== null && emp !== undefined && emp.isActive)
        .map(emp => ({ id: emp.id, name: emp.name }));
      
      res.json(activeEmployers);
    } catch (error) {
      console.error("Failed to fetch user employers:", error);
      res.status(500).json({ message: "Failed to fetch user employers" });
    }
  });

  // GET /api/employers/lookup - Get employer names for dropdowns (all authenticated users)
  // Returns minimal data (id + name) for use in dropdowns throughout the app
  app.get("/api/employers/lookup", requireAuth, async (req, res) => {
    try {
      const allEmployers = await storage.employers.getAllEmployers();
      // Return only active employers with minimal fields (id + name)
      const lookup = allEmployers
        .filter(emp => emp.isActive)
        .map(emp => ({ id: emp.id, name: emp.name }));
      res.json(lookup);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch employer lookup" });
    }
  });

  // GET /api/employers - Get all employers (requires staff permission)
  app.get("/api/employers", requireAuth, requireAccess('staff'), async (req, res) => {
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

  // GET /api/employers/:id - Get a specific employer (requires employer.steward.view policy)
  app.get("/api/employers/:id", requireAuth, requireAccess('employer.steward.view', (req) => req.params.id), async (req, res) => {
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

  // GET /api/employers/:employerId/workers - Get workers for an employer (requires employer.steward.view policy)
  app.get("/api/employers/:employerId/workers", requireAuth, requireAccess('employer.steward.view', (req) => req.params.employerId), async (req, res) => {
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

  // POST /api/employers - Create a new employer (requires staff permission)
  app.post("/api/employers", requireAuth, requirePermission("staff"), async (req, res) => {
    try {
      const { name, isActive = true, typeId } = req.body;
      
      if (!name || typeof name !== 'string' || !name.trim()) {
        return res.status(400).json({ message: "Employer name is required" });
      }

      const employer = await storage.employers.createEmployer({
        name: name.trim(),
        isActive: typeof isActive === "boolean" ? isActive : true,
        typeId: typeId || null,
      });

      res.status(201).json(employer);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to create employer" });
    }
  });

  // PUT /api/employers/:id - Update an employer (requires staff permission)
  app.put("/api/employers/:id", requireAuth, requirePermission("staff"), async (req, res) => {
    try {
      const { id } = req.params;
      const { name, isActive, typeId, industryId } = req.body;
      
      const updates: Partial<InsertEmployer> = {};
      
      if (name !== undefined) {
        if (!name || typeof name !== 'string' || !name.trim()) {
          return res.status(400).json({ message: "Employer name cannot be empty" });
        }
        updates.name = name.trim();
      }

      if (isActive !== undefined) {
        if (typeof isActive !== "boolean") {
          return res.status(400).json({ message: "isActive must be a boolean" });
        }
        updates.isActive = isActive;
      }

      if (typeId !== undefined) {
        updates.typeId = typeId;
      }
      
      if (industryId !== undefined) {
        updates.industryId = industryId === null || industryId === "" ? null : industryId;
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

  // DELETE /api/employers/:id - Delete an employer (requires staff permission)
  app.delete("/api/employers/:id", requireAuth, requirePermission("staff"), async (req, res) => {
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
  // Register employer routes
  registerEmployerRoutes(app, requireAuth, requirePermission, requireAccess);

  // GET /api/contacts/by-email/:email - Get a contact by email (requires staff permission)
  app.get("/api/contacts/by-email/:email", requireAuth, requirePermission("staff"), async (req, res) => {
    try {
      const { email } = req.params;
      const contact = await storage.contacts.getContactByEmail(email);
      
      if (!contact) {
        res.status(404).json({ message: "Contact not found" });
        return;
      }
      
      res.json(contact);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch contact" });
    }
  });

  // GET /api/contacts/:id - Get a contact by ID (requires worker.view policy - staff or worker viewing own contact)
  app.get("/api/contacts/:id", requireAuth, requireAccess('worker.view', async (req) => {
    // Resolve the owning worker ID from the contact
    const contact = await storage.contacts.getContact(req.params.id);
    if (!contact) return undefined;
    const worker = await storage.workers.getWorkerByContactId(contact.id);
    return worker?.id;
  }), async (req, res) => {
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
  app.get(
    "/api/variables/address_validation_config",
    requireAuth,
    async (req, res) => {
      try {
        const config = await addressValidationService.getConfig();
        res.json(config);
      } catch (error) {
        res.status(500).json({
          message: "Failed to fetch address validation configuration",
        });
      }
    },
  );

  // PUT /api/variables/address_validation_config - Update address validation configuration
  app.put("/api/variables/address_validation_config", requireAuth, requireAccess('admin'), async (req, res) => {
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
      res.status(500).json({
        message: "Failed to update address validation configuration",
      });
    }
  });

  // GET /api/variables/phone_validation_config - Get phone validation configuration
  // Now derived from SMS provider selection, with stored settings for each provider
  app.get(
    "/api/variables/phone_validation_config",
    requireAuth,
    async (req, res) => {
      try {
        const smsConfig = await serviceRegistry.getCategoryConfig("sms");
        const isTwilioMode = smsConfig.defaultProvider === "twilio";

        // Get stored validation settings from both providers
        const localSettings = await serviceRegistry.getProviderSettings(
          "sms",
          "local",
        );
        const twilioSettings = await serviceRegistry.getProviderSettings(
          "sms",
          "twilio",
        );
        const localValidation = (localSettings as any)?.phoneValidation || {};
        const twilioValidation = (twilioSettings as any)?.phoneValidation || {};

        // Return config in the legacy format for backward compatibility
        // Fallback settings are stored with twilio provider since they control Twilio failure behavior
        res.json({
          mode: isTwilioMode ? "twilio" : "local",
          local: {
            enabled: !isTwilioMode,
            defaultCountry: localValidation.defaultCountry || "US",
            strictValidation: localValidation.strictValidation ?? true,
          },
          twilio: {
            enabled: isTwilioMode,
            lookupType: twilioValidation.lookupType || [
              "line_type_intelligence",
              "caller_name",
            ],
          },
          fallback: {
            useLocalOnTwilioFailure:
              twilioValidation.useLocalOnTwilioFailure ?? true,
            logValidationAttempts:
              twilioValidation.logValidationAttempts ?? true,
          },
        });
      } catch (error) {
        res
          .status(500)
          .json({ message: "Failed to fetch phone validation configuration" });
      }
    },
  );

  // PUT /api/variables/phone_validation_config - Update phone validation configuration
  // Now updates the SMS provider selection and stores validation settings for each provider
  app.put("/api/variables/phone_validation_config", requireAuth, requireAccess('admin'), async (req, res) => {
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
        await serviceRegistry.saveProviderSettings("sms", "local", {
          ...localCurrentSettings,
          phoneValidation: localValidationSettings,
        });
      }

      // Store twilio-specific settings and fallback settings in the twilio provider
      // Fallback settings belong with twilio since they control Twilio failure behavior
      const twilioCurrentSettings = await serviceRegistry.getProviderSettings("sms", "twilio");
      const existingTwilioValidation = (twilioCurrentSettings as any)?.phoneValidation || {};
      const twilioValidationSettings = {
        ...existingTwilioValidation,
        lookupType: twilio?.lookupType ?? existingTwilioValidation.lookupType ?? [
          "line_type_intelligence",
          "caller_name",
        ],
        useLocalOnTwilioFailure: fallback?.useLocalOnTwilioFailure ?? existingTwilioValidation.useLocalOnTwilioFailure ?? true,
        logValidationAttempts: fallback?.logValidationAttempts ?? existingTwilioValidation.logValidationAttempts ?? true,
      };
      await serviceRegistry.saveProviderSettings("sms", "twilio", {
        ...twilioCurrentSettings,
        phoneValidation: twilioValidationSettings,
      });

      // Update the SMS provider selection
      await serviceRegistry.setDefaultProvider("sms", mode);

      // Fetch updated config from both providers for response
      const localSettings = await serviceRegistry.getProviderSettings("sms", "local");
      const twilioSettings = await serviceRegistry.getProviderSettings("sms", "twilio");
      const localValidation = (localSettings as any)?.phoneValidation || {};
      const twilioValidation = (twilioSettings as any)?.phoneValidation || {};

      const smsConfig = await serviceRegistry.getCategoryConfig("sms");
      const isTwilioMode = smsConfig.defaultProvider === "twilio";

      // Return config in the legacy format
      res.json({
        mode: isTwilioMode ? "twilio" : "local",
        local: {
          enabled: !isTwilioMode,
          defaultCountry: localValidation.defaultCountry || "US",
          strictValidation: localValidation.strictValidation ?? true,
        },
        twilio: {
          enabled: isTwilioMode,
          lookupType: twilioValidation.lookupType || [
            "line_type_intelligence",
            "caller_name",
          ],
        },
        fallback: {
          useLocalOnTwilioFailure: twilioValidation.useLocalOnTwilioFailure ?? true,
          logValidationAttempts: twilioValidation.logValidationAttempts ?? true,
        },
      });
    } catch (error) {
      console.error("Error updating phone validation config:", error);
      res.status(500).json({
        message: "Failed to update phone validation configuration",
        error: error instanceof Error ? error.message : String(error),
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
        error: "Failed to geocode address",
      });
    }
  });

  // Worker Benefits (WMB) routes

  // GET /api/workers/:workerId/benefits - Get all benefits for a worker (requires worker.view policy: staff or worker with matching email)
  app.get("/api/workers/:workerId/benefits", requireAccess('worker.view', req => req.params.workerId), async (req, res) => {
    try {
      const { workerId } = req.params;
      const benefits = await storage.workers.getWorkerBenefits(workerId);
      res.json(benefits);
    } catch (error) {
      console.error("Failed to fetch worker benefits:", error);
      res.status(500).json({ message: "Failed to fetch worker benefits" });
    }
  });

  // POST /api/workers/:workerId/benefits - Create a new benefit entry for a worker (requires staff permission)
  app.post("/api/workers/:workerId/benefits", requireAuth, requirePermission("staff"), async (req, res) => {
    try {
      const { workerId } = req.params;
      const { month, year, employerId, benefitId } = req.body;

      if (!month || !year || !employerId || !benefitId) {
        return res.status(400).json({
          message: "Month, year, employer ID, and benefit ID are required",
        });
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
        return res.status(409).json({
          message: "This benefit entry already exists for this worker, employer, and month/year",
        });
      }
      res.status(500).json({ message: "Failed to create worker benefit" });
    }
  });

  // DELETE /api/worker-benefits/:id - Delete a worker benefit entry (requires staff permission)
  app.delete("/api/worker-benefits/:id", requireAuth, requirePermission("staff"), async (req, res) => {
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

  // Register events routes
  registerEventsRoutes(app, requireAuth, requirePermission);

  // Register dispatch jobs routes
  registerDispatchJobsRoutes(app, requireAuth, requirePermission);

  // Register dispatch job groups routes
  registerDispatchJobGroupsRoutes(app, requireAuth, requirePermission);
  registerFacilityRoutes(app, requireAuth, requirePermission);

  // Register dispatches routes
  registerDispatchesRoutes(app, requireAuth, requirePermission);

  // Register worker dispatch status routes (handles all access control internally)
  registerWorkerDispatchStatusRoutes(app, requireAuth, requireAccess);

  // Register worker dispatch DNC routes (handles all access control internally)
  registerWorkerDispatchDncRoutes(app, requireAuth, requireAccess);

  // Register worker dispatch HFE routes (handles all access control internally)
  registerWorkerDispatchHfeRoutes(app, requireAuth, requireAccess);

  // Register worker dispatch EBA routes (handles all access control internally)
  registerWorkerDispatchEbaRoutes(app, requireAuth, requireAccess);

  // Register worker bans routes (handles all access control internally)
  registerWorkerBansRoutes(app, requireAuth, requireAccess);

  // Register worker skills routes (handles all access control internally)
  registerWorkerSkillsRoutes(app, requireAuth, requireAccess);

  // Register worker certifications routes (handles all access control internally)
  registerWorkerCertificationsRoutes(app, requireAuth, requireAccess, requirePermission);

  // Register worker ratings routes (handles all access control internally)
  registerWorkerRatingsRoutes(app, requireAuth, requireAccess, requirePermission);

  // Register site-specific routes
  registerBtuCsgRoutes(app, requireAuth, requirePermission);
  registerBtuTerritoriesRoutes(app, requireAuth, requirePermission);
  registerBtuSchoolRoutes(app, requireAuth, requirePermission);
  registerBtuSigImportRoutes(app, requireAuth, requirePermission);
  registerBtuScraperImportRoutes(app, requireAuth, requirePermission);
  registerBtuBuildingRepImportRoutes(app, requireAuth, requirePermission);

  // Register BTU Political Profile routes
  registerBtuPoliticalRoutes(app, requireAuth, requirePermission);

  // Register T631 Client routes
  registerT631ClientFetchRoutes(app, requireAuth, requirePermission);

  // Register Freeman Second Shift routes
  registerFreemanSecondShiftRoutes(app, requireAuth, requireAccess);

  // Register HTA routes
  registerHtaRoutes(app, requireAuth, requirePermission);

  // Register EDLS routes
  registerEdlsSheetsRoutes(app, requireAuth, requirePermission);
  registerEdlsTasksRoutes(app, requireAuth, requirePermission);
  registerWorkerEdlsRoutes(app, requireAuth);

  // Register Web Service bundles (API access via client credentials)
  registerWebServiceBundle(app, {
    bundleCode: EDLS_BUNDLE_CODE,
    setupRoutes: setupEdlsRoutes,
  });

  // Register Web Service admin routes (for managing bundles, clients, credentials)
  registerWebServiceAdminRoutes(app, requireAuth, requirePermission);

  // Register companies routes
  registerCompaniesRoutes(app, requireAuth);

  const httpServer = existingServer || createServer(app);
  return httpServer;
}
