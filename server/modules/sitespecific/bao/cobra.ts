import type { Express, Request, Response, NextFunction } from "express";
import { requireComponent } from "../../components";
import { storage } from "../../../storage";
import {
  createBaoCobraRateRequestSchema,
  updateBaoCobraRateRequestSchema,
  listBaoCobraRatesQuerySchema,
  createBaoCobraCaseRequestSchema,
  updateBaoCobraCaseRequestSchema,
  searchBaoCobraCasesQuerySchema,
  type InsertBaoCobraCase,
} from "../../../../shared/schema/sitespecific/bao/schema";
import { computeCobraDeadlines } from "../../../../shared/schema/sitespecific/bao/cobra";
import {
  BAO_COBRA_TRIGGER_CONFIG_VARIABLE,
  baoCobraTriggerConfigSchema,
  resolveTriggerForPlugin,
  type BaoCobraTriggerConfigRow,
} from "../../../../shared/schema/sitespecific/bao/cobra-triggers";
import { eligibilityPluginRegistry } from "../../../plugins/trust/eligibility/registry";
import { createUnifiedOptionsStorage } from "../../../storage/unified-options";

type AuthMiddleware = (req: Request, res: Response, next: NextFunction) => void | Promise<any>;
type PermissionMiddleware = (permissionKey: string) => (req: Request, res: Response, next: NextFunction) => void | Promise<any>;
type AccessMiddleware = (
  policyId: string,
  getEntityId?: (req: Request) => string | undefined | Promise<string | undefined>,
) => (req: Request, res: Response, next: NextFunction) => void | Promise<any>;

const RATES_TABLE_MISSING_MESSAGE =
  "COBRA rates table does not exist. Please enable the BAO component first.";
const CASES_TABLE_MISSING_MESSAGE =
  "COBRA cases table does not exist. Please enable the BAO component first.";

