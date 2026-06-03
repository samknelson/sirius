import type { Express, Request, Response, NextFunction } from "express";
import { requireComponent, isComponentEnabled } from "../../components";
import { getEffectiveUser } from "../../masquerade";
import { storage } from "../../../storage";
import { createUnifiedOptionsStorage } from "../../../storage/unified-options";
import { fetchBuildupStatus } from "../../../plugins/trust/eligibility/plugins/sitespecific-bao-buildup";
import { computeEchpHoursPrice } from "./echp-pricing";

type AuthMiddleware = (req: Request, res: Response, next: NextFunction) => void | Promise<any>;
type PermissionMiddleware = (permissionKey: string) => (req: Request, res: Response, next: NextFunction) => void | Promise<any>;
type AccessMiddleware = (
  policyId: string,
  getEntityId?: (req: Request) => string | undefined | Promise<string | undefined>,
) => (req: Request, res: Response, next: NextFunction) => void | Promise<any>;

const ECHP_EMPLOYER_SIRIUS_ID = "ECHP";
const TERMINATED_CODE = "TERMINATED";
const ECHP_CODE = "ECHP";
const CUTOFF_DAY = 15;
const MAX_PURCHASABLE_MONTHS_PER_YEAR = 6;

const optionsStorage = createUnifiedOptionsStorage();

interface AsOf {
  year: number;
  month: number;
  day: number;
}

/** Data needed to execute the purchase write once a worker is permitted. */
interface EchpPermittedContext {
  echpEmployerId: string;
  echpStatusId: string;
  targetYear: number;
  targetMonth: number;
  hoursWorked: number;
  threshold: number;
  hoursToPurchase: number;
  price: number;
}

interface EchpEvalResult {
  eligible: boolean;
  code: string;
  message: string;
  /** Extra fields surfaced in the JSON response (e.g. target, price). */
  extra: Record<string, unknown>;
  /** Present only when eligible (`permitted`); drives the purchase write. */
  context?: EchpPermittedContext;
}

/**
 * Resolve the effective ("as of") date. Defaults to today. A debug + admin user
 * may override it via ?asOf=YYYY-MM-DD; the override is ignored for everyone else.
 */
async function resolveAsOf(req: Request): Promise<{ asOf: AsOf; asOfApplied: boolean }> {
  const now = new Date();
  let year = now.getFullYear();
  let month = now.getMonth() + 1;
  let day = now.getDate();
  let asOfApplied = false;

  const asOfRaw = typeof req.query.asOf === "string" ? req.query.asOf : undefined;
  if (asOfRaw) {
    const parsed = /^(\d{4})-(\d{2})-(\d{2})$/.exec(asOfRaw);
    const parsedMonth = parsed ? parseInt(parsed[2], 10) : 0;
    const parsedDay = parsed ? parseInt(parsed[3], 10) : 0;
    if (parsed && parsedMonth >= 1 && parsedMonth <= 12 && parsedDay >= 1 && parsedDay <= 31) {
      const debugEnabled = await isComponentEnabled("debug");
      let isAdmin = false;
      if (debugEnabled) {
        const session = req.session as any;
        const user = req.user as any;
        const { dbUser } = await getEffectiveUser(session, user);
        if (dbUser) {
          isAdmin = await storage.users.userHasPermission(dbUser.id, "admin");
        }
      }
      if (debugEnabled && isAdmin) {
        year = parseInt(parsed[1], 10);
        month = parseInt(parsed[2], 10);
        day = parseInt(parsed[3], 10);
        asOfApplied = true;
      }
    }
  }

  return { asOf: { year, month, day }, asOfApplied };
}

/**
 * Event Center Hours Purchase (ECHP) eligibility evaluation.
 *
 * Runs an ordered series of checks and reports the first failure, or that hours
 * purchasing is permitted. This is the single source of truth for eligibility:
 * both the GET (eligibility) and the POST (purchase) endpoints call it, so the
 * write endpoint can never trust the client and always re-runs the full check.
 *
 * All DB access goes through the storage layer; this function builds no queries.
 */
