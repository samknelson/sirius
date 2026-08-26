/**
 * Disability Credit eligibility — server entry point.
 *
 * The PURE eligibility core lives in `@shared/sitespecific/bao/dc-eligibility`
 * so the `worker.dc` access policy (a shared file that cannot import server
 * modules) evaluates the exact same rules. This module re-exports the pure
 * API unchanged and adds the DB-backed evaluation.
 */
import { storage } from "../../../storage";
import type { Ymd } from "@shared/utils/date";
import {
  evaluateDcEligibility,
  rollingWindow,
  type DcEligibilityResult,
} from "@shared/sitespecific/bao/dc-eligibility";
import { getDcDenialLetterValidityMonths } from "./dc-settings";

export {
  evaluateDcEligibility,
  rollingWindow,
  isDenialLetterActive,
  denialLetterExpiryYmd,
  isFmlaStatusOption,
  isRetiredDisabilityStatusOption,
  monthYmd,
  findUnreportedGapsBetweenFmlaMonths,
  type DcEligibilityInputs,
  type DcEligibilityResult,
} from "@shared/sitespecific/bao/dc-eligibility";

/**
 * Full DB-backed evaluation for a worker as of a date. Reads canonical
 * worker-hours (via the DC storage's FMLA-month read) and non-voided denial
 * letters; the validity window is derived from the current configuration.
 */
export async function computeDcEligibilityForWorker(
  workerId: string,
  asOfYmd: Ymd,
): Promise<DcEligibilityResult> {
  const { startMonthYmd, endMonthYmd } = rollingWindow(asOfYmd);
  const validityMonths = await getDcDenialLetterValidityMonths();
  const [fmlaMonths, letters] = await Promise.all([
    storage.baoDisabilityCredit.getFmlaMonthsForWorker(workerId, startMonthYmd, endMonthYmd),
    storage.baoDisabilityCredit.listNonVoidedDenialLettersForWorker(workerId),
  ]);
  return evaluateDcEligibility({
    asOfYmd,
    fmlaMonths,
    denialLetters: letters,
    denialLetterValidityMonths: validityMonths,
  });
}
