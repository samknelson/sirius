import type { Express } from "express";
import { storage } from "../storage";
import { insertCardcheckSchema } from "@shared/schema";
import { requireComponent } from "./components";
import { db } from "../db";
import { sql, SQL } from "drizzle-orm";

export function registerCardchecksRoutes(
  app: Express,
  requireAuth: any,
  requirePermission: any,
  requireAccess: any
) {
  const cardcheckComponent = requireComponent("cardcheck");

  // GET /api/workers/:workerId/cardchecks - Get cardchecks for a worker (worker.view policy)
  app.get("/api/workers/:workerId/cardchecks", requireAuth, cardcheckComponent, requireAccess('worker.view', (req: any) => req.params.workerId), async (req, res) => {
    try {
      const { workerId } = req.params;
      const cardchecks = await storage.cardchecks.getCardchecksByWorkerId(workerId);
      res.json(cardchecks);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch cardchecks" });
    }
  });

  // GET /api/cardcheck/:id - Get specific cardcheck (cardcheck.view policy)
  app.get("/api/cardcheck/:id", requireAuth, cardcheckComponent, requireAccess('cardcheck.view', (req: any) => req.params.id), async (req, res) => {
    try {
      const { id } = req.params;
      const cardcheck = await storage.cardchecks.getCardcheckById(id);
      
      if (!cardcheck) {
        res.status(404).json({ message: "Cardcheck not found" });
        return;
      }
      
      res.json(cardcheck);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch cardcheck" });
    }
  });

  app.post("/api/workers/:workerId/cardchecks", requireAuth, cardcheckComponent, requireAccess('worker.edit', (req: any) => req.params.workerId), async (req, res) => {
    try {
      const { workerId } = req.params;
      
      // Get the worker to copy bargainingUnitId
      const worker = await storage.workers.getWorker(workerId);
      if (!worker) {
        return res.status(404).json({ message: "Worker not found" });
      }
      
      // Copy bargainingUnitId from worker when creating cardcheck
      const data = { 
        ...req.body, 
        workerId,
        bargainingUnitId: worker.bargainingUnitId || null
      };
      const parsed = insertCardcheckSchema.safeParse(data);
      
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid cardcheck data", errors: parsed.error.errors });
      }
      
      const cardcheck = await storage.cardchecks.createCardcheck(parsed.data);
      res.status(201).json(cardcheck);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to create cardcheck" });
    }
  });

  app.patch("/api/cardcheck/:id", requireAuth, cardcheckComponent, requireAccess('cardcheck.edit', (req: any) => req.params.id), async (req, res) => {
    try {
      const { id } = req.params;
      
      const existing = await storage.cardchecks.getCardcheckById(id);
      if (!existing) {
        res.status(404).json({ message: "Cardcheck not found" });
        return;
      }
      
      if (existing.status === "revoked") {
        return res.status(400).json({ message: "Cannot modify a revoked cardcheck. Revoked cardchecks are permanently locked." });
      }
      
      if (req.body.status === "revoked") {
        const user = req.user as any;
        const session = req.session as any;
        const { getEffectiveUser } = await import("./masquerade");
        const { dbUser } = await getEffectiveUser(session, user);
        if (dbUser) {
          const isStaff = await storage.users.userHasPermission(dbUser.id, "staff");
          if (!isStaff) {
            const def = await storage.cardcheckDefinitions.getCardcheckDefinitionById(existing.cardcheckDefinitionId);
            const revokeRoles: string[] = (def?.data as any)?.revokeRoles || ["staff"];
            if (!revokeRoles.includes("worker")) {
              return res.status(403).json({ message: "You do not have permission to revoke this card check." });
            }
            const contact = dbUser.email ? await storage.contacts.getContactByEmail(dbUser.email) : null;
            const workerRecord = contact ? await storage.workers.getWorkerByContactId(contact.id) : null;
            if (!workerRecord || workerRecord.id !== existing.workerId) {
              return res.status(403).json({ message: "You can only revoke your own card check." });
            }
          }
        }
      }

      const body = { ...req.body };
      if (body.signedDate && typeof body.signedDate === "string") {
        body.signedDate = new Date(body.signedDate);
      }
      
      const parsed = insertCardcheckSchema.partial().safeParse(body);
      
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid cardcheck data", errors: parsed.error.errors });
      }
      
      const updatedCardcheck = await storage.cardchecks.updateCardcheck(id, parsed.data);
      
      if (!updatedCardcheck) {
        res.status(404).json({ message: "Cardcheck not found" });
        return;
      }
      
      res.json(updatedCardcheck);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to update cardcheck" });
    }
  });

  app.delete("/api/cardcheck/:id", requireAuth, cardcheckComponent, requirePermission("staff"), async (req, res) => {
    try {
      const { id } = req.params;
      
      const deleted = await storage.cardchecks.deleteCardcheck(id);
      
      if (!deleted) {
        res.status(404).json({ message: "Cardcheck not found" });
        return;
      }
      
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete cardcheck" });
    }
  });

  app.get("/api/cardchecks/status-summary", requireAuth, cardcheckComponent, requirePermission("staff"), async (req, res) => {
    try {
      const summary = await storage.cardchecks.getCardcheckStatusSummary();
      res.json(summary);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch cardcheck status summary" });
    }
  });

  // POST /api/cardcheck/:id/sign - Sign a cardcheck (cardcheck.edit policy)
  app.post("/api/cardcheck/:id/sign", requireAuth, cardcheckComponent, requireAccess('cardcheck.edit', (req: any) => req.params.id), async (req, res) => {
    try {
      const { id: cardcheckId } = req.params;
      const user = req.user as any;
      
      // Look up user via resolveDbUser helper
      const { resolveDbUser } = await import("../auth/helpers");
      const dbUser = await resolveDbUser(user, user?.claims?.sub);
      if (!dbUser) {
        return res.status(401).json({ message: "User not found" });
      }

      const existingCardcheck = await storage.cardchecks.getCardcheckById(cardcheckId);
      if (!existingCardcheck) {
        return res.status(404).json({ message: "Cardcheck not found" });
      }

      if (existingCardcheck.status === "signed") {
        return res.status(400).json({ message: "Cardcheck is already signed" });
      }

      if (existingCardcheck.status === "revoked") {
        return res.status(400).json({ message: "Cannot sign a revoked cardcheck" });
      }

      const { docRender, esigData, signatureType, docType = "cardcheck", rate } = req.body;

      if (!docRender || !esigData) {
        return res.status(400).json({ message: "Missing required signing data" });
      }

      // Extract fileId from esigData if signing with uploaded document
      const fileId = signatureType === "upload" && esigData?.value ? esigData.value : undefined;

      const result = await storage.cardchecks.signCardcheck({
        cardcheckId,
        userId: dbUser.id,
        docRender,
        docType,
        esigData,
        signatureType,
        fileId,
        rate: rate !== undefined ? Number(rate) : undefined,
      });

      res.json(result);
    } catch (error: any) {
      console.error("Failed to sign cardcheck:", error);
      res.status(500).json({ message: "Failed to sign cardcheck" });
    }
  });

  // GET /api/reports/cardchecks - Get cardcheck report with filters
  app.get("/api/reports/cardchecks", requireAuth, cardcheckComponent, requirePermission("staff"), async (req, res) => {
    try {
      const { signedDateFrom, signedDateTo, hasPreviousCardcheck, status, bargainingUnitId, definitionId } = req.query;
      
      const filters: any = {};
      
      if (signedDateFrom && typeof signedDateFrom === 'string') {
        filters.signedDateFrom = signedDateFrom;
      }
      
      if (signedDateTo && typeof signedDateTo === 'string') {
        filters.signedDateTo = signedDateTo;
      }
      
      if (hasPreviousCardcheck !== undefined && hasPreviousCardcheck !== '') {
        filters.hasPreviousCardcheck = hasPreviousCardcheck === 'true';
      }
      
      if (status && typeof status === 'string' && ['pending', 'signed', 'revoked'].includes(status)) {
        filters.status = status as 'pending' | 'signed' | 'revoked';
      }
      
      if (bargainingUnitId && typeof bargainingUnitId === 'string') {
        filters.bargainingUnitId = bargainingUnitId;
      }
      
      if (definitionId && typeof definitionId === 'string') {
        filters.definitionId = definitionId;
      }
      
      const report = await storage.cardchecks.getCardcheckReport(filters);
      res.json(report);
    } catch (error: any) {
      console.error("Failed to fetch cardcheck report:", error);
      res.status(500).json({ message: "Failed to fetch cardcheck report" });
    }
  });

  // ==================== Organizing Configuration ====================
  const ORGANIZING_STATUS_GROUPS_VAR = "organizing_status_groups";
  const ORGANIZING_NEW_MEMBER_DAYS_VAR = "organizing_new_member_days";
  const DEFAULT_NEW_MEMBER_DAYS = 30;

  interface StatusGroup {
    id: string;
    name: string;
    statusIds: string[];
    isPrimary: boolean;
  }

  function sqlInList(ids: string[]): SQL {
    return sql.join(ids.map(id => sql`${id}`), sql`, `);
  }

  async function getOrganizingStatusGroups(): Promise<StatusGroup[]> {
    const variable = await storage.variables.getByName(ORGANIZING_STATUS_GROUPS_VAR);
    if (variable && Array.isArray(variable.value)) {
      return variable.value as StatusGroup[];
    }
    return [];
  }

  async function getNewMemberDays(): Promise<number> {
    const variable = await storage.variables.getByName(ORGANIZING_NEW_MEMBER_DAYS_VAR);
    if (variable && typeof variable.value === 'number' && variable.value > 0) {
      return variable.value;
    }
    return DEFAULT_NEW_MEMBER_DAYS;
  }

  app.get("/api/organizing/status-groups", requireAuth, cardcheckComponent, requirePermission("staff"), async (req, res) => {
    try {
      const groups = await getOrganizingStatusGroups();
      res.json(groups);
    } catch (error) {
      console.error("Failed to fetch organizing status groups:", error);
      res.status(500).json({ message: "Failed to fetch organizing status groups" });
    }
  });

  app.put("/api/organizing/status-groups", requireAuth, cardcheckComponent, requireAccess('admin'), async (req, res) => {
    try {
      const groups = req.body.groups as StatusGroup[];
      if (!Array.isArray(groups)) {
        return res.status(400).json({ message: "Groups must be an array" });
      }
      const primaryCount = groups.filter(g => g.isPrimary).length;
      if (primaryCount > 1) {
        return res.status(400).json({ message: "Only one group can be marked as primary" });
      }
      for (const group of groups) {
        if (!group.id || !group.name || !Array.isArray(group.statusIds)) {
          return res.status(400).json({ message: "Each group must have id, name, and statusIds" });
        }
      }

      const existing = await storage.variables.getByName(ORGANIZING_STATUS_GROUPS_VAR);
      if (existing) {
        await storage.variables.update(existing.id, {
          name: ORGANIZING_STATUS_GROUPS_VAR,
          value: groups
        });
      } else {
        await storage.variables.create({
          name: ORGANIZING_STATUS_GROUPS_VAR,
          value: groups
        });
      }
      res.json(groups);
    } catch (error) {
      console.error("Failed to update organizing status groups:", error);
      res.status(500).json({ message: "Failed to update organizing status groups" });
    }
  });

  // GET/PUT /api/organizing/new-member-days - Configure new member window
  app.get("/api/organizing/new-member-days", requireAuth, cardcheckComponent, requirePermission("staff"), async (req, res) => {
    try {
      const days = await getNewMemberDays();
      res.json({ days });
    } catch (error) {
      console.error("Failed to fetch new member days:", error);
      res.status(500).json({ message: "Failed to fetch new member days" });
    }
  });

  app.put("/api/organizing/new-member-days", requireAuth, cardcheckComponent, requireAccess('admin'), async (req, res) => {
    try {
      const { days } = req.body;
      if (typeof days !== 'number' || days < 1 || days > 365) {
        return res.status(400).json({ message: "Days must be a number between 1 and 365" });
      }

      const existing = await storage.variables.getByName(ORGANIZING_NEW_MEMBER_DAYS_VAR);
      if (existing) {
        await storage.variables.update(existing.id, {
          name: ORGANIZING_NEW_MEMBER_DAYS_VAR,
          value: days
        });
      } else {
        await storage.variables.create({
          name: ORGANIZING_NEW_MEMBER_DAYS_VAR,
          value: days
        });
      }
      res.json({ days });
    } catch (error) {
      console.error("Failed to update new member days:", error);
      res.status(500).json({ message: "Failed to update new member days" });
    }
  });

  // GET /api/employers/organizing - Get organizing employer list with card check stats
  app.get("/api/employers/organizing", requireAuth, cardcheckComponent, requirePermission("staff"), async (req, res) => {
    try {
      const statusGroups = await getOrganizingStatusGroups();
      const primaryGroup = statusGroups.find(g => g.isPrimary);
      const secondaryGroups = statusGroups.filter(g => !g.isPrimary && g.statusIds.length > 0);
      const primaryStatusIds = primaryGroup?.statusIds || [];
      const hasPrimaryFilter = primaryStatusIds.length > 0;

      // Get all active employers with their type info, school types, and region
      const employersResult = await db.execute(sql`
        SELECT 
          e.id,
          e.name,
          e.type_id as "typeId",
          et.name as "typeName",
          et.data->>'icon' as "typeIcon",
          sa.school_type_ids as "schoolTypeIds",
          sa.region_id as "regionId",
          r.name as "regionName",
          sa.grade_start as "gradeStart",
          sa.grade_end as "gradeEnd"
        FROM employers e
        LEFT JOIN options_employer_type et ON e.type_id = et.id
        LEFT JOIN sitespecific_btu_school_attributes sa ON sa.employer_id = e.id
        LEFT JOIN sitespecific_btu_regions r ON r.id = sa.region_id
        WHERE e.is_active = true
        ORDER BY e.name
      `);

      const employers = employersResult.rows as any[];

      // Get all school types for mapping IDs to names/icons
      let schoolTypesMap = new Map<string, { id: string; name: string; icon: string | null }>();
      try {
        const schoolTypesResult = await db.execute(sql`
          SELECT id, name, data->>'icon' as icon
          FROM sitespecific_btu_school_types
        `);
        for (const st of schoolTypesResult.rows as any[]) {
          schoolTypesMap.set(st.id, { id: st.id, name: st.name, icon: st.icon || null });
        }
      } catch {
        // Table may not exist in non-BTU installations
      }

      // Get all employment statuses for reference
      const allStatusesResult = await db.execute(sql`
        SELECT id, name, code, employed FROM options_employment_status ORDER BY sequence
      `);
      const allStatuses = allStatusesResult.rows as any[];

      // Build WHERE filter for primary group status IDs
      // If primary group has status IDs, only count those; otherwise fall back to employed=true
      const statsResult = await db.execute(sql`
        WITH latest_employment AS (
          SELECT DISTINCT ON (wh.worker_id, wh.employer_id)
            wh.worker_id,
            wh.employer_id,
            wh.employment_status_id,
            es.name as status_name,
            es.employed as is_employed
          FROM worker_hours wh
          LEFT JOIN options_employment_status es ON wh.employment_status_id = es.id
          ORDER BY wh.worker_id, wh.employer_id, wh.year DESC, wh.month DESC, wh.day DESC
        ),
        active_workers AS (
          SELECT 
            le.worker_id,
            le.employer_id,
            w.bargaining_unit_id
          FROM latest_employment le
          INNER JOIN workers w ON w.id = le.worker_id
          WHERE ${hasPrimaryFilter
            ? sql`le.employment_status_id IN (${sqlInList(primaryStatusIds)})`
            : sql`le.is_employed = true`}
        ),
        worker_cardchecks AS (
          SELECT 
            aw.employer_id,
            aw.bargaining_unit_id,
            COUNT(DISTINCT aw.worker_id) as total_workers,
            COUNT(DISTINCT CASE WHEN cc.status = 'signed' THEN aw.worker_id END) as signed_workers
          FROM active_workers aw
          LEFT JOIN cardchecks cc ON cc.worker_id = aw.worker_id AND cc.status = 'signed'
          GROUP BY aw.employer_id, aw.bargaining_unit_id
        )
        SELECT 
          wc.employer_id as "employerId",
          wc.bargaining_unit_id as "bargainingUnitId",
          bu.name as "bargainingUnitName",
          wc.total_workers as "totalWorkers",
          wc.signed_workers as "signedWorkers"
        FROM worker_cardchecks wc
        LEFT JOIN bargaining_units bu ON bu.id = wc.bargaining_unit_id
      `);

      const stats = statsResult.rows as any[];

      // Get workers for each secondary status group (e.g., On Leave)
      const secondaryGroupsData: any[] = [];
      for (const group of secondaryGroups) {
        if (group.statusIds.length === 0) continue;
        const groupWorkersResult = await db.execute(sql`
          WITH latest_employment AS (
            SELECT DISTINCT ON (wh.worker_id, wh.employer_id)
              wh.worker_id,
              wh.employer_id,
              wh.employment_status_id,
              es.name as status_name,
              make_date(wh.year, wh.month, wh.day) as status_date
            FROM worker_hours wh
            LEFT JOIN options_employment_status es ON wh.employment_status_id = es.id
            ORDER BY wh.worker_id, wh.employer_id, wh.year DESC, wh.month DESC, wh.day DESC
          )
          SELECT 
            le.worker_id as "workerId",
            le.employer_id as "employerId",
            e.name as "employerName",
            c.display_name as "displayName",
            le.status_name as "statusName",
            le.status_date as "statusDate"
          FROM latest_employment le
          INNER JOIN workers w ON w.id = le.worker_id
          INNER JOIN contacts c ON c.id = w.contact_id
          INNER JOIN employers e ON e.id = le.employer_id
          WHERE le.employment_status_id IN (${sqlInList(group.statusIds)})
            AND e.is_active = true
          ORDER BY e.name, c.display_name
        `);
        secondaryGroupsData.push({
          id: group.id,
          name: group.name,
          workers: groupWorkersResult.rows.map((row: any) => ({
            workerId: row.workerId,
            employerId: row.employerId,
            employerName: row.employerName,
            displayName: row.displayName,
            statusName: row.statusName,
            statusDate: row.statusDate,
          }))
        });
      }

      // Get stewards for each employer (table may not exist in all installations)
      let stewards: any[] = [];
      try {
        const stewardsResult = await db.execute(sql`
          SELECT 
            wsa.employer_id as "employerId",
            wsa.worker_id as "workerId",
            wsa.bargaining_unit_id as "bargainingUnitId",
            c.display_name as "displayName",
            c.email,
            bu.name as "bargainingUnitName",
            (
              SELECT cp.phone_number 
              FROM contact_phone cp 
              WHERE cp.contact_id = c.id AND cp.is_active = true
              ORDER BY cp.is_primary DESC NULLS LAST
              LIMIT 1
            ) as "phone"
          FROM worker_steward_assignments wsa
          INNER JOIN workers w ON w.id = wsa.worker_id
          INNER JOIN contacts c ON c.id = w.contact_id
          LEFT JOIN bargaining_units bu ON bu.id = wsa.bargaining_unit_id
          ORDER BY c.display_name
        `);
        stewards = stewardsResult.rows as any[];
      } catch (stewardError: any) {
        console.log("Steward assignments table not available, skipping steward data");
      }

      // Get principal contacts for each employer
      const principalsResult = await db.execute(sql`
        SELECT 
          ec.employer_id as "employerId",
          c.id as "contactId",
          c.display_name as "displayName",
          c.email,
          (
            SELECT cp.phone_number 
            FROM contact_phone cp 
            WHERE cp.contact_id = c.id AND cp.is_active = true
            ORDER BY cp.is_primary DESC NULLS LAST
            LIMIT 1
          ) as "phone"
        FROM employer_contacts ec
        INNER JOIN contacts c ON c.id = ec.contact_id
        INNER JOIN options_employer_contact_type ect ON ec.contact_type_id = ect.id
        WHERE ect.name = 'Principal'
        ORDER BY c.display_name
      `);
      const principals = principalsResult.rows as any[];

      // Build response with aggregated data
      const employerMap = new Map<string, any>();

      for (const emp of employers) {
        const schoolTypeIds = emp.schoolTypeIds || [];
        const schoolTypes = schoolTypeIds
          .map((id: string) => schoolTypesMap.get(id))
          .filter((st: any) => st !== undefined);

        employerMap.set(emp.id, {
          id: emp.id,
          name: emp.name,
          typeId: emp.typeId,
          typeName: emp.typeName,
          typeIcon: emp.typeIcon || null,
          schoolTypeIds: schoolTypeIds,
          schoolTypes: schoolTypes,
          regionId: emp.regionId || null,
          regionName: emp.regionName || null,
          gradeStart: emp.gradeStart || null,
          gradeEnd: emp.gradeEnd || null,
          totalWorkers: 0,
          signedWorkers: 0,
          bargainingUnits: [],
          stewards: [],
          principals: []
        });
      }

      // Build a map of lowest dues rate per bargaining unit from their data.accountRates
      const allBargainingUnits = await storage.bargainingUnits.getAllBargainingUnits();
      const buMinRateMap = new Map<string, number>();
      for (const bu of allBargainingUnits) {
        const buData = bu.data as { accountRates?: Record<string, unknown> } | null;
        if (!buData?.accountRates) continue;
        let minRate: number | null = null;
        for (const value of Object.values(buData.accountRates)) {
          if (typeof value === 'number' && value > 0) {
            if (minRate === null || value < minRate) minRate = value;
          } else if (Array.isArray(value)) {
            for (const entry of value) {
              const r = typeof entry === 'object' && entry !== null && 'rate' in entry
                ? (entry as { rate: number }).rate : null;
              if (typeof r === 'number' && r > 0 && (minRate === null || r < minRate)) minRate = r;
            }
          }
        }
        if (minRate !== null) {
          buMinRateMap.set(bu.id, minRate);
        }
      }

      // Aggregate stats by employer
      for (const stat of stats) {
        const emp = employerMap.get(stat.employerId);
        if (emp) {
          emp.totalWorkers += Number(stat.totalWorkers) || 0;
          emp.signedWorkers += Number(stat.signedWorkers) || 0;
          if (stat.bargainingUnitId) {
            emp.bargainingUnits.push({
              id: stat.bargainingUnitId,
              name: stat.bargainingUnitName || 'Unknown',
              totalWorkers: Number(stat.totalWorkers) || 0,
              signedWorkers: Number(stat.signedWorkers) || 0,
              duesRate: buMinRateMap.get(stat.bargainingUnitId) || null
            });
          }
        }
      }

      // Add stewards to employers
      for (const steward of stewards) {
        const emp = employerMap.get(steward.employerId);
        if (emp) {
          emp.stewards.push({
            workerId: steward.workerId,
            displayName: steward.displayName,
            bargainingUnitId: steward.bargainingUnitId,
            bargainingUnitName: steward.bargainingUnitName,
            email: steward.email || null,
            phone: steward.phone || null
          });
        }
      }

      // Add principals to employers
      for (const principal of principals) {
        const emp = employerMap.get(principal.employerId);
        if (emp) {
          emp.principals.push({
            contactId: principal.contactId,
            displayName: principal.displayName,
            email: principal.email || null,
            phone: principal.phone || null
          });
        }
      }

      // Compute distinct worker totals per BU (using same filter as primary group)
      const distinctResult = await db.execute(sql`
        WITH latest_employment AS (
          SELECT DISTINCT ON (wh.worker_id, wh.employer_id)
            wh.worker_id,
            wh.employer_id,
            wh.employment_status_id,
            es.employed as is_employed
          FROM worker_hours wh
          LEFT JOIN options_employment_status es ON wh.employment_status_id = es.id
          ORDER BY wh.worker_id, wh.employer_id, wh.year DESC, wh.month DESC, wh.day DESC
        ),
        active_workers AS (
          SELECT DISTINCT le.worker_id
          FROM latest_employment le
          WHERE ${hasPrimaryFilter
            ? sql`le.employment_status_id IN (${sqlInList(primaryStatusIds)})`
            : sql`le.is_employed = true`}
        )
        SELECT 
          w.bargaining_unit_id as "bargainingUnitId",
          COUNT(DISTINCT aw.worker_id) as "totalDistinctWorkers",
          COUNT(DISTINCT CASE WHEN cc.status = 'signed' THEN aw.worker_id END) as "signedDistinctWorkers"
        FROM active_workers aw
        INNER JOIN workers w ON w.id = aw.worker_id
        LEFT JOIN cardchecks cc ON cc.worker_id = aw.worker_id AND cc.status = 'signed'
        GROUP BY w.bargaining_unit_id
      `);
      const distinctRows = distinctResult.rows as any[];
      let grandTotalWorkers = 0;
      let grandSignedWorkers = 0;
      let distinctMissingDuesRevenue = 0;
      for (const row of distinctRows) {
        const total = Number(row.totalDistinctWorkers) || 0;
        const signed = Number(row.signedDistinctWorkers) || 0;
        grandTotalWorkers += total;
        grandSignedWorkers += signed;
        const missing = total - signed;
        if (missing > 0 && row.bargainingUnitId) {
          const rate = buMinRateMap.get(row.bargainingUnitId);
          if (rate && rate > 0) {
            distinctMissingDuesRevenue += missing * rate;
          }
        }
      }

      const result = Array.from(employerMap.values())
        .sort((a, b) => a.name.localeCompare(b.name));

      // Query new members: workers whose earliest signed card check is within the last X days
      const newMemberDays = await getNewMemberDays();
      const newMembersResult = await db.execute(sql`
        WITH first_signed AS (
          SELECT 
            cc.worker_id,
            MIN(cc.signed_date) as first_signed_date,
            (ARRAY_AGG(cc.bargaining_unit_id ORDER BY cc.signed_date ASC))[1] as bargaining_unit_id
          FROM cardchecks cc
          WHERE cc.status = 'signed'
          GROUP BY cc.worker_id
          HAVING MIN(cc.signed_date) >= CURRENT_DATE - ${newMemberDays}::integer
        )
        SELECT 
          fs.worker_id as "workerId",
          c.display_name as "displayName",
          fs.first_signed_date as "signedDate",
          bu.name as "bargainingUnitName",
          bu.id as "bargainingUnitId",
          COALESCE(
            (
              SELECT e.name 
              FROM worker_hours wh
              INNER JOIN employers e ON e.id = wh.employer_id
              WHERE wh.worker_id = fs.worker_id
              ORDER BY wh.year DESC, wh.month DESC, wh.day DESC
              LIMIT 1
            ),
            'Unknown'
          ) as "employerName",
          COALESCE(
            (
              SELECT wh.employer_id
              FROM worker_hours wh
              WHERE wh.worker_id = fs.worker_id
              ORDER BY wh.year DESC, wh.month DESC, wh.day DESC
              LIMIT 1
            ),
            NULL
          ) as "employerId"
        FROM first_signed fs
        INNER JOIN workers w ON w.id = fs.worker_id
        INNER JOIN contacts c ON c.id = w.contact_id
        LEFT JOIN bargaining_units bu ON bu.id = fs.bargaining_unit_id
        ORDER BY fs.first_signed_date DESC, c.display_name
      `);

      const newMembers = newMembersResult.rows.map((row: any) => ({
        workerId: row.workerId,
        displayName: row.displayName,
        signedDate: row.signedDate,
        bargainingUnitName: row.bargainingUnitName || 'Unknown',
        bargainingUnitId: row.bargainingUnitId,
        employerName: row.employerName,
        employerId: row.employerId,
      }));

      res.json({
        employers: result,
        distinctTotalWorkers: grandTotalWorkers,
        distinctSignedWorkers: grandSignedWorkers,
        distinctMissingDuesRevenue,
        secondaryGroups: secondaryGroupsData,
        statusGroups: statusGroups,
        newMembers,
        newMemberDays,
      });
    } catch (error: any) {
      console.error("Failed to fetch organizing employer list:", error);
      res.status(500).json({ message: "Failed to fetch organizing employer list" });
    }
  });

  // GET /api/employers/:employerId/missing-cardchecks - Get workers at employer without signed cardchecks
  app.get("/api/employers/:employerId/missing-cardchecks", requireAuth, cardcheckComponent, requirePermission("staff"), async (req, res) => {
    try {
      const { employerId } = req.params;

      const statusGroups = await getOrganizingStatusGroups();
      const primaryGroup = statusGroups.find(g => g.isPrimary);
      const primaryStatusIds = primaryGroup?.statusIds || [];
      const hasPrimaryFilter = primaryStatusIds.length > 0;

      // Get employer info
      const employerResult = await db.execute(sql`
        SELECT id, name FROM employers WHERE id = ${employerId}
      `);

      if (employerResult.rows.length === 0) {
        return res.status(404).json({ message: "Employer not found" });
      }

      const employer = employerResult.rows[0] as any;

      const workersResult = await db.execute(sql`
        WITH latest_employment AS (
          SELECT DISTINCT ON (wh.worker_id)
            wh.worker_id,
            wh.employment_status_id,
            es.name as status_name,
            es.employed as is_employed,
            make_date(wh.year, wh.month, wh.day) as status_date
          FROM worker_hours wh
          LEFT JOIN options_employment_status es ON wh.employment_status_id = es.id
          WHERE wh.employer_id = ${employerId}
          ORDER BY wh.worker_id, wh.year DESC, wh.month DESC, wh.day DESC
        ),
        active_workers AS (
          SELECT le.worker_id, le.status_date as current_active_date, le.status_name
          FROM latest_employment le
          WHERE ${hasPrimaryFilter
            ? sql`le.employment_status_id IN (${sqlInList(primaryStatusIds)})`
            : sql`le.is_employed = true`}
        ),
        -- Get the latest signed cardcheck for each worker (if any)
        latest_signed_cardcheck AS (
          SELECT DISTINCT ON (cc.worker_id)
            cc.worker_id,
            cc.bargaining_unit_id,
            cc.signed_date
          FROM cardchecks cc
          WHERE cc.status = 'signed'
          ORDER BY cc.worker_id, cc.signed_date DESC NULLS LAST
        ),
        -- Use window functions to identify termination periods
        -- For each status record, use LEAD() to find when they returned to active
        -- A termination period requiring new cardcheck is when:
        -- 1. Status is 'Terminated'
        -- 2. Next status is 'Active' or 'Active - Secondary'
        -- 3. Gap between termination date and next active date >= 30 days
        status_with_next AS (
          SELECT 
            wh.worker_id,
            es.name as status_name,
            es.employed as is_employed,
            make_date(wh.year, wh.month, wh.day) as status_date,
            LEAD(es.employed) OVER (PARTITION BY wh.worker_id ORDER BY wh.year, wh.month, wh.day) as next_employed,
            LEAD(make_date(wh.year, wh.month, wh.day)) OVER (PARTITION BY wh.worker_id ORDER BY wh.year, wh.month, wh.day) as next_date
          FROM worker_hours wh
          LEFT JOIN options_employment_status es ON wh.employment_status_id = es.id
          WHERE wh.employer_id = ${employerId}
        ),
        -- Find termination periods where worker was not employed for 30+ days before returning to employed
        -- Only consider the period immediately preceding the current employed period
        termination_requiring_new_cardcheck AS (
          SELECT DISTINCT ON (aw.worker_id)
            aw.worker_id,
            swn.status_date as termination_date,
            swn.next_date as return_active_date
          FROM active_workers aw
          INNER JOIN status_with_next swn ON swn.worker_id = aw.worker_id
          WHERE swn.is_employed = false
            AND swn.next_employed = true
            AND swn.next_date = aw.current_active_date
            AND (swn.next_date - swn.status_date) >= 30
          ORDER BY aw.worker_id, swn.status_date DESC
        ),
        -- Determine invalid reason for each active worker (prioritized, one per worker)
        worker_invalid_reasons AS (
          SELECT DISTINCT ON (aw.worker_id)
            aw.worker_id,
            CASE
              -- Priority 1: No signed cardcheck at all
              WHEN lsc.worker_id IS NULL THEN 'Missing'
              -- Priority 2: Termination expired (had 30+ day gap, cardcheck signed before termination)
              WHEN trn.worker_id IS NOT NULL 
                   AND (lsc.signed_date IS NULL OR lsc.signed_date < trn.termination_date) 
              THEN 'Termination Expired'
              -- Priority 3: BU Mismatch
              WHEN w.bargaining_unit_id IS NOT NULL 
                   AND lsc.bargaining_unit_id IS NOT NULL
                   AND w.bargaining_unit_id != lsc.bargaining_unit_id 
              THEN 'BU Mismatch'
              ELSE NULL
            END as invalid_reason
          FROM active_workers aw
          INNER JOIN workers w ON w.id = aw.worker_id
          LEFT JOIN latest_signed_cardcheck lsc ON lsc.worker_id = aw.worker_id
          LEFT JOIN termination_requiring_new_cardcheck trn ON trn.worker_id = aw.worker_id
          ORDER BY aw.worker_id
        )
        SELECT 
          w.id as "workerId",
          c.display_name as "displayName",
          c.email,
          bu.id as "bargainingUnitId",
          bu.name as "bargainingUnitName",
          wir.invalid_reason as "invalidReason",
          aw.status_name as "employmentStatus",
          (
            SELECT cp.phone_number 
            FROM contact_phone cp 
            WHERE cp.contact_id = c.id AND cp.is_active = true
            ORDER BY cp.is_primary DESC NULLS LAST
            LIMIT 1
          ) as phone
        FROM worker_invalid_reasons wir
        INNER JOIN workers w ON w.id = wir.worker_id
        INNER JOIN contacts c ON c.id = w.contact_id
        INNER JOIN active_workers aw ON aw.worker_id = w.id
        LEFT JOIN bargaining_units bu ON bu.id = w.bargaining_unit_id
        WHERE wir.invalid_reason IS NOT NULL
        ORDER BY 
          CASE wir.invalid_reason 
            WHEN 'Missing' THEN 1 
            WHEN 'Termination Expired' THEN 2
            WHEN 'BU Mismatch' THEN 3 
          END,
          c.display_name
      `);

      const workers = workersResult.rows.map((row: any) => ({
        workerId: row.workerId,
        displayName: row.displayName,
        email: row.email || null,
        phone: row.phone || null,
        bargainingUnitId: row.bargainingUnitId,
        bargainingUnitName: row.bargainingUnitName || 'Unknown',
        invalidReason: row.invalidReason || null,
        employmentStatus: row.employmentStatus || null
      }));

      res.json({
        employer: {
          id: employer.id,
          name: employer.name
        },
        workers,
        totalCount: workers.length
      });
    } catch (error: any) {
      console.error("Failed to fetch missing cardchecks:", error);
      res.status(500).json({ message: "Failed to fetch workers missing cardchecks" });
    }
  });
}