async function evaluateEchpEligibility(workerId: string, asOf: AsOf): Promise<EchpEvalResult> {
  const { year, month, day } = asOf;

  const fail = (
    code: string,
    message: string,
    extra: Record<string, unknown> = {},
  ): EchpEvalResult => ({ eligible: false, code, message, extra });

  // 1. Online purchasing closes after the cutoff day of the month.
  if (day > CUTOFF_DAY) {
    return fail(
      "window_closed",
      "Online purchasing for this month is closed. Please contact the office for assistance.",
    );
  }

  // 2. The worker must have an active election with a policy and an employer.
  const election = await storage.workerTrustElections.getActiveViewByWorker(workerId);
  if (!election || !election.policyId || !election.employerId) {
    return fail(
      "no_active_election",
      "You do not have an active election with a policy and employer, so hours purchasing is unavailable.",
    );
  }

  // 3. The ECHP employer must be configured.
  const echpEmployer = await storage.employers.getBySiriusId(ECHP_EMPLOYER_SIRIUS_ID);
  if (!echpEmployer) {
    return fail(
      "config_no_echp_employer",
      "Event Center Hours Purchasing is not configured. Please contact an administrator.",
    );
  }

  // 4 & 5. The TERMINATED and ECHP employment-status options must exist.
  const statuses = await optionsStorage.list("employment-status");
  const terminatedStatus = statuses.find((s: any) => s.code === TERMINATED_CODE);
  const echpStatus = statuses.find((s: any) => s.code === ECHP_CODE);
  if (!terminatedStatus) {
    return fail(
      "config_no_terminated_status",
      "Event Center Hours Purchasing is not configured (missing Terminated status). Please contact an administrator.",
    );
  }
  if (!echpStatus) {
    return fail(
      "config_no_echp_status",
      "Event Center Hours Purchasing is not configured (missing Event Center status). Please contact an administrator.",
    );
  }

  // 6. The worker's most recent hours entry at the election's employer must not
  //    be of TERMINATED type.
  const current = await storage.workerHours.getWorkerHoursCurrent(workerId);
  const atEmployer = current.find((r: any) => r.employerId === election.employerId);
  if (atEmployer && atEmployer.employmentStatusId === terminatedStatus.id) {
    return fail(
      "terminated",
      "You have been marked as Terminated, which means you are ineligible for the Hours Buy-Up program. If you wish to maintain coverage, you may be eligible to make a COBRA election",
    );
  }

  // 7. Buildup must be complete.
  const buildup = await fetchBuildupStatus(
    workerId,
    { year, month },
    { employerId: election.employerId },
  );
  if (!buildup.success) {
    return fail("buildup_incomplete", "Buildup is not complete.");
  }

  // 8. The worker must be on a break.
  if (!buildup.currentBreakFirstYear || !buildup.currentBreakFirstMonth) {
    return fail("no_break", "There are no break months that need purchasing.");
  }

  // 9. The break must start exactly three months prior to the effective month.
  const targetYear = buildup.currentBreakFirstYear;
  const targetMonth = buildup.currentBreakFirstMonth;
  if (
    targetYear !== buildup.threemonthsprevYear ||
    targetMonth !== buildup.threemonthsprevMonth
  ) {
    return fail(
      "retroactive",
      `Retroactive coverage cannot be purchased online. Please contact an administrator to update prior months. (Hours needed for ${targetMonth}/${targetYear})`,
      { target: { year: targetYear, month: targetMonth } },
    );
  }

  // 10. Fewer than six nonzero ECHP-type entries may exist in the targeted year.
  const allHours = await storage.workerHours.getWorkerHours(workerId);
  const echpCount = allHours.filter(
    (r: any) =>
      Number(r.year) === targetYear &&
      r.employmentStatusId === echpStatus.id &&
      Number(r.hours) > 0,
  ).length;
  if (echpCount >= MAX_PURCHASABLE_MONTHS_PER_YEAR) {
    return fail(
      "limit_reached",
      `The maximum number of purchasable months for ${targetYear} has already been reached.`,
      { count: echpCount },
    );
  }

  // 11. All checks passed. Derive the purchase figures from the buildup result
  //     already computed above (no extra queries). The price is based on hours
  //     WORKED in the targeted month, not on how many hours are bought.
  const threshold = buildup.threshold;
  const hoursWorked = buildup.currentBreakFirstHrs;
  const hoursToPurchase = Math.max(0, threshold - hoursWorked);
  const price = computeEchpHoursPrice(hoursWorked);

  return {
    eligible: true,
    code: "permitted",
    message: "hours purchasing is permitted.",
    extra: {
      target: { year: targetYear, month: targetMonth },
      hoursWorked,
      threshold,
      hoursToPurchase,
      price,
    },
    context: {
      echpEmployerId: echpEmployer.id,
      echpStatusId: echpStatus.id,
      targetYear,
      targetMonth,
      hoursWorked,
      threshold,
      hoursToPurchase,
      price,
    },
  };
}

