/**
 * Date Utilities
 * 
 * General-purpose date helper functions for date normalization and comparison.
 * These operate in the runtime's local timezone.
 */

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