export function registerBaoCobraRoutes(
  app: Express,
  requireAuth: AuthMiddleware,
  _requirePermission: PermissionMiddleware,
  requireAccess: AccessMiddleware,
) {
  const ratesStorage = storage.baoCobraRates;
  const casesStorage = storage.baoCobraCases;
  const unifiedOptionsStorage = createUnifiedOptionsStorage();
  const componentMiddleware = requireComponent("sitespecific.bao");

  // -------------------------------------------------------------------------
  // Rates
  // -------------------------------------------------------------------------

  app.get(
    "/api/sitespecific/bao/cobra/rates",
    requireAuth,
    componentMiddleware,
    requireAccess("staff"),
    async (req, res) => {
      try {
        if (!(await ratesStorage.tableExists())) {
          return res.status(503).json({ message: RATES_TABLE_MISSING_MESSAGE });
        }
        const query = listBaoCobraRatesQuerySchema.parse({
          benefitId: req.query.benefitId || undefined,
          coveredLivesTier: req.query.coveredLivesTier || undefined,
          asOfYmd: req.query.asOfYmd || undefined,
        });
        const rates = await ratesStorage.list(query);
        res.json(rates);
      } catch (error: any) {
        if (error.name === "ZodError") {
          return res.status(400).json({ message: "Invalid filters", errors: error.errors });
        }
        console.error("Failed to list COBRA rates:", error);
        res.status(500).json({ message: "Failed to list COBRA rates" });
      }
    },
  );

  app.get(
    "/api/sitespecific/bao/cobra/rates/effective",
    requireAuth,
    componentMiddleware,
    requireAccess("staff"),
    async (req, res) => {
      try {
        if (!(await ratesStorage.tableExists())) {
          return res.status(503).json({ message: RATES_TABLE_MISSING_MESSAGE });
        }
        const query = listBaoCobraRatesQuerySchema.parse({
          benefitId: req.query.benefitId || undefined,
          coveredLivesTier: req.query.coveredLivesTier || undefined,
          asOfYmd: req.query.asOfYmd || undefined,
        });
        if (!query.benefitId || !query.coveredLivesTier) {
          return res
            .status(400)
            .json({ message: "benefitId and coveredLivesTier are required" });
        }
        const asOf = query.asOfYmd ?? new Date().toISOString().slice(0, 10);
        const rate = await ratesStorage.getEffectiveRate(
          query.benefitId,
          query.coveredLivesTier,
          asOf,
        );
        if (!rate) {
          return res.status(404).json({ message: "No effective rate found" });
        }
        res.json(rate);
      } catch (error: any) {
        if (error.name === "ZodError") {
          return res.status(400).json({ message: "Invalid filters", errors: error.errors });
        }
        console.error("Failed to get effective COBRA rate:", error);
        res.status(500).json({ message: "Failed to get effective COBRA rate" });
      }
    },
  );

  app.post(
    "/api/sitespecific/bao/cobra/rates",
    requireAuth,
    componentMiddleware,
    requireAccess("admin"),
    async (req, res) => {
      try {
        if (!(await ratesStorage.tableExists())) {
          return res.status(503).json({ message: RATES_TABLE_MISSING_MESSAGE });
        }
        const parsed = createBaoCobraRateRequestSchema.parse(req.body);
        const record = await ratesStorage.create({
          benefitId: parsed.benefitId,
          coveredLivesTier: parsed.coveredLivesTier,
          rate: String(parsed.rate),
          effectiveYmd: parsed.effectiveYmd,
        });
        res.status(201).json(record);
      } catch (error: any) {
        if (error.name === "ZodError") {
          return res.status(400).json({ message: "Invalid data", errors: error.errors });
        }
        if (error.code === "23505") {
          return res.status(409).json({
            message: "A rate already exists for this benefit, tier, and effective date",
          });
        }
        if (error.code === "23503") {
          return res.status(400).json({ message: "Unknown benefit" });
        }
        console.error("Failed to create COBRA rate:", error);
        res.status(500).json({ message: "Failed to create COBRA rate" });
      }
    },
  );

  app.patch(
    "/api/sitespecific/bao/cobra/rates/:id",
    requireAuth,
    componentMiddleware,
    requireAccess("admin"),
    async (req, res) => {
      try {
        if (!(await ratesStorage.tableExists())) {
          return res.status(503).json({ message: RATES_TABLE_MISSING_MESSAGE });
        }
        const parsed = updateBaoCobraRateRequestSchema.parse(req.body);
        const record = await ratesStorage.update(req.params.id, {
          ...(parsed.benefitId !== undefined ? { benefitId: parsed.benefitId } : {}),
          ...(parsed.coveredLivesTier !== undefined
            ? { coveredLivesTier: parsed.coveredLivesTier }
            : {}),
          ...(parsed.rate !== undefined ? { rate: String(parsed.rate) } : {}),
          ...(parsed.effectiveYmd !== undefined ? { effectiveYmd: parsed.effectiveYmd } : {}),
        });
        if (!record) {
          return res.status(404).json({ message: "Rate entry not found" });
        }
        res.json(record);
      } catch (error: any) {
        if (error.name === "ZodError") {
          return res.status(400).json({ message: "Invalid data", errors: error.errors });
        }
        if (error.code === "23505") {
          return res.status(409).json({
            message: "A rate already exists for this benefit, tier, and effective date",
          });
        }
        if (error.code === "23503") {
          return res.status(400).json({ message: "Unknown benefit" });
        }
        console.error("Failed to update COBRA rate:", error);
        res.status(500).json({ message: "Failed to update COBRA rate" });
      }
    },
  );

  app.delete(
    "/api/sitespecific/bao/cobra/rates/:id",
    requireAuth,
    componentMiddleware,
    requireAccess("admin"),
    async (req, res) => {
      try {
        if (!(await ratesStorage.tableExists())) {
          return res.status(503).json({ message: RATES_TABLE_MISSING_MESSAGE });
        }
        const deleted = await ratesStorage.delete(req.params.id);
        if (!deleted) {
          return res.status(404).json({ message: "Rate entry not found" });
        }
        res.status(204).send();
      } catch (error) {
        console.error("Failed to delete COBRA rate:", error);
        res.status(500).json({ message: "Failed to delete COBRA rate" });
      }
    },
  );

  // -------------------------------------------------------------------------
  // Trigger configuration (variable-backed; no dedicated table)
  // -------------------------------------------------------------------------

  app.get(
    "/api/sitespecific/bao/cobra/trigger-config",
    requireAuth,
    componentMiddleware,
    requireAccess("staff"),
    async (_req, res) => {
      try {
        const variable = await storage.variables.getByName(
          BAO_COBRA_TRIGGER_CONFIG_VARIABLE,
        );
        const parsed = variable
          ? baoCobraTriggerConfigSchema.safeParse(variable.value)
          : null;
        const config = parsed?.success ? parsed.data : null;

        const rows: BaoCobraTriggerConfigRow[] = eligibilityPluginRegistry
          .getAll()
          .map(({ id, metadata }) => {
            const resolved = resolveTriggerForPlugin(config, id, metadata.name);
            return {
              pluginId: id,
              pluginName: metadata.name,
              pluginDescription: metadata.description,
              trigger: resolved.trigger,
              qualifyingEventId: resolved.qualifyingEventId ?? null,
              isDefault: !config?.plugins?.[id],
            };
          })
          .sort((a, b) => a.pluginName.localeCompare(b.pluginName));
        res.json({ rows });
      } catch (error) {
        console.error("Failed to load COBRA trigger config:", error);
        res.status(500).json({ message: "Failed to load COBRA trigger config" });
      }
    },
  );

  app.put(
    "/api/sitespecific/bao/cobra/trigger-config",
    requireAuth,
    componentMiddleware,
    requireAccess("admin"),
    async (req, res) => {
      try {
        const parsed = baoCobraTriggerConfigSchema.parse(req.body);
        const existing = await storage.variables.getByName(
          BAO_COBRA_TRIGGER_CONFIG_VARIABLE,
        );
        if (existing) {
          await storage.variables.update(existing.id, { value: parsed });
        } else {
          await storage.variables.create({
            name: BAO_COBRA_TRIGGER_CONFIG_VARIABLE,
            value: parsed,
          });
        }
        res.json(parsed);
      } catch (error: any) {
        if (error.name === "ZodError") {
          return res.status(400).json({ message: "Invalid data", errors: error.errors });
        }
        console.error("Failed to save COBRA trigger config:", error);
        res.status(500).json({ message: "Failed to save COBRA trigger config" });
      }
    },
  );

  // -------------------------------------------------------------------------
  // Cases
  // -------------------------------------------------------------------------

  /**
   * Resolve whether the given status is a "closed" status. Returns null when
   * the status does not exist. The actual active-case invariants are enforced
   * atomically inside the storage layer (advisory lock + re-check in one
   * transaction), so concurrent writes cannot both slip past the check.
   */
  async function resolveStatusClosed(statusId: string): Promise<boolean | null> {
    const status = await unifiedOptionsStorage.get("bao-cobra-status", statusId);
    if (!status) {
      return null;
    }
    return Boolean(status.closed);
  }

  /** Map storage invariant-violation codes to user-facing 409 messages. */
  function invariantMessage(error: unknown): string | null {
    const msg = error instanceof Error ? error.message : "";
    if (msg === "ACTIVE_CASE_EXISTS") {
      return "This person already has an active COBRA case";
    }
    if (msg === "ACTIVE_BENEFITS_EXIST") {
      return "This person currently has active medical or dental benefits and cannot have an active COBRA case";
    }
    return null;
  }

  app.get(
    "/api/sitespecific/bao/cobra/cases",
    requireAuth,
    componentMiddleware,
    requireAccess("staff"),
    async (req, res) => {
      try {
        if (!(await casesStorage.tableExists())) {
          return res.status(503).json({ message: CASES_TABLE_MISSING_MESSAGE });
        }
        const query = searchBaoCobraCasesQuerySchema.parse({
          statusId: req.query.statusId || undefined,
          qualifyingEventId: req.query.qualifyingEventId || undefined,
          workerId: req.query.workerId || undefined,
          fromYmd: req.query.fromYmd || undefined,
          toYmd: req.query.toYmd || undefined,
        });
        const results = await casesStorage.search(query);
        res.json(results);
      } catch (error: any) {
        if (error.name === "ZodError") {
          return res.status(400).json({ message: "Invalid filters", errors: error.errors });
        }
        console.error("Failed to search COBRA cases:", error);
        res.status(500).json({ message: "Failed to search COBRA cases" });
      }
    },
  );

  app.get(
    "/api/sitespecific/bao/cobra/cases/:id",
    requireAuth,
    componentMiddleware,
    requireAccess("staff"),
    async (req, res) => {
      try {
        if (!(await casesStorage.tableExists())) {
          return res.status(503).json({ message: CASES_TABLE_MISSING_MESSAGE });
        }
        const record = await casesStorage.get(req.params.id);
        if (!record) {
          return res.status(404).json({ message: "COBRA case not found" });
        }
        res.json(record);
      } catch (error) {
        console.error("Failed to get COBRA case:", error);
        res.status(500).json({ message: "Failed to get COBRA case" });
      }
    },
  );

  app.post(
    "/api/sitespecific/bao/cobra/cases",
    requireAuth,
    componentMiddleware,
    requireAccess("staff"),
    async (req, res) => {
      try {
        if (!(await casesStorage.tableExists())) {
          return res.status(503).json({ message: CASES_TABLE_MISSING_MESSAGE });
        }
        const parsed = createBaoCobraCaseRequestSchema.parse(req.body);

        const statusClosed = await resolveStatusClosed(parsed.statusId);
        if (statusClosed === null) {
          return res.status(409).json({ message: "Unknown COBRA status" });
        }

        const deadlines = computeCobraDeadlines(
          parsed.source,
          parsed.cobraEffectiveYmd,
          parsed.electionMadeYmd,
        );
        const entry: InsertBaoCobraCase = {
          source: parsed.source,
          statusId: parsed.statusId,
          qualifyingEventId: parsed.qualifyingEventId ?? null,
          coveredPersonWorkerId: parsed.coveredPersonWorkerId,
          subscriberWorkerId: parsed.subscriberWorkerId,
          relationship: parsed.relationship ?? null,
          cobraEffectiveYmd: parsed.cobraEffectiveYmd,
          offerYmd: deadlines.offerYmd,
          lastDayToElectYmd: deadlines.lastDayToElectYmd,
          electionMadeYmd: parsed.electionMadeYmd ?? null,
          initialPaymentDeadlineYmd: deadlines.initialPaymentDeadlineYmd,
          paymentStatus: parsed.paymentStatus ?? null,
          medicalBenefitLostId: parsed.medicalBenefitLostId ?? null,
          dentalBenefitLostId: parsed.dentalBenefitLostId ?? null,
          maxPeriodYmd: deadlines.maxPeriodYmd,
          data: parsed.data ?? null,
        };
        const record = await casesStorage.createEnforcingInvariants(entry, statusClosed);
        res.status(201).json(record);
      } catch (error: any) {
        if (error.name === "ZodError") {
          return res.status(400).json({ message: "Invalid data", errors: error.errors });
        }
        const conflict = invariantMessage(error);
        if (conflict) {
          return res.status(409).json({ message: conflict });
        }
        if (error.code === "23503") {
          return res.status(400).json({ message: "Unknown worker, status, event, or benefit" });
        }
        console.error("Failed to create COBRA case:", error);
        res.status(500).json({ message: "Failed to create COBRA case" });
      }
    },
  );

  app.patch(
    "/api/sitespecific/bao/cobra/cases/:id",
    requireAuth,
    componentMiddleware,
    requireAccess("staff"),
    async (req, res) => {
      try {
        if (!(await casesStorage.tableExists())) {
          return res.status(503).json({ message: CASES_TABLE_MISSING_MESSAGE });
        }
        const parsed = updateBaoCobraCaseRequestSchema.parse(req.body);
        const existing = await casesStorage.getRaw(req.params.id);
        if (!existing) {
          return res.status(404).json({ message: "COBRA case not found" });
        }

        const nextStatusId = parsed.statusId ?? existing.statusId;
        const statusClosed = await resolveStatusClosed(nextStatusId);
        if (statusClosed === null) {
          return res.status(409).json({ message: "Unknown COBRA status" });
        }

        // Deadlines are always recomputed from the (possibly updated) source,
        // effective date, and election date — never taken from the request.
        const nextSource = parsed.source ?? existing.source;
        const nextEffectiveYmd = parsed.cobraEffectiveYmd ?? existing.cobraEffectiveYmd;
        const nextElectionYmd =
          parsed.electionMadeYmd !== undefined
            ? parsed.electionMadeYmd
            : existing.electionMadeYmd;
        const deadlines = computeCobraDeadlines(nextSource, nextEffectiveYmd, nextElectionYmd);

        const record = await casesStorage.updateEnforcingInvariants(req.params.id, {
          ...(parsed.source !== undefined ? { source: parsed.source } : {}),
          ...(parsed.statusId !== undefined ? { statusId: parsed.statusId } : {}),
          ...(parsed.qualifyingEventId !== undefined
            ? { qualifyingEventId: parsed.qualifyingEventId }
            : {}),
          ...(parsed.relationship !== undefined ? { relationship: parsed.relationship } : {}),
          ...(parsed.cobraEffectiveYmd !== undefined
            ? { cobraEffectiveYmd: parsed.cobraEffectiveYmd }
            : {}),
          ...(parsed.electionMadeYmd !== undefined
            ? { electionMadeYmd: parsed.electionMadeYmd }
            : {}),
          ...(parsed.paymentStatus !== undefined ? { paymentStatus: parsed.paymentStatus } : {}),
          ...(parsed.medicalBenefitLostId !== undefined
            ? { medicalBenefitLostId: parsed.medicalBenefitLostId }
            : {}),
          ...(parsed.dentalBenefitLostId !== undefined
            ? { dentalBenefitLostId: parsed.dentalBenefitLostId }
            : {}),
          ...(parsed.data !== undefined ? { data: parsed.data } : {}),
          offerYmd: deadlines.offerYmd,
          lastDayToElectYmd: deadlines.lastDayToElectYmd,
          initialPaymentDeadlineYmd: deadlines.initialPaymentDeadlineYmd,
          maxPeriodYmd: deadlines.maxPeriodYmd,
        }, existing.coveredPersonWorkerId, statusClosed);
        res.json(record);
      } catch (error: any) {
        if (error.name === "ZodError") {
          return res.status(400).json({ message: "Invalid data", errors: error.errors });
        }
        const conflict = invariantMessage(error);
        if (conflict) {
          return res.status(409).json({ message: conflict });
        }
        if (error.code === "23503") {
          return res.status(400).json({ message: "Unknown worker, status, event, or benefit" });
        }
        console.error("Failed to update COBRA case:", error);
        res.status(500).json({ message: "Failed to update COBRA case" });
      }
    },
  );

  app.delete(
    "/api/sitespecific/bao/cobra/cases/:id",
    requireAuth,
    componentMiddleware,
    requireAccess("admin"),
    async (req, res) => {
      try {
        if (!(await casesStorage.tableExists())) {
          return res.status(503).json({ message: CASES_TABLE_MISSING_MESSAGE });
        }
        const deleted = await casesStorage.delete(req.params.id);
        if (!deleted) {
          return res.status(404).json({ message: "COBRA case not found" });
        }
        res.status(204).send();
      } catch (error) {
        console.error("Failed to delete COBRA case:", error);
        res.status(500).json({ message: "Failed to delete COBRA case" });
      }
    },
  );
}
