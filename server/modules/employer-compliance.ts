import type { Express, Request, Response } from "express";
import { storage } from "../storage";
import { requireAccess } from "../services/access-policy-evaluator";
import { requireComponent } from "./components";
import { createBulkParticipantStorage } from "../storage/bulk/participants";
import { insertBulkMessageSchema } from "@shared/schema/bulk/schema";
import { complianceScopeSchema } from "@shared/employer-compliance";
import { loadComplianceReport, validateComplianceReferences, complianceLetterValues } from "../services/employer-compliance";

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
    async (req, res) => {
      try {
        const { name, medium, employerIds, contactTypeIds, reportScope } = req.body ?? {};

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
        if (!parsed.success) {
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
        const bulk = await storage.bulkMessages.create({
          ...parsed.data,
          data: {
            complianceReport: {
              scope: parsedScope.data,
              runAt,
              wizardName: wizardPluginRegistry.get(parsedScope.data.wizardType)!.name,
              accountName: accounts.map(account => account!.name).join(", "),
              employerByContact,
              valuesByEmployer: Object.fromEntries(selectedRows.map(row => [
                row.employerId, complianceLetterValues(row.employerName, row.months, report.monthPeriods),
              ])),
            },
          },
        });
        const participantStorage = createBulkParticipantStorage();
        const mediums = parsed.data.medium;

        const tasks: Array<Promise<{ ok: boolean; reason?: string }>> = [];
        for (const contactId of contactIds) {
          for (const m of mediums) {
            tasks.push(
              participantStorage
                .create({ messageId: bulk.id, contactId, medium: m })
                .then(() => ({ ok: true }))
                .catch((err) => ({
                  ok: false,
                  reason: err instanceof Error ? err.message : "unknown",
                })),
            );
          }
        }
        const results = await Promise.all(tasks);
        const participantsCreated = results.filter((r) => r.ok).length;
        const expected = contactIds.length * mediums.length;
        const failures = results.filter((r) => !r.ok);
        const uniqueViolations = failures.filter(
          (r) => r.reason && /unique|duplicate/i.test(r.reason),
        ).length;
        const realFailures = failures.length - uniqueViolations;

        res.status(201).json({
          bulkMessageId: bulk.id,
          participantsCreated,
          participantsExpected: expected,
          participantFailures: realFailures,
          contactCount: contactIds.length,
          employerCount: employerIdList.length,
          employersWithoutContacts,
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to queue bulk message";
        res.status(500).json({ message });
      }
    },
  );
}
