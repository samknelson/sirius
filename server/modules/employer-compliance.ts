import type { Express, Request, Response } from "express";
import { storage } from "../storage";
import { requireAccess } from "../services/access-policy-evaluator";
import { requireComponent } from "./components";
import { createBulkParticipantStorage } from "../storage/bulk/participants";
import { insertBulkMessageSchema } from "@shared/schema/bulk/schema";
import {
  complianceScopeSchema, complianceRecordSchema, complianceRecordId,
  EMPLOYER_COMPLIANCE_LETTER_CONTEXT, COMPLIANCE_ROOT,
} from "@shared/employer-compliance";
import { loadComplianceReport, validateComplianceReferences } from "../services/employer-compliance";
import { buildPreviewSeeds } from "../plugins/tokens/preview-seeds";
import { tokenContextRootNames } from "../plugins/tokens/contexts";
import { COMPLIANCE_LETTER_STARTER } from "../plugins/tokens/plugins/compliance";

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
        res.json(await loadComplianceReport(storage, parsedScope.data, {
          companyId: typeof companyId === "string" ? companyId : null,
        }));
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to load compliance dashboard";
        res.status(500).json({ message });
      }
    },
  );

  app.get("/api/employer-compliance/letter-starter", requireAuth,
    requireComponent("ledger"), requireAccess("staff"), (_req, res) => {
      res.json(COMPLIANCE_LETTER_STARTER);
    });

  app.get("/api/employer-compliance/letter-seeds", requireAuth,
    requireComponent("ledger"), requireAccess("staff"), async (req, res) => {
      const parsed = complianceRecordSchema.safeParse({
        ...req.query,
        ledgerAccountIds: typeof req.query.ledgerAccountIds === "string"
          ? req.query.ledgerAccountIds.split(",").filter(Boolean) : [],
      });
      if (!parsed.success) return res.status(400).json({ message: "Invalid compliance letter settings" });
      try {
        await validateComplianceReferences(storage, parsed.data);
        const report = await loadComplianceReport(storage, parsed.data, { employerId: parsed.data.employerId });
        if (!report.rows.length) return res.status(404).json({ message: "Employer unavailable or inactive" });
        res.json(await buildPreviewSeeds({ storage, req }, {
          rootNames: tokenContextRootNames(EMPLOYER_COMPLIANCE_LETTER_CONTEXT),
          recordsByRoot: {
            [COMPLIANCE_ROOT]: [{
              id: complianceRecordId(parsed.data),
              label: report.rows[0].employerName,
              hint: `${parsed.data.monthsBack} months ending ${parsed.data.year}-${String(parsed.data.month).padStart(2, "0")}`,
            }],
          },
        }));
      } catch (error) {
        res.status(400).json({ message: error instanceof Error ? error.message : "Compliance report unavailable" });
      }
    });

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
    requireAccess("bulk.edit"),
    async (req, res) => {
      try {
        const { name, medium, employerIds, contactTypeIds } = req.body ?? {};

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
        for (const r of rows) {
          employersCovered.add(r.employerId);
          if (!seen.has(r.contactId)) {
            seen.add(r.contactId);
            contactIds.push(r.contactId);
          }
        }
        const employersWithoutContacts = employerIdList.filter(
          (id) => !employersCovered.has(id),
        );

        const bulk = await storage.bulkMessages.create(parsed.data);
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
