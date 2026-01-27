import { normalizeToDateOnly, getTodayDateOnly } from "@shared/utils";

export interface DenormActiveOptions {
  startDate?: string | Date | null;
  endDate?: string | Date | null;
  requireStartDate?: boolean;
  requireEndDate?: boolean;
  customize?: (defaultActive: boolean) => boolean;
}

/**
 * Calculate denormalized active status based on date range.
 * 
 * Default behavior:
 * - If startDate is provided: today must be >= startDate
 * - If endDate is provided: today must be <= endDate
 * - Null startDate means "started from the beginning of time"
 * - Null endDate means "never expires"
 * 
 * @param options Configuration options
 * @param options.startDate The start date (null = always started)
 * @param options.endDate The end date (null = never expires)
 * @param options.requireStartDate If true, null startDate returns false
 * @param options.requireEndDate If true, null endDate returns false
 * @param options.customize Optional callback to add extra predicates
 * @returns boolean indicating if the record should be considered active
 * 
 * @example
 * // Simple case (worker bans): active if not expired
 * const active = calculateDenormActive({ endDate: ban.endDate });
 * 
 * @example
 * // With start date check
 * const active = calculateDenormActive({ 
 *   startDate: record.startDate, 
 *   endDate: record.endDate 
 * });
 * 
 * @example
 * // Custom case (certifications): active if in date range AND status is granted
 * const active = calculateDenormActive({
 *   startDate: cert.startDate,
 *   endDate: cert.endDate,
 *   requireStartDate: true,
 *   requireEndDate: true,
 *   customize: (defaultActive) => defaultActive && status === 'granted'
 * });
 */
export function calculateDenormActive(options: DenormActiveOptions): boolean {
  const { 
    startDate, 
    endDate, 
    requireStartDate = false,
    requireEndDate = false,
    customize 
  } = options;

  const today = getTodayDateOnly();

  if (requireStartDate && startDate == null) {
    return applyCustomize(false, customize);
  }

  if (requireEndDate && endDate == null) {
    return applyCustomize(false, customize);
  }

  let defaultActive = true;

  if (startDate != null) {
    const normalizedStart = normalizeToDateOnly(startDate);
    if (normalizedStart != null && normalizedStart > today) {
      defaultActive = false;
    }
  }

  if (defaultActive && endDate != null) {
    const normalizedEnd = normalizeToDateOnly(endDate);
    if (normalizedEnd != null && normalizedEnd < today) {
      defaultActive = false;
    }
  }

  return applyCustomize(defaultActive, customize);
}

function applyCustomize(
  defaultActive: boolean, 
  customize?: (defaultActive: boolean) => boolean
): boolean {
  return customize ? customize(defaultActive) : defaultActive;
}
