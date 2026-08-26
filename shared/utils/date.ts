/**
 * Date Utilities
 * 
 * General-purpose date helper functions for date normalization and comparison.
 * These operate in the runtime's local timezone.
 */

/**
 * Ymd Utilities
 * 
 * String-based date handling for "date-only" fields.
 * These utilities treat dates as YYYY-MM-DD strings and NEVER apply timezone conversions.
 * Use these for fields where January 7 must always be January 7, regardless of timezone.
 * 
 * IMPORTANT: Do NOT pass Ymd values through `new Date()` - that will reintroduce timezone issues.
 */

/**
 * Durations
 *
 * Human-readable duration formatting in the `Xd Yh Zm` style shared by the
 * uptime status plugin and the worker TOS surfaces. The formatter is pure:
 * callers decide how to present negative/invalid durations (clamp, placeholder).
 */

/**
 * Format a non-negative millisecond duration as `Xd Yh Zm`.
 * Days and hours are omitted when zero; the minutes part is always emitted
 * (so a fresh duration renders as `0m`). Negative input is clamped to `0m`.
 */
export function formatDurationMs(ms: number): string {
  const totalMinutes = Math.max(0, Math.floor(ms / 60000));
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const mins = totalMinutes % 60;
  const parts: string[] = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  parts.push(`${mins}m`);
  return parts.join(" ");
}

/**
 * Format the duration between two instants as `Xd Yh Zm`.
 * Accepts Dates or date strings; a null/undefined `end` means "now".
 * Returns null when the span is negative or either input is unparseable,
 * letting callers choose their own placeholder (`—`, `0m`, ...).
 */
export function formatDurationBetween(
  start: Date | string,
  end?: Date | string | null,
): string | null {
  const s = typeof start === "string" ? new Date(start) : start;
  const e = end == null ? new Date() : typeof end === "string" ? new Date(end) : end;
  const ms = e.getTime() - s.getTime();
  if (Number.isNaN(ms) || ms < 0) return null;
  return formatDurationMs(ms);
}

export type Ymd = string;

const YMD_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export function isValidYmd(value: unknown): value is Ymd {
  return typeof value === 'string' && YMD_REGEX.test(value);
}

export function assertYmd(value: unknown): Ymd {
  if (!isValidYmd(value)) {
    throw new Error(`Invalid Ymd value: ${value}. Expected YYYY-MM-DD format.`);
  }
  return value;
}

/**
 * Normalize a Date or date-like string into a Ymd, or null when the input is
 * null/undefined/unparseable.
 *
 * - `Date` values use LOCAL calendar fields (never UTC).
 * - Strings whose first 10 chars are already `YYYY-MM-DD` (plain Ymd or an
 *   ISO timestamp like `2024-01-07T00:00:00Z`) keep that date part verbatim —
 *   NO timezone conversion, per this module's no-`new Date(ymd)` rule.
 * - Any other string falls back to `Date` parsing with local fields.
 */
export function toYmd(value: Date | string | null | undefined): Ymd | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    return isNaN(value.getTime()) ? null : dateToYmd(value);
  }
  const head = value.slice(0, 10);
  if (isValidYmd(head)) return head;
  const parsed = new Date(value);
  return isNaN(parsed.getTime()) ? null : dateToYmd(parsed);
}

/**
 * Split a Ymd into numeric parts. Pure string math — no Date construction,
 * so there is no timezone drift. Assumes a valid Ymd (use isValidYmd first
 * when the input is untrusted).
 */
export function parseYmdParts(ymd: Ymd): { year: number; month: number; day: number } {
  const [year, month, day] = ymd.split('-').map(Number);
  return { year, month, day };
}

export function getTodayYmd(): Ymd {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function getDayOfWeekFromYmd(year: number, month: number, day: number): number {
  const m = month < 3 ? month + 12 : month;
  const y = month < 3 ? year - 1 : year;
  const k = y % 100;
  const j = Math.floor(y / 100);
  const h = (day + Math.floor((13 * (m + 1)) / 5) + k + Math.floor(k / 4) + Math.floor(j / 4) - 2 * j) % 7;
  return ((h + 6) % 7);
}

export function formatYmd(ymd: Ymd, formatStr: 'long' | 'short' | 'weekday-long' | 'weekday-short' = 'long'): string {
  if (!isValidYmd(ymd)) return ymd;
  
  const [year, month, day] = ymd.split('-').map(Number);
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 
                  'July', 'August', 'September', 'October', 'November', 'December'];
  const monthsShort = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 
                       'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const weekdaysShort = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  
  const dayOfWeek = getDayOfWeekFromYmd(year, month, day);
  
  switch (formatStr) {
    case 'short':
      return `${monthsShort[month - 1]} ${day}, ${year}`;
    case 'weekday-long':
      return `${weekdaysShort[dayOfWeek]}, ${months[month - 1]} ${day}, ${year}`;
    case 'weekday-short':
      return `${weekdaysShort[dayOfWeek]}, ${monthsShort[month - 1]} ${day}, ${year}`;
    case 'long':
    default:
      return `${months[month - 1]} ${day}, ${year}`;
  }
}

