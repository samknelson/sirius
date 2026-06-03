import type { Express, Request, Response, NextFunction } from "express";
import { requireComponent, isComponentEnabled } from "../../components";
import { getEffectiveUser } from "../../masquerade";
import { storage } from "../../../storage";
import { createUnifiedOptionsStorage } from "../../../storage/unified-options";
import { fetchBuildupStatus } from "../../../plugins/trust/eligibility/plugins/sitespecific-bao-buildup";

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

/**
 * Event Center Hours Purchase (ECHP) eligibility evaluation.
 *
 * Runs an ordered series of checks and reports the first failure, or that
 * hours purchasing is permitted. This endpoint only evaluates eligibility;
 * it does not create any charge.
 */
export function registerBaoEchpRoutes(
  app: Express,
  requireAuth: AuthMiddleware,
  _requirePermission: PermissionMiddleware,
  requireAccess: AccessMiddleware,
) {
  const componentMiddleware = requireComponent("sitespecific.bao");
  const optionsStorage = createUnifiedOptionsStorage();

  const workerIdParam = (req: Request): string | undefined => req.params.workerId;

  app.get(
    "/api/sitespecific/bao/echp/worker/:workerId/eligibility",
    requireAuth,
    componentMiddleware,
    requireAccess("worker.mine", workerIdParam),
    async (req, res) => {
      try {
        const workerId = req.params.workerId;

        // Resolve the effective ("as of") date. Defaults to today. A debug + admin
        // user may override it via ?asOf=YYYY-MM-DD; the override is ignored for
        // everyone else.
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

        const respond = (
          eligible: boolean,
          code: string,
          message: string,
          extra: Record<string, unknown> = {},
        ) =>
          res.json({
            eligible,
            code,
            message,
            asOf: { year, month, day },
            asOfApplied,
            ...extra,
          });

        // 1. Online purchasing closes after the cutoff day of the month.
        if (day > CUTOFF_DAY) {
          return respond(
            false,
            "window_closed",
            "Online purchasing for this month is closed. Please contact the office for assistance.",
          );
        }

        // 2. The worker must have an active election with a policy and an employer.
        const election = await storage.workerTrustElections.getActiveViewByWorker(workerId);
        if (!election || !election.policyId || !election.employerId) {
          return respond(
            false,
            "no_active_election",
            "You do not have an active election with a policy and employer, so hours purchasing is unavailable.",
          );
        }

        // 3. The ECHP employer must be configured.
        const echpEmployer = await storage.employers.getBySiriusId(ECHP_EMPLOYER_SIRIUS_ID);
        if (!echpEmployer) {
          return respond(
            false,
            "config_no_echp_employer",
            "Event Center Hours Purchasing is not configured. Please contact an administrator.",
          );
        }

        // 4 & 5. The TERMINATED and ECHP employment-status options must exist.
        const statuses = await optionsStorage.list("employment-status");
        const terminatedStatus = statuses.find((s: any) => s.code === TERMINATED_CODE);
        const echpStatus = statuses.find((s: any) => s.code === ECHP_CODE);
        if (!terminatedStatus) {
          return respond(
            false,
            "config_no_terminated_status",
            "Event Center Hours Purchasing is not configured (missing Terminated status). Please contact an administrator.",
          );
        }
        if (!echpStatus) {
          return respond(
            false,
            "config_no_echp_status",
            "Event Center Hours Purchasing is not configured (missing Event Center status). Please contact an administrator.",
          );
        }

        // 6. The worker's most recent hours entry at the election's employer must not
        //    be of TERMINATED type.
        const current = await storage.workerHours.getWorkerHoursCurrent(workerId);
        const atEmployer = current.find((r: any) => r.employerId === election.employerId);
        if (atEmployer && atEmployer.employmentStatusId === terminatedStatus.id) {
          return respond(
            false,
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
          return respond(false, "buildup_incomplete", "Buildup is not complete.");
        }

        // 8. The worker must be on a break.
        if (!buildup.currentBreakFirstYear || !buildup.currentBreakFirstMonth) {
          return respond(
            false,
            "no_break",
            "There are no break months that need purchasing.",
          );
        }

        // 9. The break must start exactly three months prior to the effective month.
        const targetYear = buildup.currentBreakFirstYear;
        const targetMonth = buildup.currentBreakFirstMonth;
        if (
          targetYear !== buildup.threemonthsprevYear ||
          targetMonth !== buildup.threemonthsprevMonth
        ) {
          return respond(
            false,
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
          return respond(
            false,
            "limit_reached",
            `The maximum number of purchasable months for ${targetYear} has already been reached.`,
            { count: echpCount },
          );
        }

        // 11. All checks passed.
        return respond(true, "permitted", "hours purchasing is permitted.", {
          target: { year: targetYear, month: targetMonth },
        });
      } catch (error: any) {
        console.error("Failed to evaluate ECHP eligibility:", error);
        res.status(500).json({ message: "Failed to evaluate eligibility" });
      }
    },
  );
}
