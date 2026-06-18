import type { Express, Request, Response, NextFunction } from "express";
import { requireComponent } from "../../components";
import { storage } from "../../../storage";
import { 
  insertGbhetPensionBenefitScheduleSchema, 
  insertGbhetPensionAccrualTierSchema, 
  insertGbhetPensionAnnualSummarySchema, 
  insertGbhetPensionShareValueSchema,
  insertGbhetPensionPlanYearSchema,
  insertGbhetPensionEmployerPlanSchema,
  insertGbhetPensionAiFactorSchema,
  insertGbhetPensionPayoutFactorSchema,
  insertGbhetPensionEarlyRetirementFactorSchema,
  insertGbhetPensionInterestRateSchema,
} from "../../../../shared/schema/sitespecific/gbhet-pension/schema";
import { computeSlaForWorker, computeSlaForAllWorkers, SLA_ACCOUNT_VARIABLE, SLA_TRIGGER_ACCOUNT_VARIABLE, clearAccountCache, SlaConfigError, VAR_CONTRIB_SOURCE_ACCOUNT_VARIABLE, VAR_CONTRIB_TARGET_ACCOUNT_VARIABLE } from "../../../services/sitespecific/gbhet/pension-sla";
import { computePayout, computeAllPayouts, getWorkerPensionSummary } from "../../../services/sitespecific/gbhet/pension-payout-calculator";

type AuthMiddleware = (req: Request, res: Response, next: NextFunction) => void | Promise<any>;
type PermissionMiddleware = (permissionKey: string) => (req: Request, res: Response, next: NextFunction) => void | Promise<any>;