export function compareYmd(a: Ymd, b: Ymd): number {
  return a.localeCompare(b);
}

export function isYmdBefore(a: Ymd, b: Ymd): boolean {
  return compareYmd(a, b) < 0;
}

export function isYmdAfter(a: Ymd, b: Ymd): boolean {
  return compareYmd(a, b) > 0;
}

export function isYmdInRange(ymd: Ymd, start: Ymd | null, end: Ymd | null): boolean {
  if (start && isYmdBefore(ymd, start)) return false;
  if (end && isYmdAfter(ymd, end)) return false;
  return true;
}

/**
 * Convert a Ymd to a Date at LOCAL midnight. Builds the Date from already-split
 * components (never `new Date(ymd)`), so there is no UTC drift.
 */
export function ymdToLocalDate(ymd: Ymd): Date {
  const [year, month, day] = ymd.split('-').map(Number);
  return new Date(year, month - 1, day);
}

export function ymdToDateForPicker(ymd: Ymd): Date {
  return ymdToLocalDate(ymd);
}

/**
 * Add `days` calendar days to a Ymd, returning a Ymd. Uses local-time Date
 * arithmetic on already-split components (never `new Date(ymd)`), so there is
 * no UTC drift. Negative `days` subtracts.
 */
export function addDaysYmd(ymd: Ymd, days: number): Ymd {
  const [year, month, day] = ymd.split('-').map(Number);
  const d = new Date(year, month - 1, day + days);
  return dateToYmd(d);
}

/**
 * Add `days` business days (Mon–Fri) to a Ymd, returning a Ymd. Weekends are
 * skipped; the count starts from the day AFTER `ymd` (adding 1 business day
 * to a Friday yields the following Monday). Negative `days` counts backwards.
 *
 * Extension point: pass `holidays` (a set of Ymd strings) to also skip
 * holidays. Defaults to none — a future holiday-calendar tool can supply the
 * set without changing callers or this function's contract.
 */
export function addBusinessDaysYmd(
  ymd: Ymd,
  days: number,
  holidays: ReadonlySet<Ymd> = new Set(),
): Ymd {
  const [year, month, day] = ymd.split('-').map(Number);
  const d = new Date(year, month - 1, day);
  const step = days < 0 ? -1 : 1;
  let remaining = Math.abs(days);
  while (remaining > 0) {
    d.setDate(d.getDate() + step);
    const dow = d.getDay();
    if (dow === 0 || dow === 6) continue;
    if (holidays.has(dateToYmd(d))) continue;
    remaining -= 1;
  }
  return dateToYmd(d);
}

/**
 * Add `months` calendar months to a Ymd, returning a Ymd. The day-of-month is
 * CLAMPED to the target month's last day (Jan 31 + 1 month → Feb 28/29), so
 * the result never rolls into the following month. Pure string/number math —
 * no `new Date(ymd)` parsing, per this module's no-timezone-drift rule.
 * Negative `months` subtracts.
 */
export function addMonthsYmd(ymd: Ymd, months: number): Ymd {
  const [year, month, day] = ymd.split('-').map(Number);
  const zeroBased = year * 12 + (month - 1) + months;
  const targetYear = Math.floor(zeroBased / 12);
  const targetMonth = (zeroBased % 12 + 12) % 12; // 0-based
  // Day 0 of month N+1 is the last day of month N (local Date arithmetic on
  // numeric components only).
  const lastDay = new Date(targetYear, targetMonth + 1, 0).getDate();
  const clampedDay = Math.min(day, lastDay);
  return `${targetYear}-${String(targetMonth + 1).padStart(2, '0')}-${String(clampedDay).padStart(2, '0')}`;
}

export function dateToYmd(date: Date): Ymd {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function normalizeToDateOnly(date: Date | string | null | undefined): Date | null {
  if (date == null) return null;
  const d = typeof date === 'string' ? new Date(date) : new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function getTodayDateOnly(): Date {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

export function isDateInFuture(date: Date | null): boolean {
  if (!date) return false;
  const normalized = normalizeToDateOnly(date);
  const today = getTodayDateOnly();
  return normalized !== null && normalized > today;
}

export function isStartAfterEnd(startDate: Date | null, endDate: Date | null): boolean {
  if (!startDate || !endDate) return false;
  const start = normalizeToDateOnly(startDate);
  const end = normalizeToDateOnly(endDate);
  return start !== null && end !== null && start > end;
}

export function isDateWithinRange(
  startDate: Date | string | null | undefined,
  endDate: Date | string | null | undefined,
  testDate?: Date | string
): boolean {
  const start = normalizeToDateOnly(startDate);
  const end = normalizeToDateOnly(endDate);
  const test = testDate ? normalizeToDateOnly(testDate)! : getTodayDateOnly();
  
  if (!start && !end) return false;
  if (start && !end) return start <= test;
  if (!start && end) return test <= end;
  return start! <= test && test <= end!;
}