/**
 * Event Center Hours Purchase (ECHP) routes.
 *
 * - GET …/eligibility evaluates eligibility (and, when permitted, the hours to
 *   purchase and the price). It creates no charge and writes nothing.
 * - POST …/purchase re-runs eligibility server-side and, only when permitted,
 *   records a single ECHP-type hours entry for the targeted month. No payment is
 *   taken in-app; any actual charge happens later via the charge-plugin flow.
 */
export function registerBaoEchpRoutes(
  app: Express,
  requireAuth: AuthMiddleware,
  _requirePermission: PermissionMiddleware,
  requireAccess: AccessMiddleware,
) {
  const componentMiddleware = requireComponent("sitespecific.bao");

  const workerIdParam = (req: Request): string | undefined => req.params.workerId;

  app.get(
    "/api/sitespecific/bao/echp/worker/:workerId/eligibility",
    requireAuth,
    componentMiddleware,
    requireAccess("worker.mine", workerIdParam),
    async (req, res) => {
      try {
        const workerId = req.params.workerId;
        const { asOf, asOfApplied } = await resolveAsOf(req);
        const result = await evaluateEchpEligibility(workerId, asOf);
        return res.json({
          eligible: result.eligible,
          code: result.code,
          message: result.message,
          asOf,
          asOfApplied,
          ...result.extra,
        });
      } catch (error: any) {
        console.error("Failed to evaluate ECHP eligibility:", error);
        res.status(500).json({ message: "Failed to evaluate eligibility" });
      }
    },
  );

  app.post(
    "/api/sitespecific/bao/echp/worker/:workerId/purchase",
    requireAuth,
    componentMiddleware,
    requireAccess("worker.mine", workerIdParam),
    async (req, res) => {
      try {
        const workerId = req.params.workerId;
        const { asOf, asOfApplied } = await resolveAsOf(req);

        // Never trust the client: re-run the full eligibility evaluation.
        const result = await evaluateEchpEligibility(workerId, asOf);
        if (!result.eligible || !result.context) {
          return res.status(409).json({
            purchased: false,
            eligible: result.eligible,
            code: result.code,
            message: result.message,
            asOf,
            asOfApplied,
            ...result.extra,
          });
        }

        const ctx = result.context;

        // Idempotency guard: never write a second ECHP entry for the targeted
        // month if one already exists.
        const allHours = await storage.workerHours.getWorkerHours(workerId);
        const alreadyPurchased = allHours.some(
          (r: any) =>
            Number(r.year) === ctx.targetYear &&
            Number(r.month) === ctx.targetMonth &&
            r.employmentStatusId === ctx.echpStatusId &&
            Number(r.hours) > 0,
        );
        if (alreadyPurchased) {
          return res.status(409).json({
            purchased: false,
            eligible: true,
            code: "already_purchased",
            message: "Hours have already been purchased for the targeted month.",
            asOf,
            asOfApplied,
            target: { year: ctx.targetYear, month: ctx.targetMonth },
          });
        }

        if (ctx.hoursToPurchase <= 0) {
          return res.status(409).json({
            purchased: false,
            eligible: true,
            code: "nothing_to_purchase",
            message: "No additional hours are needed to reach the threshold.",
            asOf,
            asOfApplied,
            target: { year: ctx.targetYear, month: ctx.targetMonth },
          });
        }

        // Record the purchased hours as a single ECHP-type entry for the
        // targeted month, through the existing hours storage layer. upsert keys
        // on (worker, employer, year, month, day=1), so a retry is safe.
        await storage.workerHours.upsertWorkerHours({
          workerId,
          year: ctx.targetYear,
          month: ctx.targetMonth,
          employerId: ctx.echpEmployerId,
          employmentStatusId: ctx.echpStatusId,
          hours: ctx.hoursToPurchase,
        });

        return res.json({
          purchased: true,
          eligible: true,
          code: "purchased",
          message: `Purchased ${ctx.hoursToPurchase} hours for ${ctx.targetMonth}/${ctx.targetYear}.`,
          asOf,
          asOfApplied,
          target: { year: ctx.targetYear, month: ctx.targetMonth },
          hoursWorked: ctx.hoursWorked,
          hoursToPurchase: ctx.hoursToPurchase,
          threshold: ctx.threshold,
          price: ctx.price,
        });
      } catch (error: any) {
        console.error("Failed to purchase ECHP hours:", error);
        res.status(500).json({ message: "Failed to purchase hours" });
      }
    },
  );
}
