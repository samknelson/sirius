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

export function formatYmd(ymd: Ymd, formatStr: 'long' | 'short' | 'weekday-long' = 'long'): string {
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

export function ymdToDateForPicker(ymd: Ymd): Date {
  const [year, month, day] = ymd.split('-').map(Number);
  return new Date(year, month - 1, day);
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