export function registerGbhetPensionRoutes(
  app: Express,
  requireAuth: AuthMiddleware,
  requirePermission: PermissionMiddleware
) {
  const componentMiddleware = requireComponent("sitespecific.gbhet.pension");
  const mutatingComponentMiddleware = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const { isComponentEnabled } = await import("../../components");
    const enabled = await isComponentEnabled("sitespecific.gbhet.pension");
    if (!enabled) {
      res.status(503).json({ message: "GBHE Pension component is not enabled" });
      return;
    }
    next();
  };
  const pensionStorage = storage.gbhetPension;

  // ==================== Benefit Schedules Routes ====================

  app.get("/api/sitespecific/gbhet/pension/benefit-schedules", requireAuth, requirePermission("staff"), componentMiddleware, async (req, res) => {
    try {
      const tableExists = await pensionStorage.benefitSchedules.tableExists();
      if (!tableExists) {
        return res.status(503).json({ 
          message: "GBHET Pension Benefit Schedules table does not exist. Please enable the GBHET Pension component first." 
        });
      }
      const records = await pensionStorage.benefitSchedules.getAll();
      res.json(records);
    } catch (error) {
      console.error("Failed to fetch pension benefit schedules:", error);
      res.status(500).json({ message: "Failed to fetch benefit schedules" });
    }
  });

  app.get("/api/sitespecific/gbhet/pension/benefit-schedules/year/:year", requireAuth, requirePermission("staff"), componentMiddleware, async (req, res) => {
    try {
      const tableExists = await pensionStorage.benefitSchedules.tableExists();
      if (!tableExists) {
        return res.status(503).json({ message: "GBHET Pension Benefit Schedules table does not exist." });
      }
      const year = parseInt(req.params.year);
      const record = await pensionStorage.benefitSchedules.getByYear(year);
      if (!record) {
        return res.status(404).json({ message: "Benefit schedule not found for this year" });
      }
      res.json(record);
    } catch (error) {
      console.error("Failed to fetch pension benefit schedule by year:", error);
      res.status(500).json({ message: "Failed to fetch benefit schedule" });
    }
  });

  app.get("/api/sitespecific/gbhet/pension/benefit-schedules/:id", requireAuth, requirePermission("staff"), componentMiddleware, async (req, res) => {
    try {
      const tableExists = await pensionStorage.benefitSchedules.tableExists();
      if (!tableExists) {
        return res.status(503).json({ message: "GBHET Pension Benefit Schedules table does not exist." });
      }
      const record = await pensionStorage.benefitSchedules.get(req.params.id);
      if (!record) {
        return res.status(404).json({ message: "Benefit schedule not found" });
      }
      res.json(record);
    } catch (error) {
      console.error("Failed to fetch pension benefit schedule:", error);
      res.status(500).json({ message: "Failed to fetch benefit schedule" });
    }
  });

  app.post("/api/sitespecific/gbhet/pension/benefit-schedules", requireAuth, requirePermission("admin"), mutatingComponentMiddleware, async (req, res) => {
    try {
      const tableExists = await pensionStorage.benefitSchedules.tableExists();
      if (!tableExists) {
        return res.status(503).json({ message: "GBHET Pension Benefit Schedules table does not exist." });
      }
      const parsed = insertGbhetPensionBenefitScheduleSchema.parse(req.body);
      const record = await pensionStorage.benefitSchedules.create(parsed);
      res.status(201).json(record);
    } catch (error: any) {
      if (error.name === "ZodError") {
        return res.status(400).json({ message: "Invalid data", errors: error.errors });
      }
      if (error.code === "23505") {
        return res.status(409).json({ message: "A benefit schedule for this year already exists" });
      }
      console.error("Failed to create pension benefit schedule:", error);
      res.status(500).json({ message: "Failed to create benefit schedule" });
    }
  });

  app.patch("/api/sitespecific/gbhet/pension/benefit-schedules/:id", requireAuth, requirePermission("admin"), mutatingComponentMiddleware, async (req, res) => {
    try {
      const tableExists = await pensionStorage.benefitSchedules.tableExists();
      if (!tableExists) {
        return res.status(503).json({ message: "GBHET Pension Benefit Schedules table does not exist." });
      }
      const parsed = insertGbhetPensionBenefitScheduleSchema.partial().parse(req.body);
      const record = await pensionStorage.benefitSchedules.update(req.params.id, parsed);
      if (!record) {
        return res.status(404).json({ message: "Benefit schedule not found" });
      }
      res.json(record);
    } catch (error: any) {
      if (error.name === "ZodError") {
        return res.status(400).json({ message: "Invalid data", errors: error.errors });
      }
      if (error.code === "23505") {
        return res.status(409).json({ message: "A benefit schedule for this year already exists" });
      }
      console.error("Failed to update pension benefit schedule:", error);
      res.status(500).json({ message: "Failed to update benefit schedule" });
    }
  });

  app.delete("/api/sitespecific/gbhet/pension/benefit-schedules/:id", requireAuth, requirePermission("admin"), mutatingComponentMiddleware, async (req, res) => {
    try {
      const tableExists = await pensionStorage.benefitSchedules.tableExists();
      if (!tableExists) {
        return res.status(503).json({ message: "GBHET Pension Benefit Schedules table does not exist." });
      }
      const deleted = await pensionStorage.benefitSchedules.delete(req.params.id);
      if (!deleted) {
        return res.status(404).json({ message: "Benefit schedule not found" });
      }
      res.status(204).send();
    } catch (error) {
      console.error("Failed to delete pension benefit schedule:", error);
      res.status(500).json({ message: "Failed to delete benefit schedule" });
    }
  });

  // ==================== Accrual Tiers Routes ====================

  app.get("/api/sitespecific/gbhet/pension/accrual-tiers", requireAuth, requirePermission("staff"), componentMiddleware, async (req, res) => {
    try {
      const tableExists = await pensionStorage.accrualTiers.tableExists();
      if (!tableExists) {
        return res.status(503).json({ 
          message: "GBHET Pension Accrual Tiers table does not exist. Please enable the GBHET Pension component first." 
        });
      }
      const records = await pensionStorage.accrualTiers.getAll();
      res.json(records);
    } catch (error) {
      console.error("Failed to fetch pension accrual tiers:", error);
      res.status(500).json({ message: "Failed to fetch accrual tiers" });
    }
  });

  app.get("/api/sitespecific/gbhet/pension/accrual-tiers/year/:year", requireAuth, requirePermission("staff"), componentMiddleware, async (req, res) => {
    try {
      const tableExists = await pensionStorage.accrualTiers.tableExists();
      if (!tableExists) {
        return res.status(503).json({ message: "GBHET Pension Accrual Tiers table does not exist." });
      }
      const year = parseInt(req.params.year);
      const records = await pensionStorage.accrualTiers.getByYear(year);
      res.json(records);
    } catch (error) {
      console.error("Failed to fetch pension accrual tiers by year:", error);
      res.status(500).json({ message: "Failed to fetch accrual tiers" });
    }
  });

  app.get("/api/sitespecific/gbhet/pension/accrual-tiers/:id", requireAuth, requirePermission("staff"), componentMiddleware, async (req, res) => {
    try {
      const tableExists = await pensionStorage.accrualTiers.tableExists();
      if (!tableExists) {
        return res.status(503).json({ message: "GBHET Pension Accrual Tiers table does not exist." });
      }
      const record = await pensionStorage.accrualTiers.get(req.params.id);
      if (!record) {
        return res.status(404).json({ message: "Accrual tier not found" });
      }
      res.json(record);
    } catch (error) {
      console.error("Failed to fetch pension accrual tier:", error);
      res.status(500).json({ message: "Failed to fetch accrual tier" });
    }
  });

  app.post("/api/sitespecific/gbhet/pension/accrual-tiers", requireAuth, requirePermission("admin"), mutatingComponentMiddleware, async (req, res) => {
    try {
      const tableExists = await pensionStorage.accrualTiers.tableExists();
      if (!tableExists) {
        return res.status(503).json({ message: "GBHET Pension Accrual Tiers table does not exist." });
      }
      const parsed = insertGbhetPensionAccrualTierSchema.parse(req.body);
      const record = await pensionStorage.accrualTiers.create(parsed);
      res.status(201).json(record);
    } catch (error: any) {
      if (error.name === "ZodError") {
        return res.status(400).json({ message: "Invalid data", errors: error.errors });
      }
      if (error.code === "23505") {
        return res.status(409).json({ message: "An accrual tier with this year and min hours already exists" });
      }
      console.error("Failed to create pension accrual tier:", error);
      res.status(500).json({ message: "Failed to create accrual tier" });
    }
  });

  app.patch("/api/sitespecific/gbhet/pension/accrual-tiers/:id", requireAuth, requirePermission("admin"), mutatingComponentMiddleware, async (req, res) => {
    try {
      const tableExists = await pensionStorage.accrualTiers.tableExists();
      if (!tableExists) {
        return res.status(503).json({ message: "GBHET Pension Accrual Tiers table does not exist." });
      }
      const parsed = insertGbhetPensionAccrualTierSchema.partial().parse(req.body);
      const record = await pensionStorage.accrualTiers.update(req.params.id, parsed);
      if (!record) {
        return res.status(404).json({ message: "Accrual tier not found" });
      }
      res.json(record);
    } catch (error: any) {
      if (error.name === "ZodError") {
        return res.status(400).json({ message: "Invalid data", errors: error.errors });
      }
      if (error.code === "23505") {
        return res.status(409).json({ message: "An accrual tier with this year and min hours already exists" });
      }
      console.error("Failed to update pension accrual tier:", error);
      res.status(500).json({ message: "Failed to update accrual tier" });
    }
  });

  app.delete("/api/sitespecific/gbhet/pension/accrual-tiers/:id", requireAuth, requirePermission("admin"), mutatingComponentMiddleware, async (req, res) => {
    try {
      const tableExists = await pensionStorage.accrualTiers.tableExists();
      if (!tableExists) {
        return res.status(503).json({ message: "GBHET Pension Accrual Tiers table does not exist." });
      }
      const deleted = await pensionStorage.accrualTiers.delete(req.params.id);
      if (!deleted) {
        return res.status(404).json({ message: "Accrual tier not found" });
      }
      res.status(204).send();
    } catch (error) {
      console.error("Failed to delete pension accrual tier:", error);
      res.status(500).json({ message: "Failed to delete accrual tier" });
    }
  });

  // ==================== Annual Summaries Routes ====================

  app.get("/api/sitespecific/gbhet/pension/annual-summaries/year/:year", requireAuth, requirePermission("staff"), componentMiddleware, async (req, res) => {
    try {
      const tableExists = await pensionStorage.annualSummary.tableExists();
      if (!tableExists) {
        return res.status(503).json({ message: "GBHET Pension Annual Summary table does not exist." });
      }
      const year = parseInt(req.params.year);
      const records = await pensionStorage.annualSummary.getByYear(year);
      res.json(records);
    } catch (error) {
      console.error("Failed to fetch pension annual summaries by year:", error);
      res.status(500).json({ message: "Failed to fetch annual summaries" });
    }
  });

  app.get("/api/sitespecific/gbhet/pension/annual-summaries/worker/:workerId/year/:year", requireAuth, requirePermission("staff"), componentMiddleware, async (req, res) => {
    try {
      const tableExists = await pensionStorage.annualSummary.tableExists();
      if (!tableExists) {
        return res.status(503).json({ message: "GBHET Pension Annual Summary table does not exist." });
      }
      const year = parseInt(req.params.year);
      const record = await pensionStorage.annualSummary.getByWorkerAndYear(req.params.workerId, year);
      if (!record) {
        return res.status(404).json({ message: "Annual summary not found for this worker and year" });
      }
      res.json(record);
    } catch (error) {
      console.error("Failed to fetch pension annual summary:", error);
      res.status(500).json({ message: "Failed to fetch annual summary" });
    }
  });

  app.post("/api/sitespecific/gbhet/pension/annual-summaries", requireAuth, requirePermission("admin"), mutatingComponentMiddleware, async (req, res) => {
    try {
      const tableExists = await pensionStorage.annualSummary.tableExists();
      if (!tableExists) {
        return res.status(503).json({ message: "GBHET Pension Annual Summary table does not exist." });
      }
      const parsed = insertGbhetPensionAnnualSummarySchema.parse(req.body);
      const record = await pensionStorage.annualSummary.upsert(parsed);
      res.status(201).json(record);
    } catch (error: any) {
      if (error.name === "ZodError") {
        return res.status(400).json({ message: "Invalid data", errors: error.errors });
      }
      if (error.code === "23505") {
        return res.status(409).json({ message: "An annual summary for this worker and year already exists" });
      }
      console.error("Failed to upsert pension annual summary:", error);
      res.status(500).json({ message: "Failed to upsert annual summary" });
    }
  });

  // ==================== Share Values Routes ====================

  app.get("/api/sitespecific/gbhet/pension/share-values", requireAuth, requirePermission("staff"), componentMiddleware, async (req, res) => {
    try {
      const tableExists = await pensionStorage.shareValues.tableExists();
      if (!tableExists) {
        return res.status(503).json({ 
          message: "GBHET Pension Share Values table does not exist. Please enable the GBHET Pension component first." 
        });
      }
      const records = await pensionStorage.shareValues.getAll();
      res.json(records);
    } catch (error) {
      console.error("Failed to fetch pension share values:", error);
      res.status(500).json({ message: "Failed to fetch share values" });
    }
  });

  app.get("/api/sitespecific/gbhet/pension/share-values/current/:date", requireAuth, requirePermission("staff"), componentMiddleware, async (req, res) => {
    try {
      const tableExists = await pensionStorage.shareValues.tableExists();
      if (!tableExists) {
        return res.status(503).json({ message: "GBHET Pension Share Values table does not exist." });
      }
      const record = await pensionStorage.shareValues.getCurrentValue(req.params.date);
      if (!record) {
        return res.status(404).json({ message: "No share value found for this date" });
      }
      res.json(record);
    } catch (error) {
      console.error("Failed to fetch current pension share value:", error);
      res.status(500).json({ message: "Failed to fetch share value" });
    }
  });

  app.get("/api/sitespecific/gbhet/pension/share-values/:id", requireAuth, requirePermission("staff"), componentMiddleware, async (req, res) => {
    try {
      const tableExists = await pensionStorage.shareValues.tableExists();
      if (!tableExists) {
        return res.status(503).json({ message: "GBHET Pension Share Values table does not exist." });
      }
      const record = await pensionStorage.shareValues.get(req.params.id);
      if (!record) {
        return res.status(404).json({ message: "Share value not found" });
      }
      res.json(record);
    } catch (error) {
      console.error("Failed to fetch pension share value:", error);
      res.status(500).json({ message: "Failed to fetch share value" });
    }
  });

  app.post("/api/sitespecific/gbhet/pension/share-values", requireAuth, requirePermission("admin"), mutatingComponentMiddleware, async (req, res) => {
    try {
      const tableExists = await pensionStorage.shareValues.tableExists();
      if (!tableExists) {
        return res.status(503).json({ message: "GBHET Pension Share Values table does not exist." });
      }
      const parsed = insertGbhetPensionShareValueSchema.parse(req.body);
      const record = await pensionStorage.shareValues.create(parsed);
      res.status(201).json(record);
    } catch (error: any) {
      if (error.name === "ZodError") {
        return res.status(400).json({ message: "Invalid data", errors: error.errors });
      }
      if (error.code === "23505") {
        return res.status(409).json({ message: "A share value for this effective date already exists" });
      }
      console.error("Failed to create pension share value:", error);
      res.status(500).json({ message: "Failed to create share value" });
    }
  });

  app.patch("/api/sitespecific/gbhet/pension/share-values/:id", requireAuth, requirePermission("admin"), mutatingComponentMiddleware, async (req, res) => {
    try {
      const tableExists = await pensionStorage.shareValues.tableExists();
      if (!tableExists) {
        return res.status(503).json({ message: "GBHET Pension Share Values table does not exist." });
      }
      const parsed = insertGbhetPensionShareValueSchema.partial().parse(req.body);
      const record = await pensionStorage.shareValues.update(req.params.id, parsed);
      if (!record) {
        return res.status(404).json({ message: "Share value not found" });
      }
      res.json(record);
    } catch (error: any) {
      if (error.name === "ZodError") {
        return res.status(400).json({ message: "Invalid data", errors: error.errors });
      }
      if (error.code === "23505") {
        return res.status(409).json({ message: "A share value for this effective date already exists" });
      }
      console.error("Failed to update pension share value:", error);
      res.status(500).json({ message: "Failed to update share value" });
    }
  });

  app.delete("/api/sitespecific/gbhet/pension/share-values/:id", requireAuth, requirePermission("admin"), mutatingComponentMiddleware, async (req, res) => {
    try {
      const tableExists = await pensionStorage.shareValues.tableExists();
      if (!tableExists) {
        return res.status(503).json({ message: "GBHET Pension Share Values table does not exist." });
      }
      const deleted = await pensionStorage.shareValues.delete(req.params.id);
      if (!deleted) {
        return res.status(404).json({ message: "Share value not found" });
      }
      res.status(204).send();
    } catch (error) {
      console.error("Failed to delete pension share value:", error);
      res.status(500).json({ message: "Failed to delete share value" });
    }
  });

  // ==================== Plan Years Routes ====================

  app.get("/api/sitespecific/gbhet/pension/plan-years", requireAuth, requirePermission("staff"), componentMiddleware, async (req, res) => {
    try {
      const tableExists = await pensionStorage.planYears.tableExists();
      if (!tableExists) {
        return res.status(503).json({ 
          message: "GBHET Pension Plan Years table does not exist. Please enable the GBHET Pension component first." 
        });
      }
      const records = await pensionStorage.planYears.getAll();
      res.json(records);
    } catch (error) {
      console.error("Failed to fetch pension plan years:", error);
      res.status(500).json({ message: "Failed to fetch plan years" });
    }
  });

  app.get("/api/sitespecific/gbhet/pension/plan-years/year/:year", requireAuth, requirePermission("staff"), componentMiddleware, async (req, res) => {
    try {
      const tableExists = await pensionStorage.planYears.tableExists();
      if (!tableExists) {
        return res.status(503).json({ message: "GBHET Pension Plan Years table does not exist." });
      }
      const year = parseInt(req.params.year);
      const record = await pensionStorage.planYears.getByYear(year);
      if (!record) {
        return res.status(404).json({ message: "Plan year not found" });
      }
      res.json(record);
    } catch (error) {
      console.error("Failed to fetch pension plan year:", error);
      res.status(500).json({ message: "Failed to fetch plan year" });
    }
  });

  app.get("/api/sitespecific/gbhet/pension/plan-years/:id", requireAuth, requirePermission("staff"), componentMiddleware, async (req, res) => {
    try {
      const tableExists = await pensionStorage.planYears.tableExists();
      if (!tableExists) {
        return res.status(503).json({ message: "GBHET Pension Plan Years table does not exist." });
      }
      const record = await pensionStorage.planYears.get(req.params.id);
      if (!record) {
        return res.status(404).json({ message: "Plan year not found" });
      }
      res.json(record);
    } catch (error) {
      console.error("Failed to fetch pension plan year:", error);
      res.status(500).json({ message: "Failed to fetch plan year" });
    }
  });

  app.post("/api/sitespecific/gbhet/pension/plan-years", requireAuth, requirePermission("admin"), mutatingComponentMiddleware, async (req, res) => {
    try {
      const tableExists = await pensionStorage.planYears.tableExists();
      if (!tableExists) {
        return res.status(503).json({ message: "GBHET Pension Plan Years table does not exist." });
      }
      const parsed = insertGbhetPensionPlanYearSchema.parse(req.body);
      const record = await pensionStorage.planYears.create(parsed);
      res.status(201).json(record);
    } catch (error: any) {
      if (error.name === "ZodError") {
        return res.status(400).json({ message: "Invalid data", errors: error.errors });
      }
      if (error.code === "23505") {
        return res.status(409).json({ message: "A plan year configuration for this year already exists" });
      }
      console.error("Failed to create pension plan year:", error);
      res.status(500).json({ message: "Failed to create plan year" });
    }
  });

  app.patch("/api/sitespecific/gbhet/pension/plan-years/:id", requireAuth, requirePermission("admin"), mutatingComponentMiddleware, async (req, res) => {
    try {
      const tableExists = await pensionStorage.planYears.tableExists();
      if (!tableExists) {
        return res.status(503).json({ message: "GBHET Pension Plan Years table does not exist." });
      }
      const parsed = insertGbhetPensionPlanYearSchema.partial().parse(req.body);
      const record = await pensionStorage.planYears.update(req.params.id, parsed);
      if (!record) {
        return res.status(404).json({ message: "Plan year not found" });
      }
      res.json(record);
    } catch (error: any) {
      if (error.name === "ZodError") {
        return res.status(400).json({ message: "Invalid data", errors: error.errors });
      }
      if (error.code === "23505") {
        return res.status(409).json({ message: "A plan year configuration for this year already exists" });
      }
      console.error("Failed to update pension plan year:", error);
      res.status(500).json({ message: "Failed to update plan year" });
    }
  });

  app.delete("/api/sitespecific/gbhet/pension/plan-years/:id", requireAuth, requirePermission("admin"), mutatingComponentMiddleware, async (req, res) => {
    try {
      const tableExists = await pensionStorage.planYears.tableExists();
      if (!tableExists) {
        return res.status(503).json({ message: "GBHET Pension Plan Years table does not exist." });
      }
      const deleted = await pensionStorage.planYears.delete(req.params.id);
      if (!deleted) {
        return res.status(404).json({ message: "Plan year not found" });
      }
      res.status(204).send();
    } catch (error) {
      console.error("Failed to delete pension plan year:", error);
      res.status(500).json({ message: "Failed to delete plan year" });
    }
  });

  // ==================== Employer Plan Assignments Routes ====================

  app.get("/api/sitespecific/gbhet/pension/employer-plans", requireAuth, requirePermission("staff"), componentMiddleware, async (req, res) => {
    try {
      const tableExists = await pensionStorage.employerPlans.tableExists();
      if (!tableExists) {
        return res.status(503).json({ message: "GBHET Pension Employer Plans table does not exist." });
      }
      const records = await pensionStorage.employerPlans.getAll();
      res.json(records);
    } catch (error) {
      console.error("Failed to fetch pension employer plans:", error);
      res.status(500).json({ message: "Failed to fetch employer plans" });
    }
  });

  app.get("/api/sitespecific/gbhet/pension/employer-plans/:id", requireAuth, requirePermission("staff"), componentMiddleware, async (req, res) => {
    try {
      const tableExists = await pensionStorage.employerPlans.tableExists();
      if (!tableExists) {
        return res.status(503).json({ message: "GBHET Pension Employer Plans table does not exist." });
      }
      const record = await pensionStorage.employerPlans.get(req.params.id);
      if (!record) {
        return res.status(404).json({ message: "Employer plan not found" });
      }
      res.json(record);
    } catch (error) {
      console.error("Failed to fetch pension employer plan:", error);
      res.status(500).json({ message: "Failed to fetch employer plan" });
    }
  });

  app.post("/api/sitespecific/gbhet/pension/employer-plans", requireAuth, requirePermission("admin"), mutatingComponentMiddleware, async (req, res) => {
    try {
      const tableExists = await pensionStorage.employerPlans.tableExists();
      if (!tableExists) {
        return res.status(503).json({ message: "GBHET Pension Employer Plans table does not exist." });
      }
      const parsed = insertGbhetPensionEmployerPlanSchema.parse(req.body);
      const record = await pensionStorage.employerPlans.upsert(parsed);
      res.status(201).json(record);
    } catch (error: any) {
      if (error.name === "ZodError") {
        return res.status(400).json({ message: "Invalid data", errors: error.errors });
      }
      console.error("Failed to upsert pension employer plan:", error);
      res.status(500).json({ message: "Failed to save employer plan" });
    }
  });

  app.delete("/api/sitespecific/gbhet/pension/employer-plans/:id", requireAuth, requirePermission("admin"), mutatingComponentMiddleware, async (req, res) => {
    try {
      const tableExists = await pensionStorage.employerPlans.tableExists();
      if (!tableExists) {
        return res.status(503).json({ message: "GBHET Pension Employer Plans table does not exist." });
      }
      const deleted = await pensionStorage.employerPlans.delete(req.params.id);
      if (!deleted) {
        return res.status(404).json({ message: "Employer plan not found" });
      }
      res.status(204).send();
    } catch (error) {
      console.error("Failed to delete pension employer plan:", error);
      res.status(500).json({ message: "Failed to delete employer plan" });
    }
  });

  // ==================== SLA Computation Routes ====================

  app.get("/api/sitespecific/gbhet/pension/sla/config", requireAuth, requirePermission("admin"), componentMiddleware, async (req, res) => {
    try {
      const [outputVar, triggerVar] = await Promise.all([
        storage.variables.getByName(SLA_ACCOUNT_VARIABLE),
        storage.variables.getByName(SLA_TRIGGER_ACCOUNT_VARIABLE),
      ]);
      const accounts = await storage.ledger.accounts.getAll();
      res.json({
        accountId: outputVar?.value || null,
        triggerAccountId: triggerVar?.value || null,
        accounts: accounts.map(a => ({ id: a.id, name: a.name })),
      });
    } catch (error) {
      console.error("Failed to get SLA config:", error);
      res.status(500).json({ message: "Failed to get SLA config" });
    }
  });

  app.put("/api/sitespecific/gbhet/pension/sla/config", requireAuth, requirePermission("admin"), mutatingComponentMiddleware, async (req, res) => {
    try {
      const { accountId, triggerAccountId } = req.body;

      const upsertVariable = async (varName: string, value: string) => {
        const existing = await storage.variables.getByName(varName);
        if (existing) {
          await storage.variables.update(existing.id, { value });
        } else {
          await storage.variables.create({ name: varName, value });
        }
      }

      if (accountId) {
        const account = await storage.ledger.accounts.get(accountId);
        if (!account) {
          return res.status(400).json({ message: "Output ledger account not found" });
        }
        await upsertVariable(SLA_ACCOUNT_VARIABLE, accountId);
        clearAccountCache();
      }

      if (triggerAccountId) {
        const account = await storage.ledger.accounts.get(triggerAccountId);
        if (!account) {
          return res.status(400).json({ message: "Trigger ledger account not found" });
        }
        await upsertVariable(SLA_TRIGGER_ACCOUNT_VARIABLE, triggerAccountId);
      }

      res.json({ success: true });
    } catch (error) {
      console.error("Failed to save SLA config:", error);
      res.status(500).json({ message: "Failed to save SLA config" });
    }
  });

  app.get("/api/sitespecific/gbhet/pension/variable-contribution/config", requireAuth, requirePermission("admin"), componentMiddleware, async (req, res) => {
    try {
      const [sourceVar, targetVar] = await Promise.all([
        storage.variables.getByName(VAR_CONTRIB_SOURCE_ACCOUNT_VARIABLE),
        storage.variables.getByName(VAR_CONTRIB_TARGET_ACCOUNT_VARIABLE),
      ]);
      const accounts = await storage.ledger.accounts.getAll();
      res.json({
        sourceAccountId: sourceVar?.value || null,
        targetAccountId: targetVar?.value || null,
        accounts: accounts.map(a => ({ id: a.id, name: a.name })),
      });
    } catch (error) {
      console.error("Failed to get variable contribution config:", error);
      res.status(500).json({ message: "Failed to get variable contribution config" });
    }
  });

  app.put("/api/sitespecific/gbhet/pension/variable-contribution/config", requireAuth, requirePermission("admin"), mutatingComponentMiddleware, async (req, res) => {
    try {
      const { sourceAccountId, targetAccountId } = req.body;

      const upsertVariable = async (varName: string, value: string) => {
        const existing = await storage.variables.getByName(varName);
        if (existing) {
          await storage.variables.update(existing.id, { value });
        } else {
          await storage.variables.create({ name: varName, value });
        }
      };

      if (sourceAccountId) {
        const account = await storage.ledger.accounts.get(sourceAccountId);
        if (!account) {
          return res.status(400).json({ message: "Source ledger account not found" });
        }
        await upsertVariable(VAR_CONTRIB_SOURCE_ACCOUNT_VARIABLE, sourceAccountId);
      }

      if (targetAccountId) {
        const account = await storage.ledger.accounts.get(targetAccountId);
        if (!account) {
          return res.status(400).json({ message: "Target ledger account not found" });
        }
        await upsertVariable(VAR_CONTRIB_TARGET_ACCOUNT_VARIABLE, targetAccountId);
      }

      res.json({ success: true });
    } catch (error) {
      console.error("Failed to save variable contribution config:", error);
      res.status(500).json({ message: "Failed to save variable contribution config" });
    }
  });

  app.post("/api/sitespecific/gbhet/pension/sla/compute/worker/:workerId", requireAuth, requirePermission("admin"), mutatingComponentMiddleware, async (req, res) => {
    try {
      const { workerId } = req.params;
      const { configId } = req.body;
      const result = await computeSlaForWorker(workerId, configId || "manual");
      res.json(result);
    } catch (error) {
      console.error("Failed to compute SLA for worker:", error);
      const message = error instanceof Error ? error.message : "Failed to compute SLA";
      const status = error instanceof SlaConfigError ? 400 : 500;
      res.status(status).json({ message });
    }
  });

  app.post("/api/sitespecific/gbhet/pension/sla/compute/all", requireAuth, requirePermission("admin"), mutatingComponentMiddleware, async (req, res) => {
    try {
      const { configId } = req.body;
      const result = await computeSlaForAllWorkers(configId || "batch");
      res.json(result);
    } catch (error) {
      console.error("Failed to compute SLA for all workers:", error);
      const message = error instanceof Error ? error.message : "Failed to compute batch SLA";
      const status = error instanceof SlaConfigError ? 400 : 500;
      res.status(status).json({ message });
    }
  });

  app.get("/api/sitespecific/gbhet/pension/sla/worker/:workerId", requireAuth, requirePermission("staff"), componentMiddleware, async (req, res) => {
    try {
      const { workerId } = req.params;
      const allPlanYears = await pensionStorage.planYears.getAll();
      const tieredYears = allPlanYears.filter(py => py.accrualMethod === "tiered");
      const contribYears = allPlanYears.filter(py => py.accrualMethod === "contribution_pct");

      const worker = await storage.workers.getWorker(workerId);
      const homeEmployerId = worker?.denormHomeEmployerId;
      let workerPlan = "A";
      if (homeEmployerId) {
        const employerPlan = await pensionStorage.employerPlans.getByEmployerId(homeEmployerId);
        workerPlan = employerPlan?.plan || "A";
      }

      interface WorkerSlaYearSummary {
        year: number;
        accrualMethod: "tiered" | "contribution_pct";
        totalHours: number;
        accrualPct?: number;
        benefitRate?: number;
        contributionPct?: number;
        contributionTotal?: string;
        contributionEntryCount?: number;
        sharesEarned: string;
        sharesEntryCount: number;
        shareValue: number | null;
        plan: string;
        amount: string;
        qualified: boolean;
        qualificationThresholdHours: number;
        tierId?: string | null;
        tierMinHours?: number | null;
      }
      const summaries: WorkerSlaYearSummary[] = [];

      const outputAccountVar = await storage.variables.getByName("gbhet_pension_sla_account_id");
      const outputAccountId = outputAccountVar?.value as string | null;

      const varContribTargetVar = await storage.variables.getByName(VAR_CONTRIB_TARGET_ACCOUNT_VARIABLE);
      const varContribTargetId = varContribTargetVar?.value
        ? (typeof varContribTargetVar.value === "string" ? varContribTargetVar.value.replace(/^"|"$/g, "") : null)
        : null;

      let sharesByYear = new Map<number, { totalShares: number; entryCount: number }>();
      if (varContribTargetId) {
        const sharesEa = await storage.ledger.ea.getByEntityAndAccount("worker", workerId, varContribTargetId);
        if (sharesEa) {
          const sharesEntries = await storage.ledger.entries.getByEaId(sharesEa.id);
          const varContribEntries = sharesEntries.filter(e => e.chargePlugin === "gbhet-pension-variable-contribution");
          for (const entry of varContribEntries) {
            const entryDate = entry.date ? new Date(entry.date) : null;
            if (!entryDate) continue;
            const year = entryDate.getFullYear();
            const existing = sharesByYear.get(year) || { totalShares: 0, entryCount: 0 };
            existing.totalShares += parseFloat(entry.amount);
            existing.entryCount++;
            sharesByYear.set(year, existing);
          }
        }
      }

      for (const planYear of tieredYears) {
        const totalHours = await storage.workerHours.getWorkerYearlyHoursTotal(workerId, planYear.year);
        const tiers = await pensionStorage.accrualTiers.getEffectiveTiersForYear(planYear.year);

        let matchingTier = null;
        let accrualPct = 0;
        const sortedTiers = [...tiers].sort((a, b) => parseFloat(b.minHours) - parseFloat(a.minHours));
        for (const tier of sortedTiers) {
          if (totalHours >= parseFloat(tier.minHours)) {
            matchingTier = tier;
            accrualPct = parseFloat(tier.accrualPct);
            break;
          }
        }

        const benefitSchedule = await pensionStorage.benefitSchedules.getByYearAndPlan(planYear.year, workerPlan);
        const benefitRate = benefitSchedule ? parseFloat(benefitSchedule.monthlyBenefitRate) : 0;
        const qualThreshold = parseFloat(planYear.qualificationThresholdHours) || 500;
        const amount = (benefitRate * (accrualPct / 100)).toFixed(2);

        const sharesData = sharesByYear.get(planYear.year);
        summaries.push({
          year: planYear.year,
          accrualMethod: "tiered",
          totalHours,
          accrualPct,
          benefitRate,
          plan: workerPlan,
          amount,
          qualified: totalHours >= qualThreshold,
          qualificationThresholdHours: qualThreshold,
          tierId: matchingTier?.id || null,
          tierMinHours: matchingTier ? parseFloat(matchingTier.minHours) : null,
          sharesEarned: sharesData ? sharesData.totalShares.toFixed(6) : "0.000000",
          sharesEntryCount: sharesData?.entryCount || 0,
          shareValue: planYear.shareValue ? parseFloat(planYear.shareValue) : null,
        });
      }

      if (contribYears.length > 0) {
        let contribByYear = new Map<number, { totalAmount: number; entryCount: number }>();

        if (outputAccountId) {
          const cleanAccountId = typeof outputAccountId === "string" ? outputAccountId.replace(/^"|"$/g, "") : outputAccountId;
          const workerEa = await storage.ledger.ea.getByEntityAndAccount("worker", workerId, cleanAccountId);

          if (workerEa) {
            const allEntries = await storage.ledger.entries.getByEaId(workerEa.id);
            const contribEntries = allEntries.filter(e => e.chargePlugin === "gbhet-pension-sla-contribution");
            for (const entry of contribEntries) {
              const entryDate = entry.date ? new Date(entry.date) : null;
              if (!entryDate) continue;
              const year = entryDate.getFullYear();
              const existing = contribByYear.get(year) || { totalAmount: 0, entryCount: 0 };
              existing.totalAmount += parseFloat(entry.amount);
              existing.entryCount++;
              contribByYear.set(year, existing);
            }
          }
        }

        for (const planYear of contribYears) {
          const totalHours = await storage.workerHours.getWorkerYearlyHoursTotal(workerId, planYear.year);
          const qualThreshold = parseFloat(planYear.qualificationThresholdHours) || 500;
          const contribPct = planYear.contributionPct ? parseFloat(planYear.contributionPct) : 0;
          const yearData = contribByYear.get(planYear.year);
          const sharesData = sharesByYear.get(planYear.year);

          summaries.push({
            year: planYear.year,
            accrualMethod: "contribution_pct",
            totalHours,
            contributionPct: contribPct,
            contributionTotal: yearData ? yearData.totalAmount.toFixed(2) : "0.00",
            contributionEntryCount: yearData?.entryCount || 0,
            sharesEarned: sharesData ? sharesData.totalShares.toFixed(6) : "0.000000",
            sharesEntryCount: sharesData?.entryCount || 0,
            shareValue: planYear.shareValue ? parseFloat(planYear.shareValue) : null,
            plan: workerPlan,
            amount: yearData ? yearData.totalAmount.toFixed(2) : "0.00",
            qualified: totalHours >= qualThreshold,
            qualificationThresholdHours: qualThreshold,
          });
        }
      }

      summaries.sort((a, b) => b.year - a.year);
      res.json(summaries);
    } catch (error) {
      console.error("Failed to get worker SLA summary:", error);
      res.status(500).json({ message: "Failed to get worker pension summary" });
    }
  });

  // ==================== Actuarial Factor Tables Routes ====================

  const TABLE_NOT_EXIST_MSG = "GBHET Pension factor tables do not exist. Please ensure the pension component is enabled and tables are provisioned.";

  const checkFactorTables = async () => {
    return await pensionStorage.aiFactors.tableExists();
  };

  app.get("/api/sitespecific/gbhet/pension/factors/ai", requireAuth, requirePermission("admin"), componentMiddleware, async (_req, res) => {
    try {
      if (!(await checkFactorTables())) return res.status(503).json({ message: TABLE_NOT_EXIST_MSG });
      const records = await pensionStorage.aiFactors.getAll();
      res.json(records);
    } catch (error) {
      console.error("Failed to fetch AI factors:", error);
      res.status(500).json({ message: "Failed to fetch AI factors" });
    }
  });

  app.post("/api/sitespecific/gbhet/pension/factors/ai/import", requireAuth, requirePermission("admin"), mutatingComponentMiddleware, async (req, res) => {
    try {
      if (!(await checkFactorTables())) return res.status(503).json({ message: TABLE_NOT_EXIST_MSG });
      const { rows, clearExisting } = req.body;
      if (!Array.isArray(rows) || rows.length === 0) {
        return res.status(400).json({ message: "rows must be a non-empty array" });
      }
      if (clearExisting) {
        await pensionStorage.aiFactors.deleteAll();
      }
      let imported = 0;
      const errors: { row: number; message: string }[] = [];
      for (let i = 0; i < rows.length; i++) {
        try {
          const parsed = insertGbhetPensionAiFactorSchema.parse(rows[i]);
          await pensionStorage.aiFactors.upsert(parsed);
          imported++;
        } catch (err: any) {
          errors.push({ row: i + 1, message: err.message || "Validation failed" });
        }
      }
      res.json({ imported, errors: errors.length > 0 ? errors : undefined, total: rows.length });
    } catch (error) {
      console.error("Failed to import AI factors:", error);
      res.status(500).json({ message: "Failed to import AI factors" });
    }
  });

  app.delete("/api/sitespecific/gbhet/pension/factors/ai/:id", requireAuth, requirePermission("admin"), mutatingComponentMiddleware, async (req, res) => {
    try {
      if (!(await checkFactorTables())) return res.status(503).json({ message: TABLE_NOT_EXIST_MSG });
      const deleted = await pensionStorage.aiFactors.delete(req.params.id);
      if (!deleted) return res.status(404).json({ message: "AI factor not found" });
      res.status(204).send();
    } catch (error) {
      console.error("Failed to delete AI factor:", error);
      res.status(500).json({ message: "Failed to delete AI factor" });
    }
  });

  app.get("/api/sitespecific/gbhet/pension/factors/payout", requireAuth, requirePermission("admin"), componentMiddleware, async (req, res) => {
    try {
      if (!(await checkFactorTables())) return res.status(503).json({ message: TABLE_NOT_EXIST_MSG });
      const { electionType, factorYear } = req.query;
      if (electionType && typeof electionType === "string") {
        if (factorYear && !isNaN(Number(factorYear))) {
          const records = await pensionStorage.payoutFactors.getByElectionTypeAndYear(electionType, Number(factorYear));
          return res.json(records);
        }
        const records = await pensionStorage.payoutFactors.getByElectionType(electionType);
        return res.json(records);
      }
      const records = await pensionStorage.payoutFactors.getAll();
      res.json(records);
    } catch (error) {
      console.error("Failed to fetch payout factors:", error);
      res.status(500).json({ message: "Failed to fetch payout factors" });
    }
  });

  app.post("/api/sitespecific/gbhet/pension/factors/payout/import", requireAuth, requirePermission("admin"), mutatingComponentMiddleware, async (req, res) => {
    try {
      if (!(await checkFactorTables())) return res.status(503).json({ message: TABLE_NOT_EXIST_MSG });
      const { rows, electionType, factorYear, clearExisting } = req.body;
      if (!Array.isArray(rows) || rows.length === 0) {
        return res.status(400).json({ message: "rows must be a non-empty array" });
      }
      if (!electionType || typeof electionType !== "string") {
        return res.status(400).json({ message: "electionType is required for payout factor import" });
      }
      const isYearBased = electionType === "lump" || electionType === "lumpearly";
      if (isYearBased && (factorYear == null || isNaN(Number(factorYear)))) {
        return res.status(400).json({ message: "factorYear is required for lump sum and lump sum early factor imports" });
      }
      if (clearExisting) {
        if (isYearBased && factorYear != null) {
          await pensionStorage.payoutFactors.deleteByElectionTypeAndYear(electionType, Number(factorYear));
        } else {
          await pensionStorage.payoutFactors.deleteByElectionType(electionType);
        }
      }
      let imported = 0;
      const errors: { row: number; message: string }[] = [];
      for (let i = 0; i < rows.length; i++) {
        try {
          const rowWithType = { ...rows[i], electionType, factorYear: isYearBased ? Number(factorYear) : 0 };
          const parsed = insertGbhetPensionPayoutFactorSchema.parse(rowWithType);
          await pensionStorage.payoutFactors.upsert(parsed);
          imported++;
        } catch (err: any) {
          errors.push({ row: i + 1, message: err.message || "Validation failed" });
        }
      }
      res.json({ imported, errors: errors.length > 0 ? errors : undefined, total: rows.length });
    } catch (error) {
      console.error("Failed to import payout factors:", error);
      res.status(500).json({ message: "Failed to import payout factors" });
    }
  });

  const VALID_ELECTION_TYPES = ["life", "5cc", "lump", "lumpearly", "50js", "75js", "100js"];
  const ELECTION_TYPE_ALIASES: Record<string, string> = {
    "life": "life", "lifeannuity": "life", "life annuity": "life",
    "lump": "lump", "lumpsum": "lump", "lump sum": "lump",
    "lumpearly": "lumpearly", "lumpsumearly": "lumpearly", "lump sum early": "lumpearly", "lump sum (early)": "lumpearly",
    "5cc": "5cc", "5-year certain & continuous": "5cc", "5yearcc": "5cc", "5 year cc": "5cc",
    "50js": "50js", "50% joint & survivor": "50js", "50joint": "50js",
    "75js": "75js", "75% joint & survivor": "75js", "75joint": "75js",
    "100js": "100js", "100% joint & survivor": "100js", "100joint": "100js",
  };

  function resolveElectionType(raw: string): string | null {
    const normalized = raw.trim().toLowerCase();
    if (VALID_ELECTION_TYPES.includes(normalized)) return normalized;
    return ELECTION_TYPE_ALIASES[normalized] || null;
  }

  app.post("/api/sitespecific/gbhet/pension/factors/payout/bulk-import", requireAuth, requirePermission("admin"), mutatingComponentMiddleware, async (req, res) => {
    try {
      if (!(await checkFactorTables())) return res.status(503).json({ message: TABLE_NOT_EXIST_MSG });
      const { rows, clearExisting } = req.body;
      if (!Array.isArray(rows) || rows.length === 0) {
        return res.status(400).json({ message: "rows must be a non-empty array" });
      }

      const typesInImport = new Set<string>();
      const yearTypesInImport = new Map<string, Set<number>>();

      for (const row of rows) {
        if (row.electionType) {
          const resolved = resolveElectionType(row.electionType);
          if (resolved) {
            typesInImport.add(resolved);
            if ((resolved === "lump" || resolved === "lumpearly") && row.factorYear) {
              if (!yearTypesInImport.has(resolved)) yearTypesInImport.set(resolved, new Set());
              yearTypesInImport.get(resolved)!.add(Number(row.factorYear));
            }
          }
        }
      }

      if (clearExisting) {
        for (const type of Array.from(typesInImport)) {
          if (type === "lump" || type === "lumpearly") {
            const years = yearTypesInImport.get(type);
            if (years && years.size > 0) {
              for (const year of Array.from(years)) {
                await pensionStorage.payoutFactors.deleteByElectionTypeAndYear(type, year);
              }
            }
          } else {
            await pensionStorage.payoutFactors.deleteByElectionType(type);
          }
        }
      }

      let imported = 0;
      const errors: { row: number; message: string }[] = [];
      for (let i = 0; i < rows.length; i++) {
        try {
          const row = rows[i];
          const resolvedType = resolveElectionType(row.electionType || "");
          if (!resolvedType) {
            errors.push({ row: i + 1, message: `Unknown election type: "${row.electionType}"` });
            continue;
          }
          const isYearType = resolvedType === "lump" || resolvedType === "lumpearly";
          let factorYear = 0;
          if (isYearType) {
            factorYear = row.factorYear ? Number(row.factorYear) : 0;
            if (!factorYear || isNaN(factorYear)) {
              errors.push({ row: i + 1, message: `factorYear required for ${resolvedType} (include year as 4th column)` });
              continue;
            }
          }
          const record = {
            electionType: resolvedType,
            subscriberAge: Number(row.subscriberAge),
            beneficiaryAge: row.beneficiaryAge != null && row.beneficiaryAge !== "" ? Number(row.beneficiaryAge) : null,
            factorYear,
            factor: String(row.factor),
          };
          const parsed = insertGbhetPensionPayoutFactorSchema.parse(record);
          await pensionStorage.payoutFactors.upsert(parsed);
          imported++;
        } catch (err: any) {
          errors.push({ row: i + 1, message: err.message || "Validation failed" });
        }
      }
      res.json({ imported, errors: errors.length > 0 ? errors : undefined, total: rows.length });
    } catch (error) {
      console.error("Failed to bulk import payout factors:", error);
      res.status(500).json({ message: "Failed to bulk import payout factors" });
    }
  });

  app.delete("/api/sitespecific/gbhet/pension/factors/payout/:id", requireAuth, requirePermission("admin"), mutatingComponentMiddleware, async (req, res) => {
    try {
      if (!(await checkFactorTables())) return res.status(503).json({ message: TABLE_NOT_EXIST_MSG });
      const deleted = await pensionStorage.payoutFactors.delete(req.params.id);
      if (!deleted) return res.status(404).json({ message: "Payout factor not found" });
      res.status(204).send();
    } catch (error) {
      console.error("Failed to delete payout factor:", error);
      res.status(500).json({ message: "Failed to delete payout factor" });
    }
  });

  app.get("/api/sitespecific/gbhet/pension/factors/early-retirement", requireAuth, requirePermission("admin"), componentMiddleware, async (_req, res) => {
    try {
      if (!(await checkFactorTables())) return res.status(503).json({ message: TABLE_NOT_EXIST_MSG });
      const records = await pensionStorage.earlyRetirementFactors.getAll();
      res.json(records);
    } catch (error) {
      console.error("Failed to fetch early retirement factors:", error);
      res.status(500).json({ message: "Failed to fetch early retirement factors" });
    }
  });

  app.post("/api/sitespecific/gbhet/pension/factors/early-retirement/import", requireAuth, requirePermission("admin"), mutatingComponentMiddleware, async (req, res) => {
    try {
      if (!(await checkFactorTables())) return res.status(503).json({ message: TABLE_NOT_EXIST_MSG });
      const { rows, clearExisting } = req.body;
      if (!Array.isArray(rows) || rows.length === 0) {
        return res.status(400).json({ message: "rows must be a non-empty array" });
      }
      if (clearExisting) {
        await pensionStorage.earlyRetirementFactors.deleteAll();
      }
      let imported = 0;
      const errors: { row: number; message: string }[] = [];
      for (let i = 0; i < rows.length; i++) {
        try {
          const parsed = insertGbhetPensionEarlyRetirementFactorSchema.parse(rows[i]);
          await pensionStorage.earlyRetirementFactors.upsert(parsed);
          imported++;
        } catch (err: any) {
          errors.push({ row: i + 1, message: err.message || "Validation failed" });
        }
      }
      res.json({ imported, errors: errors.length > 0 ? errors : undefined, total: rows.length });
    } catch (error) {
      console.error("Failed to import early retirement factors:", error);
      res.status(500).json({ message: "Failed to import early retirement factors" });
    }
  });

  app.delete("/api/sitespecific/gbhet/pension/factors/early-retirement/:id", requireAuth, requirePermission("admin"), mutatingComponentMiddleware, async (req, res) => {
    try {
      if (!(await checkFactorTables())) return res.status(503).json({ message: TABLE_NOT_EXIST_MSG });
      const deleted = await pensionStorage.earlyRetirementFactors.delete(req.params.id);
      if (!deleted) return res.status(404).json({ message: "Early retirement factor not found" });
      res.status(204).send();
    } catch (error) {
      console.error("Failed to delete early retirement factor:", error);
      res.status(500).json({ message: "Failed to delete early retirement factor" });
    }
  });

  app.get("/api/sitespecific/gbhet/pension/factors/interest-rates", requireAuth, requirePermission("admin"), componentMiddleware, async (_req, res) => {
    try {
      if (!(await checkFactorTables())) return res.status(503).json({ message: TABLE_NOT_EXIST_MSG });
      const records = await pensionStorage.interestRates.getAll();
      res.json(records);
    } catch (error) {
      console.error("Failed to fetch interest rates:", error);
      res.status(500).json({ message: "Failed to fetch interest rates" });
    }
  });

  app.post("/api/sitespecific/gbhet/pension/factors/interest-rates/import", requireAuth, requirePermission("admin"), mutatingComponentMiddleware, async (req, res) => {
    try {
      if (!(await checkFactorTables())) return res.status(503).json({ message: TABLE_NOT_EXIST_MSG });
      const { rows, clearExisting } = req.body;
      if (!Array.isArray(rows) || rows.length === 0) {
        return res.status(400).json({ message: "rows must be a non-empty array" });
      }
      if (clearExisting) {
        await pensionStorage.interestRates.deleteAll();
      }
      let imported = 0;
      const errors: { row: number; message: string }[] = [];
      for (let i = 0; i < rows.length; i++) {
        try {
          const parsed = insertGbhetPensionInterestRateSchema.parse(rows[i]);
          await pensionStorage.interestRates.upsert(parsed);
          imported++;
        } catch (err: any) {
          errors.push({ row: i + 1, message: err.message || "Validation failed" });
        }
      }
      res.json({ imported, errors: errors.length > 0 ? errors : undefined, total: rows.length });
    } catch (error) {
      console.error("Failed to import interest rates:", error);
      res.status(500).json({ message: "Failed to import interest rates" });
    }
  });

  app.delete("/api/sitespecific/gbhet/pension/factors/interest-rates/:id", requireAuth, requirePermission("admin"), mutatingComponentMiddleware, async (req, res) => {
    try {
      if (!(await checkFactorTables())) return res.status(503).json({ message: TABLE_NOT_EXIST_MSG });
      const deleted = await pensionStorage.interestRates.delete(req.params.id);
      if (!deleted) return res.status(404).json({ message: "Interest rate not found" });
      res.status(204).send();
    } catch (error) {
      console.error("Failed to delete interest rate:", error);
      res.status(500).json({ message: "Failed to delete interest rate" });
    }
  });

  app.get("/api/sitespecific/gbhet/pension/factors/summary", requireAuth, requirePermission("admin"), componentMiddleware, async (_req, res) => {
    try {
      if (!(await checkFactorTables())) return res.status(503).json({ message: TABLE_NOT_EXIST_MSG });
      const [aiFactors, payoutFactors, earlyRetFactors, intRates] = await Promise.all([
        pensionStorage.aiFactors.getAll(),
        pensionStorage.payoutFactors.getAll(),
        pensionStorage.earlyRetirementFactors.getAll(),
        pensionStorage.interestRates.getAll(),
      ]);

      const payoutByType: Record<string, number> = {};
      for (const f of payoutFactors) {
        payoutByType[f.electionType] = (payoutByType[f.electionType] || 0) + 1;
      }

      res.json({
        aiFactors: { count: aiFactors.length },
        payoutFactors: { count: payoutFactors.length, byType: payoutByType },
        earlyRetirementFactors: { count: earlyRetFactors.length },
        interestRates: { count: intRates.length },
      });
    } catch (error) {
      console.error("Failed to fetch factors summary:", error);
      res.status(500).json({ message: "Failed to fetch factors summary" });
    }
  });

  // ==================== Payout Calculator Routes ====================

  app.get("/api/sitespecific/gbhet/pension/payout-calculator/worker/:workerId/summary", requireAuth, requirePermission("staff"), componentMiddleware, async (req, res) => {
    try {
      const summary = await getWorkerPensionSummary(req.params.workerId);
      res.json(summary);
    } catch (error: any) {
      console.error("Failed to fetch worker pension summary:", error);
      res.status(error.message === "Worker not found" ? 404 : 500).json({ message: error.message || "Failed to fetch worker pension summary" });
    }
  });

  app.post("/api/sitespecific/gbhet/pension/payout-calculator/compute", requireAuth, requirePermission("staff"), componentMiddleware, async (req, res) => {
    try {
      const { workerId, dobc, electionType, beneficiaryAge, earlyRetirementReason, factorYear, normalRetirementAge } = req.body;
      if (!workerId || !dobc || !electionType) {
        return res.status(400).json({ message: "workerId, dobc, and electionType are required" });
      }
      const validTypes = ["life", "5cc", "lump", "lumpearly", "50js", "75js", "100js"];
      if (!validTypes.includes(electionType)) {
        return res.status(400).json({ message: `Invalid election type. Must be one of: ${validTypes.join(", ")}` });
      }
      const jsTypes = ["50js", "75js", "100js"];
      if (jsTypes.includes(electionType) && (beneficiaryAge == null || isNaN(Number(beneficiaryAge)))) {
        return res.status(400).json({ message: "beneficiaryAge is required for Joint & Survivor election types" });
      }
      if (beneficiaryAge != null && isNaN(Number(beneficiaryAge))) {
        return res.status(400).json({ message: "beneficiaryAge must be a valid number" });
      }
      if (factorYear != null && isNaN(Number(factorYear))) {
        return res.status(400).json({ message: "factorYear must be a valid number" });
      }
      const result = await computePayout({
        workerId,
        dobc,
        electionType,
        beneficiaryAge: beneficiaryAge != null ? Number(beneficiaryAge) : null,
        earlyRetirementReason: earlyRetirementReason || null,
        factorYear: factorYear != null ? Number(factorYear) : null,
        normalRetirementAge: normalRetirementAge ? Number(normalRetirementAge) : undefined,
      });
      res.json(result);
    } catch (error: any) {
      console.error("Payout calculation failed:", error);
      const status = error.message?.includes("not found") || error.message?.includes("does not have") ? 400 : 500;
      res.status(status).json({ message: error.message || "Payout calculation failed" });
    }
  });

  app.post("/api/sitespecific/gbhet/pension/payout-calculator/compute-all", requireAuth, requirePermission("staff"), componentMiddleware, async (req, res) => {
    try {
      const { workerId, dobc, dot, paymentDate, earlyRetirementReason, factorYear, spouseDob } = req.body;
      if (!workerId || !dobc) {
        return res.status(400).json({ message: "workerId and dobc are required" });
      }
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      if (!dateRegex.test(dobc) || isNaN(new Date(dobc).getTime())) {
        return res.status(400).json({ message: "dobc must be a valid date in YYYY-MM-DD format" });
      }
      if (dot && (!dateRegex.test(dot) || isNaN(new Date(dot).getTime()))) {
        return res.status(400).json({ message: "dot must be a valid date in YYYY-MM-DD format" });
      }
      if (paymentDate && (!dateRegex.test(paymentDate) || isNaN(new Date(paymentDate).getTime()))) {
        return res.status(400).json({ message: "paymentDate must be a valid date in YYYY-MM-DD format" });
      }
      if (spouseDob && (!dateRegex.test(spouseDob) || isNaN(new Date(spouseDob).getTime()))) {
        return res.status(400).json({ message: "spouseDob must be a valid date in YYYY-MM-DD format" });
      }
      if (factorYear != null && isNaN(Number(factorYear))) {
        return res.status(400).json({ message: "factorYear must be a valid number" });
      }
      const result = await computeAllPayouts({
        workerId,
        dobc,
        dot: dot || null,
        paymentDate: paymentDate || null,
        earlyRetirementReason: earlyRetirementReason || null,
        factorYear: factorYear != null ? Number(factorYear) : null,
        spouseDob: spouseDob || null,
      });
      res.json(result);
    } catch (error: any) {
      console.error("Payout calculation (all types) failed:", error);
      const status = error.message?.includes("not found") || error.message?.includes("does not have") ? 400 : 500;
      res.status(status).json({ message: error.message || "Payout calculation failed" });
    }
  });
}
