import type { Express, Request, Response } from "express";
import { storage } from "../storage";
import { requireAccess } from "../services/access-policy-evaluator";
import { requireComponent } from "./components";
import { createBulkParticipantStorage } from "../storage/bulk/participants";
import { insertBulkMessageSchema } from "@shared/schema/bulk/schema";

type RequireAuth = (req: Request, res: Response, next: () => void) => void;

interface MonthCell {
  year: number;
  month: number;
  wizardId: string | null;
  status: string | null;
  currentStep: string | null;
  balanceDelta: string | null;
}

interface ComplianceRow {
  employerId: string;
  employerName: string;
  siriusId: number;
  isActive: boolean;
  companyId: string | null;
  companyName: string | null;
  months: MonthCell[];
  balances: Record<string, string | null>;
  totalBalance: string;
}

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

        const span = Math.max(1, Math.min(24, monthsBackNum));

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

        const employersWithUploads =
          await storage.wizardEmployerMonthly.listAllEmployersWithUploadsForRange(
            yearNum,
            monthNum,
            wizardType,
            span,
          );

        const monthPeriods: Array<{ year: number; month: number }> = [];
        for (let i = span - 1; i >= 0; i--) {
          const d = new Date(yearNum, monthNum - 1 - i, 1);
          monthPeriods.push({ year: d.getFullYear(), month: d.getMonth() + 1 });
        }

        const allActiveEmployers = employersWithUploads.filter((e) => e.employer.isActive);
        const initialEmployerIds = allActiveEmployers.map((e) => e.employer.id);

        const companyByEmployer =
          await storage.employerCompanies.getByEmployerIdsWithCompanyName(initialEmployerIds);
        const companyMap = new Map<string, { id: string; name: string }>();
        companyByEmployer.forEach((c, employerId) => {
          companyMap.set(employerId, { id: c.companyId, name: c.companyName });
        });

        const companyFilter = typeof companyId === "string" ? companyId : null;
        const activeEmployers = companyFilter
          ? allActiveEmployers.filter((e) => {
              const m = companyMap.get(e.employer.id);
              if (companyFilter === "__none__") return !m;
              return m?.id === companyFilter;
            })
          : allActiveEmployers;
        const employerIds = activeEmployers.map((e) => e.employer.id);

        const balanceMap = new Map<string, Map<string, string>>();
        const balanceRows = await storage.ledger.entries.getBalancesByEntityAndAccount(
          "employer",
          employerIds,
          ledgerAccountIds,
        );
        for (const r of balanceRows) {
          if (!balanceMap.has(r.entityId)) {
            balanceMap.set(r.entityId, new Map());
          }
          balanceMap.get(r.entityId)!.set(r.accountId, r.total);
        }

        const monthlyDeltaMap = new Map<string, Map<string, number>>();
        const monthKeys = monthPeriods.map(
          (p) => `${p.year}-${String(p.month).padStart(2, "0")}`,
        );
        const monthlyRows = await storage.ledger.entries.getMonthlyDeltasByEntityAndAccount(
          "employer",
          employerIds,
          ledgerAccountIds,
          monthKeys,
        );
        for (const r of monthlyRows) {
          if (!monthlyDeltaMap.has(r.entityId)) {
            monthlyDeltaMap.set(r.entityId, new Map());
          }
          monthlyDeltaMap.get(r.entityId)!.set(r.ym, Number(r.total));
        }

        const rows: ComplianceRow[] = activeEmployers.map(({ employer, uploads }) => {
          const sortedUploads = [...uploads].sort((a, b) => {
            const ad = a.createdAt ? new Date(a.createdAt).getTime() : 0;
            const bd = b.createdAt ? new Date(b.createdAt).getTime() : 0;
            return bd - ad;
          });
          const employerMonthlyDeltas = monthlyDeltaMap.get(employer.id);
          const months: MonthCell[] = monthPeriods.map((p) => {
            const u = sortedUploads.find((up) => up.year === p.year && up.month === p.month);
            const ymKey = `${p.year}-${String(p.month).padStart(2, "0")}`;
            const delta = employerMonthlyDeltas?.get(ymKey);
            return {
              year: p.year,
              month: p.month,
              wizardId: u ? u.id : null,
              status: u ? u.status : null,
              currentStep: u ? u.currentStep : null,
              balanceDelta:
                ledgerAccountIds.length > 0 && delta !== undefined
                  ? delta.toFixed(2)
                  : null,
            };
          });

          const accountBalances: Record<string, string | null> = {};
          let total = 0;
          const employerBalances = balanceMap.get(employer.id);
          for (const accountId of ledgerAccountIds) {
            const v = employerBalances?.get(accountId) ?? null;
            accountBalances[accountId] = v;
            if (v !== null) total += Number(v);
          }

          const company = companyMap.get(employer.id);

          return {
            employerId: employer.id,
            employerName: employer.name,
            siriusId: employer.siriusId,
            isActive: employer.isActive,
            companyId: company?.id ?? null,
            companyName: company?.name ?? null,
            months,
            balances: accountBalances,
            totalBalance: total.toFixed(2),
          };
        });

        res.json({
          monthPeriods,
          rows,
        });
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
