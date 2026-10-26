import type { Express, Request, Response } from "express";
import { storage } from "../storage";
import { requireAccess } from "../services/access-policy-evaluator";
import { requireComponent } from "./components";
import { createBulkParticipantStorage } from "../storage/bulk/participants";
import { insertBulkMessageSchema } from "@shared/schema/bulk/schema";
import { complianceScopeSchema } from "@shared/employer-compliance";
import { loadComplianceReport, validateComplianceReferences, complianceLetterValues } from "../services/employer-compliance";
import { runInTransaction } from "../storage/transaction-context";
import { enqueueBulkRecipients } from "./bulk/enqueue-recipients";
import { applyEnqueueTemplates, resolveEnqueueTemplates, BulkEnqueueError } from "../services/bulk-enqueue-templates";
import { extendComplianceSnapshot } from "../services/compliance-enqueue-snapshot";

type RequireAuth = (req: Request, res: Response, next: () => void) => void;

export function registerEmployerComplianceRoutes(
  app: Express,
  requireAuth: RequireAuth,
) {
  app.get(
    "/api/employer-compliance/dashboard",
    requireAuth,
    requireComponent("ledger"),
    requireAccess("staff"),
    async (req, res) => {
      try {
        const { wizardType, year, month, monthsBack, companyId } = req.query;
        const ledgerAccountIdsParam = req.query.ledgerAccountIds;

        const yearNum = Number(year);
        const monthNum = Number(month);
        const monthsBackNum = Number(monthsBack ?? 6);

        if (
          !wizardType ||
          typeof wizardType !== "string" ||
          !Number.isInteger(yearNum) ||
          yearNum < 1900 ||
          yearNum > 2100 ||
          !Number.isInteger(monthNum) ||
          monthNum < 1 ||
          monthNum > 12
        ) {
          return res
            .status(400)
            .json({ message: "wizardType, year, month are required and must be valid" });
        }

        if (!Number.isInteger(monthsBackNum)) {
          return res.status(400).json({ message: "monthsBack must be an integer" });
        }

        let ledgerAccountIds: string[] = [];
        if (Array.isArray(ledgerAccountIdsParam)) {
          ledgerAccountIds = ledgerAccountIdsParam.filter(
            (v): v is string => typeof v === "string" && v.length > 0,
          );
        } else if (typeof ledgerAccountIdsParam === "string" && ledgerAccountIdsParam.length > 0) {
          ledgerAccountIds = ledgerAccountIdsParam
            .split(",")
            .map((s) => s.trim())
            .filter((s) => s.length > 0);
        }

        const parsedScope = complianceScopeSchema.safeParse({
          wizardType, year: yearNum, month: monthNum,
          monthsBack: Math.max(1, Math.min(24, monthsBackNum)), ledgerAccountIds,
        });
        if (!parsedScope.success) return res.status(400).json({ message: "Invalid compliance report settings" });
        const report = await loadComplianceReport(storage, parsedScope.data, {
          companyId: typeof companyId === "string" ? companyId : null,
        });
        res.json({ ...report, scope: parsedScope.data });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to load compliance dashboard";
        res.status(500).json({ message });
      }
    },
  );

  app.post(
    "/api/employer-compliance/resolve-contacts",
    requireAuth,
    requireComponent("ledger"),
    requireAccess("staff"),
    async (req, res) => {
      try {
        const { employerIds, contactTypeIds } = req.body ?? {};

        if (!Array.isArray(employerIds) || employerIds.length === 0) {
          return res.status(400).json({ message: "employerIds is required" });
        }
        const employerIdList = employerIds.filter(
          (v): v is string => typeof v === "string" && v.length > 0,
        );
        if (employerIdList.length === 0) {
          return res.status(400).json({ message: "employerIds is required" });
        }

        const typeIdList: string[] = Array.isArray(contactTypeIds)
          ? contactTypeIds.filter((v): v is string => typeof v === "string" && v.length > 0)
          : [];

        const rows = await storage.employerContacts.getByEmployerIds(
          employerIdList,
          typeIdList.length > 0 ? typeIdList : undefined,
        );

        const seen = new Set<string>();
        const dedupedContactIds: string[] = [];
        for (const r of rows) {
          if (!seen.has(r.contactId)) {
            seen.add(r.contactId);
            dedupedContactIds.push(r.contactId);
          }
        }

        const employersWithoutContacts: string[] = [];
        const employersCovered = new Set(rows.map((r) => r.employerId));
        for (const eid of employerIdList) {
          if (!employersCovered.has(eid)) employersWithoutContacts.push(eid);
        }

        res.json({
          contactIds: dedupedContactIds,
          contacts: rows,
          employersWithoutContacts,
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to resolve contacts";
        res.status(500).json({ message });
      }
    },
  );

  app.post(
    "/api/employer-compliance/queue-bulk",
    requireAuth,
    requireComponent("ledger"),
    requireAccess("staff"),
    requireAccess("bulk.edit"),
    requireComponent("bulk"),
    async (req, res) => {
      try {
        const { name, medium, employerIds, contactTypeIds, reportScope, bulkMessageId, templateIds } = req.body ?? {};
        if (bulkMessageId !== undefined && (typeof bulkMessageId !== "string" || !bulkMessageId.trim())) {
          return res.status(400).json({ message: "bulkMessageId must be a non-empty string" });
        }

        const parsedScope = complianceScopeSchema.safeParse(reportScope);
        if (!parsedScope.success) {
          return res.status(400).json({ message: "Valid compliance report settings are required" });
        }
        await validateComplianceReferences(storage, parsedScope.data);
        const runAt = new Date().toISOString();
        const report = await loadComplianceReport(storage, parsedScope.data);

        const parsed = insertBulkMessageSchema.safeParse({
          name,
          medium,
          status: "draft",
        });
        if (bulkMessageId === undefined && !parsed.success) {
          return res
            .status(400)
            .json({ message: "Validation failed", errors: parsed.error.issues });
        }

        if (!Array.isArray(employerIds) || employerIds.length === 0) {
          return res.status(400).json({ message: "employerIds is required" });
        }
        const employerIdList = employerIds.filter(
          (v): v is string => typeof v === "string" && v.length > 0,
        );
        if (employerIdList.length === 0) {
          return res.status(400).json({ message: "employerIds is required" });
        }
        const selectedRows = report.rows.filter(row => employerIdList.includes(row.employerId));
        if (new Set(selectedRows.map(row => row.employerId)).size !== new Set(employerIdList).size) {
          return res.status(400).json({ message: "A selected employer is no longer available in the report" });
        }

        const typeIdList: string[] = Array.isArray(contactTypeIds)
          ? contactTypeIds.filter((v): v is string => typeof v === "string" && v.length > 0)
          : [];

        const rows = await storage.employerContacts.getByEmployerIds(
          employerIdList,
          typeIdList.length > 0 ? typeIdList : undefined,
        );

        const seen = new Set<string>();
        const contactIds: string[] = [];
        const employersCovered = new Set<string>();
        const employerByContact: Record<string, string> = {};
        for (const r of rows) {
          if (employerByContact[r.contactId] && employerByContact[r.contactId] !== r.employerId) {
            return res.status(400).json({
              message: "A selected contact represents multiple employers. Queue those employers separately so each letter has an unambiguous report.",
            });
          }
          employerByContact[r.contactId] = r.employerId;
          employersCovered.add(r.employerId);
          if (!seen.has(r.contactId)) {
            seen.add(r.contactId);
            contactIds.push(r.contactId);
          }
        }
        const employersWithoutContacts = employerIdList.filter(
          (id) => !employersCovered.has(id),
        );

        const { wizardPluginRegistry } = await import("../plugins/wizards/registry");
        const accounts = await Promise.all(parsedScope.data.ledgerAccountIds.map(id => storage.ledger.accounts.get(id)));
        const snapshot = {
              scope: parsedScope.data,
              runAt,
              wizardName: wizardPluginRegistry.get(parsedScope.data.wizardType)!.name,
              accountName: accounts.map(account => account!.name).join(", "),
              employerByContact,
              valuesByEmployer: Object.fromEntries(report.rows.map(row => [
                row.employerId, complianceLetterValues(row.employerName, row.months, report.monthPeriods),
              ])),
        };
        const { bulk, participantsCreated, participantsSkipped } = await runInTransaction(async () => {
          const existing = bulkMessageId ? await storage.bulkMessages.getByIdForUpdate(bulkMessageId) : undefined;
          if (bulkMessageId && !existing) throw new BulkEnqueueError("Bulk message not found", 404);
          if (existing && (existing.status !== "draft" || await storage.bulkParticipants.hasNonPendingForMessage(existing.id))) {
            throw new BulkEnqueueError("Choose a draft whose delivery has not started", 409);
          }
          const data = (existing?.data ?? {}) as Record<string, unknown>;
          const complianceReport = extendComplianceSnapshot(data.complianceReport, snapshot, employerIdList);
          if (existing) {
            const recipients = await storage.bulkParticipants.getByMessageId(existing.id);
            if (recipients.some(recipient => !complianceReport.employerByContact[recipient.contactId])) {
              throw new BulkEnqueueError("This message has recipients without employer report context. Choose another draft or create a new one.", 409);
            }
          }
          const templates = await resolveEnqueueTemplates(storage, templateIds, existing?.medium ?? (parsed.success ? parsed.data.medium : []));
          const bulk = existing
            ? await storage.bulkMessages.update(existing.id, { data: { ...data, complianceReport } })
            : await storage.bulkMessages.create({
                ...insertBulkMessageSchema.parse({ name, medium, status: "draft" }),
                data: { complianceReport },
              });
          if (!bulk) throw new BulkEnqueueError("Bulk message no longer exists", 404);
          await applyEnqueueTemplates(storage, bulk, templates);
          const counts = await enqueueBulkRecipients(createBulkParticipantStorage(), bulk, contactIds);
          return { bulk, ...counts };
        });
        const expected = contactIds.length * bulk.medium.length;

        res.status(201).json({
          bulkMessageId: bulk.id,
          participantsCreated,
          participantsExpected: expected,
          participantFailures: 0,
          participantsSkipped,
          contactCount: contactIds.length,
          employerCount: employerIdList.length,
          employersWithoutContacts,
        });
      } catch (error) {
        if (error instanceof BulkEnqueueError) return res.status(error.status).json({ message: error.message });
        const message =
          error instanceof Error ? error.message : "Failed to queue bulk message";
        res.status(500).json({ message });
      }
    },
  );
}
